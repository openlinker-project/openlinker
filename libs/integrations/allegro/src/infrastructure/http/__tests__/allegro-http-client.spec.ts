/**
 * Allegro HTTP Client Tests
 *
 * Unit tests for AllegroHttpClient. Tests HTTP requests, authentication,
 * retry logic, rate limiting, error handling, and response parsing.
 *
 * All tests run under jest fake timers installed in beforeEach. The retry
 * and timeout paths are driven with jest.advanceTimersByTimeAsync(...) so
 * the suite completes in ms regardless of host load — see #287 for history.
 *
 * @module libs/integrations/allegro/src/infrastructure/http/__tests__
 */
import { AllegroHttpClient } from '../allegro-http-client';
import {
  AllegroConnectionConfig,
  AllegroCredentials,
  AllegroApiException,
  AllegroAuthenticationException,
  AllegroRateLimitException,
} from '@openlinker/integrations-allegro';

// Mock fetch globally
global.fetch = jest.fn();

describe('AllegroHttpClient', () => {
  let client: AllegroHttpClient;
  // Sibling of `client` for cases that should fail on the first attempt without burning
  // retry backoffs (429 immediate surfacing, 5xx shape, JSON parse shape, 30s timeout).
  let noRetryClient: AllegroHttpClient;
  let connectionId: string;
  let baseUrl: string;
  let credentials: AllegroCredentials;
  let config: AllegroConnectionConfig;

  beforeEach(() => {
    connectionId = 'connection-123';
    baseUrl = 'https://api.allegro.pl';
    credentials = {
      accessToken: 'test-access-token-12345',
    };
    config = {
      environment: 'production',
    };

    client = new AllegroHttpClient(connectionId, baseUrl, credentials, config);
    noRetryClient = new AllegroHttpClient(connectionId, baseUrl, credentials, config, {
      maxRetries: 0,
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    (global.fetch as jest.Mock).mockReset();
  });

  describe('constructor', () => {
    it('should normalize baseUrl by removing trailing slash', () => {
      const clientWithSlash = new AllegroHttpClient(
        connectionId,
        'https://api.allegro.pl/',
        credentials,
        config,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((clientWithSlash as any).baseUrl).toBe('https://api.allegro.pl');
    });

    it('should use default retry config values', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const retryConfig = (client as any).retryConfig as {
        maxRetries: number;
        initialDelayMs: number;
        maxDelayMs: number;
        backoffMultiplier: number;
      };
      expect(retryConfig.maxRetries).toBe(3);
      expect(retryConfig.initialDelayMs).toBe(1000);
      expect(retryConfig.maxDelayMs).toBe(30000);
      expect(retryConfig.backoffMultiplier).toBe(2);
    });

    it('should override default retry config values', () => {
      const customRetryConfig = {
        maxRetries: 5,
        initialDelayMs: 2000,
        maxDelayMs: 60000,
        backoffMultiplier: 3,
      };
      const clientWithCustom = new AllegroHttpClient(
        connectionId,
        baseUrl,
        credentials,
        config,
        customRetryConfig,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const retryConfig = (clientWithCustom as any).retryConfig as {
        maxRetries: number;
        initialDelayMs: number;
        maxDelayMs: number;
        backoffMultiplier: number;
      };
      expect(retryConfig.maxRetries).toBe(5);
      expect(retryConfig.initialDelayMs).toBe(2000);
      expect(retryConfig.maxDelayMs).toBe(60000);
      expect(retryConfig.backoffMultiplier).toBe(3);
    });
  });

  describe('get', () => {
    it('should make GET request successfully', async () => {
      const mockData = { id: '123', name: 'Test' };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockData)),
      });

      const response = await client.get('/test');

      expect(response.data).toEqual(mockData);
      expect(response.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            authorization: 'Bearer test-access-token-12345',
            'content-type': 'application/json',
            accept: 'application/vnd.allegro.public.v1+json',
          }),
        }),
      );
    });

    it('should include query parameters in GET request', async () => {
      const mockData = { items: [] };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockData)),
      });

      await client.get('/test', {
        queryParams: { limit: 10, offset: 0 },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object),
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('offset=0'),
        expect.any(Object),
      );
    });
  });

  describe('post', () => {
    it('should make POST request with body successfully', async () => {
      const mockData = { id: '123' };
      const requestBody = { name: 'Test' };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockData)),
      });

      const response = await client.post('/test', requestBody);

      expect(response.data).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestBody),
        }),
      );
    });
  });

  describe('authentication', () => {
    it('should include Bearer token in Authorization header', async () => {
      const mockData = { id: '123' };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockData)),
      });

      await client.get('/test');

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = (fetchCall[1]?.headers as Record<string, string>) ?? {};
      expect(headers.authorization).toBe('Bearer test-access-token-12345');
    });

    it('should include Accept header for Allegro API version', async () => {
      const mockData = { id: '123' };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockData)),
      });

      await client.get('/test');

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = (fetchCall[1]?.headers as Record<string, string>) ?? {};
      expect(headers.accept).toBe('application/vnd.allegro.public.v1+json');
    });

    it('should include X-Trace-Id header for correlation', async () => {
      const mockData = { id: '123' };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockData)),
      });

      await client.get('/test');

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = (fetchCall[1]?.headers as Record<string, string>) ?? {};
      const traceId = headers['x-trace-id'];
      expect(traceId).toBeDefined();
      expect(traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe('error handling', () => {
    it('should throw AllegroAuthenticationException on 401', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: () => Promise.resolve('{"error": "invalid_token"}'),
      });

      await expect(client.get('/test')).rejects.toThrow(AllegroAuthenticationException);
    });

    it('should throw AllegroRateLimitException on 429', async () => {
      const mockHeaders = new Headers();
      mockHeaders.set('retry-after', '5');

      (global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 429,
          headers: mockHeaders,
          text: () => Promise.resolve('{"error": "rate_limit_exceeded"}'),
        }),
      );

      await expect(noRetryClient.get('/test')).rejects.toThrow(AllegroRateLimitException);
    });

    it('should throw AllegroApiException on 4xx errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: () => Promise.resolve('{"error": "bad_request"}'),
      });

      await expect(client.get('/test')).rejects.toThrow(AllegroApiException);
    });

    it('should throw AllegroApiException on 5xx errors', async () => {
      // noRetryClient so we get the 5xx exception directly without driving sleeps.
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: () => Promise.resolve('{"error": "internal_server_error"}'),
      });

      await expect(noRetryClient.get('/test')).rejects.toThrow(AllegroApiException);
    });

    it('should throw AllegroApiException on invalid JSON response', async () => {
      // noRetryClient: a JSON-parse throw keeps the status at 200, so the generic retry
      // branch would re-attempt up to maxRetries times. We only want the first throw.
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('invalid json'),
      });

      await expect(noRetryClient.get('/test')).rejects.toThrow(AllegroApiException);
    });

    it('should throw AllegroApiException on timeout', async () => {
      // noRetryClient: get the timeout exception directly without a retry storm.
      // Mock fetch to resolve only when its AbortSignal fires.
      (global.fetch as jest.Mock).mockImplementationOnce(
        (_url: string, options?: { signal?: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            if (options?.signal?.aborted) {
              const abortError = new Error('The operation was aborted');
              abortError.name = 'AbortError';
              reject(abortError);
              return;
            }
            if (options?.signal) {
              options.signal.addEventListener(
                'abort',
                () => {
                  const abortError = new Error('The operation was aborted');
                  abortError.name = 'AbortError';
                  reject(abortError);
                },
                { once: true },
              );
            }
          });
        },
      );

      // Attach declarative rejection assertions first, then drive the 30s abort under fake
      // timers. Both assertions await the same eventual rejection.
      const promise = noRetryClient.get('/test');
      const classAssertion = expect(promise).rejects.toThrow(AllegroApiException);
      const messageAssertion = expect(promise).rejects.toThrow(/Request timeout after/);
      await jest.advanceTimersByTimeAsync(30_000);
      await classAssertion;
      await messageAssertion;
    });
  });

  describe('retry logic', () => {
    it('should retry on 5xx errors', async () => {
      const mockData = { id: '123' };
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers(),
          text: () => Promise.resolve('Internal Server Error'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockData)),
        });

      // Default client: first 5xx triggers a 1s backoff before the retry. Drive the clock
      // forward past the sleep so the second attempt runs.
      const promise = client.get('/test');
      await jest.advanceTimersByTimeAsync(1_000);
      const response = await promise;

      expect(response.data).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on 4xx errors (except 429)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: () => Promise.resolve('Bad Request'),
      });

      await expect(client.get('/test')).rejects.toThrow(AllegroApiException);

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on authentication errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(client.get('/test')).rejects.toThrow(AllegroAuthenticationException);

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on 429 with exponential backoff', async () => {
      const mockData = { id: '123' };
      const headers = new Headers();
      headers.set('Retry-After', '1');

      (global.fetch as jest.Mock)
        .mockImplementationOnce(() => {
          return Promise.resolve({
            ok: false,
            status: 429,
            headers,
            text: () => Promise.resolve('Rate Limit Exceeded'),
          });
        })
        .mockImplementationOnce(() => {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify(mockData)),
          });
        });

      // 429 with Retry-After: 1 schedules a 1s sleep before the retry. Drive it forward.
      const promise = client.get('/test');
      await jest.advanceTimersByTimeAsync(1_000);
      const response = await promise;

      expect(response.data).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
