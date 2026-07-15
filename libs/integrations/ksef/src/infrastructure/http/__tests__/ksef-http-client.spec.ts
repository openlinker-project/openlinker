/**
 * KSeF HTTP client specs — token lifecycle, 401 refresh, retries, rate limit.
 *
 * `fetch` is mocked globally; the token lifecycle is a stub so the test asserts
 * the client's orchestration (bearer injection, lazy handshake, reactive 401,
 * retry policy) without real HTTP.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
import { KsefHttpClient, type KsefTokenLifecycle } from '../ksef-http-client';
import type { KsefAuthenticationToken } from '../ksef-http-client.types';
import { KsefAuthenticationException } from '../../../domain/exceptions/ksef-authentication.exception';
import { KsefApiException } from '../../../domain/exceptions/ksef-api.exception';
import { KsefPermissionDeniedException } from '../../../domain/exceptions/ksef-permission-denied.exception';
import { KsefNetworkException } from '../../../domain/exceptions/ksef-network.exception';

function token(expiresInMs = 3_600_000, accessToken = 'access-token'): KsefAuthenticationToken {
  return {
    accessToken,
    refreshToken: 'refresh-token',
    accessTokenExpiresAt: new Date(Date.now() + expiresInMs),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('KsefHttpClient', () => {
  const baseUrl = 'https://api-test.ksef.mf.gov.pl/v2';
  let fetchMock: jest.MockedFunction<typeof fetch>;
  let lifecycle: KsefTokenLifecycle;

  beforeEach(() => {
    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock as unknown as typeof fetch;
    lifecycle = {
      authenticate: jest.fn().mockResolvedValue(token()),
      refresh: jest.fn().mockResolvedValue(token()),
    };
  });

  it('should lazily run the handshake and inject the bearer on the first authed GET', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

    const res = await client.get('/sessions/online');

    expect(lifecycle.authenticate).toHaveBeenCalledTimes(1);
    expect(res.data).toEqual({ ok: true });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
  });

  it('should NOT inject a bearer when skipAuth is set (unauthenticated bootstrap calls)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { challenge: 'c', timestamp: 't' }));
    const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

    await client.post('/auth/challenge', undefined, { idempotent: true, skipAuth: true });

    expect(lifecycle.authenticate).not.toHaveBeenCalled();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('should run the handshake + inject a bearer for an /auth path without skipAuth', async () => {
    // Path-prefix inference is gone: a future authenticated /auth/* sub-resource
    // must NOT be silently bypassed — it goes through the normal auth path.
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

    await client.get('/auth/sessions');

    expect(lifecycle.authenticate).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
  });

  it('should refresh once and retry on a reactive 401, then succeed', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

    const res = await client.get('/sessions/online');

    expect(lifecycle.refresh).toHaveBeenCalledTimes(1);
    expect(res.data).toEqual({ ok: true });
  });

  it('should throw KsefAuthenticationException when refresh is rejected on 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'invalid' }));
    (lifecycle.refresh as jest.Mock).mockRejectedValue(new Error('credential rejected'));
    const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

    await expect(client.get('/sessions/online')).rejects.toBeInstanceOf(KsefAuthenticationException);
  });

  it('should fail fast on a deterministic 400 without retrying', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'bad request' }));
    const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

    await expect(client.get('/sessions/online')).rejects.toBeInstanceOf(KsefApiException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should not retry a non-idempotent POST on 500', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'server' }));
    const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

    await expect(client.post('/sessions', { x: 1 })).rejects.toBeInstanceOf(KsefApiException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('proactive refresh (refresh-on-exp)', () => {
    it('should proactively refresh when the cached token is inside the refresh window', async () => {
      // Handshake yields a token already within the 60s proactive-refresh window
      // (expires in 30s), so the next authed request must rotate it pre-flight.
      (lifecycle.authenticate as jest.Mock).mockResolvedValue(token(30_000, 'stale-token'));
      (lifecycle.refresh as jest.Mock).mockResolvedValue(token(3_600_000, 'fresh-token'));
      // Fresh Response per call — a `fetch` Response body can only be read once,
      // and these specs issue two requests against the same mock.
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { ok: true })));
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

      // First call runs the handshake and caches the (already-stale) token...
      await client.get('/sessions/online');
      // ...the second call sees it inside the refresh window and rotates first.
      await client.get('/sessions/online');

      expect(lifecycle.refresh).toHaveBeenCalledTimes(1);
      const lastInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
      expect((lastInit.headers as Record<string, string>).Authorization).toBe('Bearer fresh-token');
    });

    it('should NOT refresh while the cached token is comfortably before the refresh window', async () => {
      (lifecycle.authenticate as jest.Mock).mockResolvedValue(token(3_600_000, 'fresh-token'));
      // Fresh Response per call — a `fetch` Response body can only be read once,
      // and these specs issue two requests against the same mock.
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { ok: true })));
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

      await client.get('/sessions/online');
      await client.get('/sessions/online');

      expect(lifecycle.authenticate).toHaveBeenCalledTimes(1);
      expect(lifecycle.refresh).not.toHaveBeenCalled();
    });

    it('should fall back to the reactive path when proactive refresh throws', async () => {
      // Token is inside the refresh window; the proactive refresh fails, but the
      // request must still proceed with the existing token (which the server
      // then accepts), rather than failing pre-flight.
      (lifecycle.authenticate as jest.Mock).mockResolvedValue(token(30_000, 'stale-token'));
      (lifecycle.refresh as jest.Mock).mockRejectedValue(new Error('refresh endpoint down'));
      // Fresh Response per call — a `fetch` Response body can only be read once,
      // and these specs issue two requests against the same mock.
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { ok: true })));
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

      await client.get('/sessions/online');
      const res = await client.get('/sessions/online');

      expect(res.data).toEqual({ ok: true });
      const lastInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
      // Proactive refresh failed → the stale token is still used (reactive 401
      // would handle a true rejection on the wire).
      expect((lastInit.headers as Record<string, string>).Authorization).toBe('Bearer stale-token');
    });
  });

  describe('reactive 401 → network-failure refresh', () => {
    it('should map a network-failure refresh to a retryable KsefNetworkException', async () => {
      fetchMock.mockResolvedValue(jsonResponse(401, { error: 'expired' }));
      (lifecycle.refresh as jest.Mock).mockRejectedValue(
        new KsefNetworkException('auth endpoint unreachable'),
      );
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

      await expect(client.get('/sessions/online')).rejects.toBeInstanceOf(KsefNetworkException);
    });

    it('should throw KsefAuthenticationException WITHOUT reactive refresh when noReactiveRefresh is set', async () => {
      // A 401 on a handshake-internal call (poll/redeem) must NOT re-enter the
      // reactive-refresh path — which would re-run the handshake (nested). With
      // noReactiveRefresh it fails terminally and the refresh callback is untouched.
      fetchMock.mockResolvedValue(jsonResponse(401, { error: 'token rejected' }));
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

      await expect(
        client.post('/auth/token/redeem', undefined, {
          skipAuth: true,
          headers: { Authorization: 'Bearer AUTH-TKN' },
          noReactiveRefresh: true,
        }),
      ).rejects.toBeInstanceOf(KsefAuthenticationException);
      expect(lifecycle.refresh).not.toHaveBeenCalled();
      expect(lifecycle.authenticate).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should fail fast on a 403 as a non-retryable KsefPermissionDeniedException without refreshing', async () => {
      // 403 is an authorization decision, not an expired token — refreshing
      // can never change the outcome, so the client must not refresh+retry. It is
      // surfaced DISTINCTLY as a permission-denied (least-privilege) signal while
      // remaining a KsefApiException subclass (retry classification unchanged).
      fetchMock.mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

      const error = await client.get('/sessions/online').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(KsefPermissionDeniedException);
      expect(error).toBeInstanceOf(KsefApiException);
      expect((error as KsefPermissionDeniedException).statusCode).toBe(403);
      expect(lifecycle.refresh).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('rate limiting + transport', () => {
    it('should back off on 429 then succeed on a retried idempotent GET', async () => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'slow down' }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '0' },
          }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

      const res = await client.get('/sessions/online');

      expect(res.data).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should carry the parsed Retry-After delay on the 429 KsefApiException when retries are exhausted', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: 'slow down' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '2' },
        }),
      );
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle, {
        maxRetries: 0,
        initialDelayMs: 1,
        maxDelayMs: 1,
        backoffMultiplier: 1,
      });

      await expect(client.get('/sessions/online')).rejects.toMatchObject({
        name: 'KsefApiException',
        statusCode: 429,
        retryAfterMs: 2000,
      });
    });

    it('should retry an idempotent GET on a transient 503 then succeed', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(503, { error: 'unavailable' }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle, {
        maxRetries: 2,
        initialDelayMs: 1,
        maxDelayMs: 2,
        backoffMultiplier: 2,
      });

      const res = await client.get('/sessions/online');

      expect(res.data).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should surface a fetch network error as a KsefNetworkException', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle, {
        maxRetries: 0,
        initialDelayMs: 1,
        maxDelayMs: 1,
        backoffMultiplier: 1,
      });

      await expect(client.get('/sessions/online')).rejects.toBeInstanceOf(KsefNetworkException);
    });

    it('should surface an aborted request (timeout) as a KsefNetworkException', async () => {
      // The client wraps each call in an AbortController with a request timeout;
      // when fetch rejects with an AbortError the client maps it to a network
      // exception. Simulate that by having fetch reject with an AbortError.
      const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
      fetchMock.mockRejectedValue(abortErr);
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle, {
        maxRetries: 0,
        initialDelayMs: 1,
        maxDelayMs: 1,
        backoffMultiplier: 1,
      });

      await expect(client.get('/sessions/online')).rejects.toBeInstanceOf(KsefNetworkException);
    });

    it('should read a binary success response through postExpectingBinary', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
      fetchMock.mockResolvedValue(
        new Response(pdfBytes, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      );
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

      const res = await client.postExpectingBinary('/sessions/REF/upo', { x: 1 }, { idempotent: true });

      expect(res.contentType).toBe('application/pdf');
      expect(Array.from(res.data)).toEqual(Array.from(pdfBytes));
    });

    it('should reject a binary response whose Content-Length exceeds the cap before reading', async () => {
      const oversizedLength = 10 * 1024 * 1024 + 1;
      const arrayBuffer = jest.fn();
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/pdf', 'content-length': String(oversizedLength) }),
        arrayBuffer,
      } as unknown as Response);
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

      await expect(client.getExpectingBinary('/sessions/REF/upo')).rejects.toBeInstanceOf(
        KsefApiException,
      );
      // The body is never read when Content-Length already exceeds the cap.
      expect(arrayBuffer).not.toHaveBeenCalled();
    });

    it('should reject a binary response whose actual byte length exceeds the cap when Content-Length is absent', async () => {
      const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
      fetchMock.mockResolvedValue(
        new Response(oversized, { status: 200, headers: { 'content-type': 'application/pdf' } }),
      );
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

      await expect(client.getExpectingBinary('/sessions/REF/upo')).rejects.toBeInstanceOf(
        KsefApiException,
      );
    });

    it('should throw KsefApiException on a non-JSON success body for a JSON call', async () => {
      fetchMock.mockResolvedValue(
        new Response('not-json{', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
      const client = new KsefHttpClient('conn-1', baseUrl, lifecycle);

      await expect(client.get('/sessions/online')).rejects.toBeInstanceOf(KsefApiException);
    });
  });
});
