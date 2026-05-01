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
import { AllegroConnectionTokenState } from '../allegro-connection-token-state';
import {
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

  beforeEach(() => {
    connectionId = 'connection-123';
    baseUrl = 'https://api.allegro.pl';
    credentials = {
      accessToken: 'test-access-token-12345',
    };

    client = new AllegroHttpClient(
      connectionId,
      baseUrl,
      new AllegroConnectionTokenState(connectionId, credentials),
    );
    noRetryClient = new AllegroHttpClient(
      connectionId,
      baseUrl,
      new AllegroConnectionTokenState(connectionId, credentials),
      { maxRetries: 0 },
    );
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
        new AllegroConnectionTokenState(connectionId, credentials),
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
        new AllegroConnectionTokenState(connectionId, credentials),
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
            'content-type': 'application/vnd.allegro.public.v1+json',
            accept: 'application/vnd.allegro.public.v1+json',
            'accept-language': 'pl-PL',
          }),
        }),
      );
    });

    it('should let caller-supplied Accept-Language override the pl-PL default', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      });

      await client.get('/test', { headers: { 'Accept-Language': 'en-US' } });

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = (fetchCall[1]?.headers as Record<string, string>) ?? {};
      expect(headers['accept-language']).toBe('en-US');
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

  describe('postBinary', () => {
    it('sends raw Uint8Array body without JSON-stringifying it', async () => {
      const responseData = { location: 'https://images.allegrostatic.com/abc.jpg' };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(responseData)),
      });

      const bytes = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG magic bytes
      const response = await client.postBinary('/sale/images', 'image/jpeg', bytes);

      expect(response.data).toEqual(responseData);
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(fetchCall[1]?.method).toBe('POST');
      expect(fetchCall[1]?.body).toBe(bytes);
    });

    it('sets Content-Type from the parameter, overriding the JSON default', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      });

      await client.postBinary('/sale/images', 'image/png', new Uint8Array([1, 2, 3]));

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = (fetchCall[1]?.headers as Record<string, string>) ?? {};
      expect(headers['content-type']).toBe('image/png');
    });

    it('still attaches Authorization: Bearer <token> from the token state', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      });

      await client.postBinary('/sale/images', 'image/jpeg', new Uint8Array([0xff]));

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = (fetchCall[1]?.headers as Record<string, string>) ?? {};
      expect(headers.authorization).toBe('Bearer test-access-token-12345');
    });

    it('inherits 5xx retry from the request loop', async () => {
      const responseData = { location: 'https://images.allegrostatic.com/ok.jpg' };
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers(),
          text: () => Promise.resolve('Internal Server Error'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(responseData)),
        });

      const promise = client.postBinary('/sale/images', 'image/jpeg', new Uint8Array([0xff]));
      await jest.advanceTimersByTimeAsync(1_000);
      const response = await promise;

      expect(response.data).toEqual(responseData);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('inherits 401 reactive token-refresh from the request loop', async () => {
      const NOW = Date.now();
      const refreshCallback = jest.fn().mockResolvedValue({
        accessToken: 'recovered-token',
        expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
      });
      const tokenState = new AllegroConnectionTokenState(
        connectionId,
        { accessToken: 'stale-token' },
        refreshCallback,
      );
      const refreshClient = new AllegroHttpClient(connectionId, baseUrl, tokenState);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: new Headers(),
          text: () => Promise.resolve('{"error":"expired_token"}'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"location":"https://images.allegrostatic.com/x.jpg"}'),
        });

      const response = await refreshClient.postBinary(
        '/sale/images',
        'image/jpeg',
        new Uint8Array([0xff]),
      );

      expect(response.status).toBe(201);
      expect(refreshCallback).toHaveBeenCalledTimes(1);
      const retryCall = (global.fetch as jest.Mock).mock.calls[1] as [string, RequestInit];
      const retryHeaders = (retryCall[1]?.headers as Record<string, string>) ?? {};
      expect(retryHeaders.authorization).toBe('Bearer recovered-token');
    });
  });

  describe('postMultipart', () => {
    it('builds a multipart/form-data body with a generated boundary', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"id":"attach-1"}'),
      });

      await client.postMultipart('/sale/sale-product-offer-attachments', [
        {
          name: 'file',
          fileName: 'safety.pdf',
          contentType: 'application/pdf',
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        },
      ]);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = (fetchCall[1]?.headers as Record<string, string>) ?? {};
      const contentType = headers['content-type'] ?? '';
      expect(contentType).toMatch(/^multipart\/form-data; boundary=----OpenLinkerFormBoundary/);

      const body = fetchCall[1]?.body as Uint8Array;
      expect(body).toBeInstanceOf(Uint8Array);

      const text = new TextDecoder().decode(body);
      expect(text).toContain('Content-Disposition: form-data; name="file"; filename="safety.pdf"');
      expect(text).toContain('Content-Type: application/pdf');
      expect(text).toContain('%PDF');
    });

    it('returns the parsed response data', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"id":"attach-42"}'),
      });

      const response = await client.postMultipart<{ id: string }>(
        '/sale/sale-product-offer-attachments',
        [
          {
            name: 'file',
            fileName: 'x.pdf',
            contentType: 'application/pdf',
            bytes: new Uint8Array([0xff]),
          },
        ],
      );

      expect(response.data).toEqual({ id: 'attach-42' });
    });

    it('surfaces 4xx as AllegroApiException without retry', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: () =>
          Promise.resolve(JSON.stringify({ errors: [{ message: 'invalid file' }] })),
      });

      await expect(
        noRetryClient.postMultipart('/sale/sale-product-offer-attachments', [
          {
            name: 'file',
            fileName: 'x.pdf',
            contentType: 'application/pdf',
            bytes: new Uint8Array([0xff]),
          },
        ]),
      ).rejects.toThrow(AllegroApiException);
      expect(global.fetch).toHaveBeenCalledTimes(1);
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

  describe('headers', () => {
    const TRACE_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it('should use vendor media type as default Content-Type on PATCH', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      });

      await client.patch('/sale/product-offers/123', { name: 'new-title' });

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = (fetchCall[1]?.headers as Record<string, string>) ?? {};
      expect(headers['content-type']).toBe('application/vnd.allegro.public.v1+json');
    });

    it('should honor caller-supplied Content-Type override', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      });

      await client.post(
        '/test',
        { foo: 'bar' },
        { headers: { 'Content-Type': 'application/vnd.allegro.beta.v1+json' } },
      );

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = (fetchCall[1]?.headers as Record<string, string>) ?? {};
      expect(headers['content-type']).toBe('application/vnd.allegro.beta.v1+json');
    });

    it('should not allow caller to override structural headers (Authorization, X-Trace-Id)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      });

      await client.get('/test', {
        headers: {
          Authorization: 'Bearer evil',
          'X-Trace-Id': 'attacker-controlled',
        },
      });

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = (fetchCall[1]?.headers as Record<string, string>) ?? {};
      expect(headers.authorization).toBe('Bearer test-access-token-12345');
      expect(headers['x-trace-id']).not.toBe('attacker-controlled');
      expect(headers['x-trace-id']).toMatch(TRACE_ID_REGEX);
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

    it('preserves the full Allegro error body on AllegroApiException (#409)', async () => {
      // Pre-#409 the body was truncated to 500 chars before being stored on
      // the exception, which broke downstream `parseAllegroErrors` for any
      // real Allegro error body (multiple-KB).
      const longErrorJson = JSON.stringify({
        errors: [
          {
            code: 'ConstraintViolationException.MissingRequiredParameters',
            message: 'x'.repeat(2000),
            details: 'y'.repeat(2000),
          },
        ],
      });
      expect(longErrorJson.length).toBeGreaterThan(500);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 422,
        headers: new Headers(),
        text: () => Promise.resolve(longErrorJson),
      });

      await expect(noRetryClient.get('/test')).rejects.toMatchObject({
        statusCode: 422,
        responseBody: longErrorJson,
      });
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

  describe('proactive token refresh', () => {
    const NOW = new Date('2026-04-22T10:00:00.000Z').getTime();
    // Cooldown constant mirrors AllegroHttpClient.PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS.
    const COOLDOWN_MS = 5_000;
    let refreshCallback: jest.Mock;

    beforeEach(() => {
      jest.setSystemTime(NOW);
      refreshCallback = jest.fn();
    });

    // Build a no-retry client with controllable credentials. Skipping retries
    // keeps the bulk of the suite single-attempt — the reactive-fallback test
    // below opts into the default retry config explicitly.
    const buildClient = (opts: {
      expiresAt?: Date | string;
      callback?: (connectionId: string) => Promise<{ accessToken: string; expiresAt?: Date | string }>;
      accessToken?: string;
    } = {}): AllegroHttpClient => {
      const tokenState = new AllegroConnectionTokenState(
        connectionId,
        { accessToken: opts.accessToken ?? 'initial-token', expiresAt: opts.expiresAt },
        opts.callback,
      );
      return new AllegroHttpClient(connectionId, baseUrl, tokenState, {
        maxRetries: 0,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1,
      });
    };

    const mockAlways200 = (): void => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      });
    };

    it('should not trigger proactive refresh when no expiresAt is set (backward compat)', async () => {
      mockAlways200();
      const client = buildClient({ callback: refreshCallback });

      await client.get('/test');

      expect(refreshCallback).not.toHaveBeenCalled();
    });

    it('should not trigger proactive refresh when no refresh callback is provided', async () => {
      mockAlways200();
      const client = buildClient({ expiresAt: new Date(NOW - 1_000) });

      await client.get('/test');

      // Can't assert on a callback that doesn't exist — we assert the request
      // still went through on the initial token.
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should treat a garbage expiresAt string as no expiry (no-op, no refresh)', async () => {
      mockAlways200();
      const client = buildClient({ expiresAt: 'not-a-date', callback: refreshCallback });

      await client.get('/test');

      expect(refreshCallback).not.toHaveBeenCalled();
    });

    it('should not trigger refresh when token is well within validity', async () => {
      mockAlways200();
      const client = buildClient({
        expiresAt: new Date(NOW + 10 * 60_000), // 10 min out
        callback: refreshCallback,
      });

      await client.get('/test');

      expect(refreshCallback).not.toHaveBeenCalled();
    });

    it('should trigger proactive refresh when token is within 60s of expiry', async () => {
      mockAlways200();
      refreshCallback.mockResolvedValue({
        accessToken: 'refreshed-token',
        expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
      });
      const client = buildClient({
        expiresAt: new Date(NOW + 30_000), // inside the 60s window
        callback: refreshCallback,
      });

      await client.get('/test');

      expect(refreshCallback).toHaveBeenCalledTimes(1);
      expect(refreshCallback).toHaveBeenCalledWith(connectionId);
    });

    it('should use refreshed access token on the outgoing request', async () => {
      mockAlways200();
      refreshCallback.mockResolvedValue({
        accessToken: 'refreshed-token',
        expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
      });
      const client = buildClient({
        expiresAt: new Date(NOW + 30_000),
        callback: refreshCallback,
      });

      await client.get('/test');

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = (fetchCall[1]?.headers as Record<string, string>) ?? {};
      expect(headers.authorization).toBe('Bearer refreshed-token');
    });

    it('should update cached expiresAt from the refresh result so it does not re-refresh immediately', async () => {
      mockAlways200();
      refreshCallback.mockResolvedValue({
        accessToken: 'refreshed-token',
        expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
      });
      const client = buildClient({
        expiresAt: new Date(NOW + 30_000),
        callback: refreshCallback,
      });

      await client.get('/test1');
      await client.get('/test2');

      expect(refreshCallback).toHaveBeenCalledTimes(1);
    });

    it('should serialize concurrent refresh attempts (single-flight)', async () => {
      mockAlways200();
      // Hold the refresh pending until the three requests are suspended on it.
      let resolveRefresh!: (v: { accessToken: string; expiresAt: string }) => void;
      refreshCallback.mockReturnValue(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );
      const client = buildClient({
        expiresAt: new Date(NOW + 30_000),
        callback: refreshCallback,
      });

      const p1 = client.get('/test1');
      const p2 = client.get('/test2');
      const p3 = client.get('/test3');

      // All three requests are now parked on the same in-flight refresh.
      expect(refreshCallback).toHaveBeenCalledTimes(1);

      resolveRefresh({
        accessToken: 'refreshed-token',
        expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
      });

      await Promise.all([p1, p2, p3]);

      expect(refreshCallback).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledTimes(3);
      for (const call of (global.fetch as jest.Mock).mock.calls as Array<[string, RequestInit]>) {
        const headers = (call[1]?.headers as Record<string, string>) ?? {};
        expect(headers.authorization).toBe('Bearer refreshed-token');
      }
    });

    it('should fall through to reactive 401 path when proactive refresh throws', async () => {
      // First callback invocation (proactive): fails → swallowed + cooldown set.
      // Second invocation (reactive on 401): succeeds → request retries.
      refreshCallback.mockRejectedValueOnce(new Error('refresh endpoint down'));
      refreshCallback.mockResolvedValueOnce({
        accessToken: 'recovered-token',
        expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
      });
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: new Headers(),
          text: () => Promise.resolve('{"error":"expired_token"}'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        });

      // Need default retry config for the TokenRefreshedError → retry loop.
      const client = new AllegroHttpClient(
        connectionId,
        baseUrl,
        new AllegroConnectionTokenState(
          connectionId,
          { accessToken: 'initial-token', expiresAt: new Date(NOW + 30_000) },
          refreshCallback,
        ),
      );

      const response = await client.get('/test');

      expect(response.status).toBe(200);
      expect(refreshCallback).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      // The retry attempt carries the recovered token from the reactive path.
      const retryCall = (global.fetch as jest.Mock).mock.calls[1] as [string, RequestInit];
      const retryHeaders = (retryCall[1]?.headers as Record<string, string>) ?? {};
      expect(retryHeaders.authorization).toBe('Bearer recovered-token');
    });

    it('should honour proactive-refresh cooldown after a failure', async () => {
      mockAlways200();
      refreshCallback.mockRejectedValueOnce(new Error('transient failure'));
      const client = buildClient({
        expiresAt: new Date(NOW + 30_000),
        callback: refreshCallback,
      });

      // First request: proactive refresh attempt fails (swallowed), request
      // proceeds with the old token, server returns 200 — one callback invocation.
      await client.get('/test1');
      expect(refreshCallback).toHaveBeenCalledTimes(1);

      // Still inside the 5s cooldown: no second proactive attempt.
      jest.setSystemTime(NOW + 1_000);
      await client.get('/test2');
      expect(refreshCallback).toHaveBeenCalledTimes(1);

      // Past the cooldown: proactive path resumes, this time it succeeds.
      refreshCallback.mockResolvedValueOnce({
        accessToken: 'recovered-token',
        expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
      });
      jest.setSystemTime(NOW + COOLDOWN_MS + 1_000);
      await client.get('/test3');
      expect(refreshCallback).toHaveBeenCalledTimes(2);
    });
  });
});
