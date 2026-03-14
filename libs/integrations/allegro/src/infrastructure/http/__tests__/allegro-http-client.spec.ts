/**
 * Allegro HTTP Client Tests
 *
 * Unit tests for AllegroHttpClient. Tests HTTP requests, authentication,
 * retry logic, rate limiting, error handling, and response parsing.
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

      jest.useRealTimers();
      const response = await client.get('/test');
      jest.useFakeTimers();

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

      jest.useRealTimers();
      await client.get('/test', {
        queryParams: { limit: 10, offset: 0 },
      });
      jest.useFakeTimers();

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

      jest.useRealTimers();
      const response = await client.post('/test', requestBody);
      jest.useFakeTimers();

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

      jest.useRealTimers();
      await client.get('/test');
      jest.useFakeTimers();

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

      jest.useRealTimers();
      await client.get('/test');
      jest.useFakeTimers();

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

      jest.useRealTimers();
      await client.get('/test');
      jest.useFakeTimers();

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

      jest.useRealTimers();
      await expect(client.get('/test')).rejects.toThrow(AllegroAuthenticationException);
      jest.useFakeTimers();
    });

    it('should throw AllegroRateLimitException on 429', async () => {
      // Create a client with no retries to test immediate exception
      const noRetryClient = new AllegroHttpClient(connectionId, baseUrl, credentials, config, {
        maxRetries: 0,
      });

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

      jest.useRealTimers();
      await expect(noRetryClient.get('/test')).rejects.toThrow(AllegroRateLimitException);
      jest.useFakeTimers();
    });

    it('should throw AllegroApiException on 4xx errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: () => Promise.resolve('{"error": "bad_request"}'),
      });

      jest.useRealTimers();
      await expect(client.get('/test')).rejects.toThrow(AllegroApiException);
      jest.useFakeTimers();
    });

    it('should throw AllegroApiException on 5xx errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: () => Promise.resolve('{"error": "internal_server_error"}'),
      });

      jest.useRealTimers();
      await expect(client.get('/test')).rejects.toThrow(AllegroApiException);
      jest.useFakeTimers();
    });

    it('should throw AllegroApiException on invalid JSON response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('invalid json'),
      });

      jest.useRealTimers();
      await expect(client.get('/test')).rejects.toThrow(AllegroApiException);
      jest.useFakeTimers();
    });

    it('should throw AllegroApiException on timeout', async () => {
      // Create a client with no retries to test immediate timeout exception
      const noRetryClient = new AllegroHttpClient(connectionId, baseUrl, credentials, config, {
        maxRetries: 0,
      });

      // Mock fetch to never resolve, but check for abort signal
      (global.fetch as jest.Mock).mockImplementationOnce(
        (_url: string, options?: { signal?: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            // Check if signal is already aborted
            if (options?.signal?.aborted) {
              const abortError = new Error('The operation was aborted');
              abortError.name = 'AbortError';
              reject(abortError);
              return;
            }

            // Listen for abort signal - use 'once' to ensure it only fires once
            if (options?.signal) {
              const abortHandler = (): void => {
                const abortError = new Error('The operation was aborted');
                abortError.name = 'AbortError';
                reject(abortError);
              };
              // Use addEventListener with once option
              options.signal.addEventListener('abort', abortHandler, { once: true });
            }

            // Never resolves - will timeout after 30s and trigger abort
          });
        },
      );

      jest.useRealTimers();
      const promise = noRetryClient.get('/test');
      // Wait for timeout (30s) plus a small buffer
      await expect(promise).rejects.toThrow(AllegroApiException);
      await expect(promise).rejects.toThrow(/Request timeout after/);
      jest.useFakeTimers();
    }, 35000); // Increase test timeout to 35s to allow for 30s request timeout
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

      jest.useRealTimers();
      const response = await client.get('/test');
      jest.useFakeTimers();

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

      jest.useRealTimers();
      await expect(client.get('/test')).rejects.toThrow(AllegroApiException);
      jest.useFakeTimers();

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on authentication errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: () => Promise.resolve('Unauthorized'),
      });

      jest.useRealTimers();
      await expect(client.get('/test')).rejects.toThrow(AllegroAuthenticationException);
      jest.useFakeTimers();

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

      jest.useRealTimers();
      const response = await client.get('/test');
      jest.useFakeTimers();

      expect(response.data).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});


