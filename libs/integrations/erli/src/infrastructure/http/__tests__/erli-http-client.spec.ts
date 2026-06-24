/**
 * Erli HTTP Client — unit tests
 *
 * Stubs `global.fetch` (sibling convention) to verify bearer auth, the retry
 * loop, the conservative idempotent-vs-non-idempotent retry branching (D3),
 * HTTP-status → domain-exception classification, the 202 passthrough, and the
 * HTTPS construction guard. Retry delays are tuned to ~1 ms so the suite is fast.
 *
 * Keep-alive is intentionally NOT tested here — it's provided by the Node
 * `fetch` runtime, not an injected dispatcher (Decision D2).
 *
 * @module libs/integrations/erli/src/infrastructure/http
 */
import { ErliApiException } from '../../../domain/exceptions/erli-api.exception';
import { ErliAuthenticationException } from '../../../domain/exceptions/erli-authentication.exception';
import { ErliConfigException } from '../../../domain/exceptions/erli-config.exception';
import { ErliNetworkException } from '../../../domain/exceptions/erli-network.exception';
import { ErliRateLimitException } from '../../../domain/exceptions/erli-rate-limit.exception';
import { ErliHttpClient } from '../erli-http-client';

interface FakeResponseInit {
  ok: boolean;
  status: number;
  body?: string;
  retryAfter?: string;
}

function fakeResponse(init: FakeResponseInit): Response {
  return {
    ok: init.ok,
    status: init.status,
    headers: {
      get: (name: string): string | null =>
        name.toLowerCase() === 'retry-after' ? (init.retryAfter ?? null) : null,
    },
    text: (): Promise<string> => Promise.resolve(init.body ?? ''),
  } as unknown as Response;
}

const BASE_URL = 'https://erli.pl/svc/shop-api';
const API_KEY = 'test-api-key';
const FAST_RETRY = { initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1, maxRetries: 2 };

/** Typed view of the recorded `fetch(url, init)` calls (avoids `any` access). */
type RecordedCall = [url: string, init: { method: string; headers: Record<string, string> }];
function recordedCalls(mock: jest.Mock): RecordedCall[] {
  return mock.mock.calls as RecordedCall[];
}

const originalFetch = global.fetch;

describe('ErliHttpClient', () => {
  let fetchMock: jest.Mock;
  let client: ErliHttpClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new ErliHttpClient('conn-1', BASE_URL, API_KEY, FAST_RETRY);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('construction', () => {
    it('should reject a non-https baseUrl when constructed', () => {
      expect(() => new ErliHttpClient('conn-1', 'http://erli.pl/svc', API_KEY)).toThrow(
        ErliConfigException,
      );
    });

    it('should reject an invalid baseUrl when constructed', () => {
      expect(() => new ErliHttpClient('conn-1', 'not-a-url', API_KEY)).toThrow(ErliConfigException);
    });
  });

  describe('requests', () => {
    it('should attach the bearer API key on every method', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, status: 200, body: '{"ok":true}' }));

      await client.get('/offers');
      await client.post('/offers', { sku: 'A' });
      await client.patch('/offers/1', { qty: 5 });
      await client.put('/hooks/orderCreated', { url: 'https://x', accessToken: 's' });

      const calls = recordedCalls(fetchMock);
      for (const [, init] of calls) {
        expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
      }
      expect(calls[0][1].method).toBe('GET');
      expect(calls[1][1].method).toBe('POST');
      expect(calls[2][1].method).toBe('PATCH');
      expect(calls[3][1].method).toBe('PUT');
    });

    it('should preserve the base-URL path prefix when joining the request path', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, status: 200, body: '{}' }));

      await client.get('/offers/o1');

      // Regression: `new URL('/offers', base)` used to drop the `/svc/shop-api`
      // prefix and hit the host root. The full URL must keep it.
      expect(recordedCalls(fetchMock)[0][0]).toBe('https://erli.pl/svc/shop-api/offers/o1');
    });

    it('should serialize query params and drop undefined values', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, status: 200, body: '{}' }));

      await client.get('/offers', { queryParams: { limit: 10, cursor: undefined, active: true } });

      const calledUrl = recordedCalls(fetchMock)[0][0];
      expect(calledUrl).toBe('https://erli.pl/svc/shop-api/offers?limit=10&active=true');
      expect(calledUrl).not.toContain('cursor');
    });

    it('should reject a request path that escapes the configured host', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, status: 200, body: '{}' }));

      await expect(client.get('https://evil.example/steal')).rejects.toBeInstanceOf(
        ErliConfigException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should surface a timeout as ErliNetworkException for an idempotent GET', async () => {
      // Reject only when our AbortController fires, so the per-request timeout
      // drives the failure rather than a synthetic rejection.
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }): Promise<Response> =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      );

      await expect(client.get('/offers', { timeoutMs: 1 })).rejects.toMatchObject({
        message: expect.stringContaining('timed out'),
      });
      // Idempotent GET → retried to exhaustion (maxRetries: 2 → 3 attempts).
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should return status and parsed data on success', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, status: 200, body: '{"id":"o1"}' }));

      const res = await client.get<{ id: string }>('/offers/o1');

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ id: 'o1' });
    });

    it('should expose status 202 for an accepted async write', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, status: 202, body: '' }));

      const res = await client.patch('/offers/o1', { qty: 3 });

      expect(res.status).toBe(202);
      expect(res.data).toBeUndefined();
    });

    it('should return undefined data for an empty 204 body', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, status: 204 }));

      const res = await client.get('/offers/o1');

      expect(res.status).toBe(204);
      expect(res.data).toBeUndefined();
    });

    it('should reject a response body that exceeds the size ceiling', async () => {
      // A streamed body over the 8 MiB ceiling must be cut off and surfaced as
      // ErliNetworkException rather than buffered unbounded (DoS guard).
      const oversized = new Uint8Array(8 * 1024 * 1024 + 1);
      const streamed = {
        ok: true,
        status: 200,
        headers: { get: (): string | null => null },
        body: new ReadableStream<Uint8Array>({
          start(controller): void {
            controller.enqueue(oversized);
            controller.close();
          },
        }),
        text: (): Promise<string> => Promise.resolve(''),
      } as unknown as Response;
      fetchMock.mockResolvedValue(streamed);

      await expect(client.get('/offers/o1')).rejects.toBeInstanceOf(ErliNetworkException);
      // Direct (non-retryable) classification → single attempt.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should throw ErliNetworkException on an unparseable 200 body without in-client retry', async () => {
      // A 200 with a non-JSON body surfaces as ErliNetworkException directly (not
      // the internal RetryableHttpError marker), so the in-client loop does NOT
      // re-issue it — the host runner (D4) owns any retry of this classification.
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, status: 200, body: '<<not json>>' }));

      await expect(client.get('/offers/o1')).rejects.toBeInstanceOf(ErliNetworkException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('status classification', () => {
    it('should throw ErliAuthenticationException on 401 without retry', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 401 }));

      await expect(client.get('/offers')).rejects.toBeInstanceOf(ErliAuthenticationException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should throw ErliAuthenticationException on 403 without retry', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 403 }));

      await expect(client.get('/offers')).rejects.toBeInstanceOf(ErliAuthenticationException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should throw ErliApiException on a deterministic 400 without retry', async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: false, status: 400, body: '{"error":"bad"}' }),
      );

      await expect(client.get('/offers')).rejects.toBeInstanceOf(ErliApiException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should carry statusCode and responseBody on ErliApiException', async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: false, status: 422, body: '{"error":"invalid"}' }),
      );

      await expect(client.post('/offers', {}, { idempotent: false })).rejects.toMatchObject({
        statusCode: 422,
        responseBody: '{"error":"invalid"}',
      });
    });
  });

  describe('429 rate-limit retry', () => {
    it('should retry a 429 then succeed', async () => {
      fetchMock
        .mockResolvedValueOnce(fakeResponse({ ok: false, status: 429 }))
        .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{"ok":1}' }));

      const res = await client.get('/offers');

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should honor a numeric Retry-After header within the delay ceiling', async () => {
      // maxDelayMs well above the header value so it passes through unclamped.
      const honoringClient = new ErliHttpClient('conn-1', BASE_URL, API_KEY, {
        ...FAST_RETRY,
        maxDelayMs: 5000,
      });
      const sleepSpy = jest
        .spyOn(ErliHttpClient.prototype as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
        .mockResolvedValue(undefined);
      fetchMock
        .mockResolvedValueOnce(fakeResponse({ ok: false, status: 429, retryAfter: '2' }))
        .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{}' }));

      await honoringClient.get('/offers');

      expect(sleepSpy).toHaveBeenCalledWith(2000);
      sleepSpy.mockRestore();
    });

    it('should fall back to backoff (never NaN) on a malformed HTTP-date Retry-After', async () => {
      const sleepSpy = jest
        .spyOn(ErliHttpClient.prototype as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
        .mockResolvedValue(undefined);
      fetchMock
        .mockResolvedValueOnce(
          fakeResponse({ ok: false, status: 429, retryAfter: 'Wed, 21 Oct 2026 07:28:00 GMT' }),
        )
        .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{}' }));

      await client.get('/offers');

      const waited = sleepSpy.mock.calls[0][0];
      expect(Number.isFinite(waited)).toBe(true);
      expect(Number.isNaN(waited)).toBe(false);
      sleepSpy.mockRestore();
    });

    it('should clamp an absurd Retry-After to maxDelayMs', async () => {
      const sleepSpy = jest
        .spyOn(
          ErliHttpClient.prototype as unknown as { sleep: (ms: number) => Promise<void> },
          'sleep',
        )
        .mockResolvedValue(undefined);
      fetchMock
        .mockResolvedValueOnce(fakeResponse({ ok: false, status: 429, retryAfter: '999999999' }))
        .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{}' }));

      await client.get('/offers');

      // FAST_RETRY.maxDelayMs is 1 — the multi-year header must not reach setTimeout.
      expect(sleepSpy).toHaveBeenCalledWith(1);
      sleepSpy.mockRestore();
    });

    it('should throw ErliRateLimitException after exhausting the 429 retry budget', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 429, retryAfter: '1' }));

      await expect(client.get('/offers')).rejects.toBeInstanceOf(ErliRateLimitException);
      // maxRetries: 2 → 3 total attempts.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should clamp the Retry-After carried on the exhausted ErliRateLimitException', async () => {
      // The host RetryClassifier (D4) reads `retryAfterMs` off the escaping
      // exception — an absurd upstream header must be clamped before it escapes,
      // not just for the in-loop wait.
      const sleepSpy = jest
        .spyOn(
          ErliHttpClient.prototype as unknown as { sleep: (ms: number) => Promise<void> },
          'sleep',
        )
        .mockResolvedValue(undefined);
      fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 429, retryAfter: '999999999' }));

      // FAST_RETRY.maxDelayMs is 1 — the multi-year header must not survive onto the exception.
      await expect(client.get('/offers')).rejects.toMatchObject({ retryAfterMs: 1 });
      sleepSpy.mockRestore();
    });
  });

  describe('5xx / network retry branching (D3)', () => {
    it('should retry an idempotent GET 5xx then exhaust to ErliNetworkException', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 503 }));

      await expect(client.get('/offers')).rejects.toBeInstanceOf(ErliNetworkException);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should retry an idempotent GET network error then exhaust to ErliNetworkException', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));

      await expect(client.get('/offers')).rejects.toBeInstanceOf(ErliNetworkException);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should fail a non-idempotent POST 5xx IMMEDIATELY without retry', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 503 }));

      await expect(client.post('/offers', { sku: 'A' })).rejects.toBeInstanceOf(
        ErliNetworkException,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should fail a non-idempotent POST network error IMMEDIATELY without retry', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));

      await expect(client.post('/offers', { sku: 'A' })).rejects.toBeInstanceOf(
        ErliNetworkException,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should retry a POST flagged idempotent: true', async () => {
      fetchMock
        .mockResolvedValueOnce(fakeResponse({ ok: false, status: 503 }))
        .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{}' }));

      const res = await client.post('/offers', { sku: 'A' }, { idempotent: true });

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
