import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';

import { EparagonyApiError } from '../../../domain/exceptions/eparagony-api.error';
import { EparagonyConfigException } from '../../../domain/exceptions/eparagony-config.exception';
import { EparagonyNetworkError } from '../../../domain/exceptions/eparagony-network.error';
import { EparagonyHttpClient } from '../eparagony-http-client';

const logger: LoggerPort = {
  log: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const CONFIG = {
  connectionId: 'conn-1',
  apiBaseUrl: 'https://sandbox.eparagony.pl',
  authBaseUrl: 'https://login.sandbox.eparagony.pl',
  clientId: 'client-id-placeholder',
  clientSecret: 'client-secret-placeholder',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function tokenBody(accessToken = 'token-1', expiresIn = 3600): Record<string, unknown> {
  return { access_token: accessToken, token_type: 'bearer', expires_in: expiresIn };
}

/** Builds a fetch double that answers the token host, then the API host. */
function makeFetch(handlers: Array<(url: string, init?: RequestInit) => Response>): jest.Mock {
  let index = 0;
  return jest.fn().mockImplementation((url: string, init?: RequestInit): Promise<Response> => {
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    return Promise.resolve(handler(url, init));
  });
}

function makeClient(fetchImpl: jest.Mock, overrides: Partial<typeof CONFIG> = {}): EparagonyHttpClient {
  return new EparagonyHttpClient(
    { ...CONFIG, ...overrides },
    logger,
    fetchImpl as unknown as FetchLike,
    { maxRetries: 1, initialDelayMs: 1, backoffMultiplier: 1, maxDelayMs: 2 },
  );
}

describe('EparagonyHttpClient', () => {
  describe('token lifecycle', () => {
    it('should request a token from the OAuth host, not the API host', async () => {
      const fetchImpl = makeFetch([
        (): Response => jsonResponse(200, tokenBody()),
        (): Response => jsonResponse(200, { ok: true }),
      ]);
      await makeClient(fetchImpl).get('documents/x/status');

      const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(tokenUrl).toBe('https://login.sandbox.eparagony.pl/auth/token');
      expect(String(tokenInit.body)).toContain('grant_type=client_credentials');
    });

    it('should request only the scopes OpenLinker is actually granted', async () => {
      const fetchImpl = makeFetch([
        (): Response => jsonResponse(200, tokenBody()),
        (): Response => jsonResponse(200, {}),
      ]);
      await makeClient(fetchImpl).get('documents/x/status');

      const body = String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body);
      expect(body).toContain('document_create');
      expect(body).toContain('printer_get');
      expect(body).toContain('ecommerce');
      // Requesting a refused scope fails the WHOLE token request, so these must
      // never be asked for.
      expect(body).not.toContain('document_get_jws');
      expect(body).not.toContain('report_fiscal_get');
    });

    it('should reuse a cached token across calls when it has not expired', async () => {
      const fetchImpl = makeFetch([
        (): Response => jsonResponse(200, tokenBody()),
        (): Response => jsonResponse(200, {}),
      ]);
      const client = makeClient(fetchImpl);
      await client.get('documents/a/status');
      await client.get('documents/b/status');

      const tokenCalls = fetchImpl.mock.calls.filter(
        ([url]) => String(url).includes('/auth/token'),
      );
      expect(tokenCalls).toHaveLength(1);
    });

    it('should issue one token request when concurrent calls race for a token', async () => {
      const fetchImpl = makeFetch([
        (): Response => jsonResponse(200, tokenBody()),
        (): Response => jsonResponse(200, {}),
      ]);
      const client = makeClient(fetchImpl);
      await Promise.all([client.get('documents/a/status'), client.get('documents/b/status')]);

      const tokenCalls = fetchImpl.mock.calls.filter(
        ([url]) => String(url).includes('/auth/token'),
      );
      expect(tokenCalls).toHaveLength(1);
    });

    it('should fetch a new token when the cached one has expired', async () => {
      // A one-second lifetime is fully inside the refresh margin, so the cached
      // token is treated as already due.
      const fetchImpl = makeFetch([
        (url): Response => (url.includes('/auth/token') ? jsonResponse(200, tokenBody('t', 1)) : jsonResponse(200, {})),
      ]);
      const client = makeClient(fetchImpl);
      await client.get('documents/a/status');
      await client.get('documents/b/status');

      const tokenCalls = fetchImpl.mock.calls.filter(
        ([url]) => String(url).includes('/auth/token'),
      );
      expect(tokenCalls).toHaveLength(2);
    });

    it('should tolerate a missing expires_in rather than failing the call', async () => {
      const fetchImpl = makeFetch([
        (url): Response =>
          url.includes('/auth/token')
            ? jsonResponse(200, { access_token: 'tok' })
            : jsonResponse(200, { ok: true }),
      ]);
      await expect(makeClient(fetchImpl).get('documents/x/status')).resolves.toMatchObject({
        status: 200,
      });
    });

    it('should refresh once and retry when an API call returns 401 mid-session', async () => {
      let apiCalls = 0;
      const fetchImpl = jest.fn().mockImplementation((url: string): Promise<Response> => {
        if (String(url).includes('/auth/token')) {
          return Promise.resolve(jsonResponse(200, tokenBody()));
        }
        apiCalls += 1;
        return Promise.resolve(
          apiCalls === 1 ? jsonResponse(401, { statusCode: 401 }) : jsonResponse(200, { ok: true }),
        );
      });

      await expect(makeClient(fetchImpl).get('documents/x/status')).resolves.toMatchObject({
        status: 200,
      });
      const tokenCalls = fetchImpl.mock.calls.filter(
        ([url]) => String(url).includes('/auth/token'),
      );
      expect(tokenCalls).toHaveLength(2);
    });
  });

  describe('headers', () => {
    it('should send the documented version and a non-generic user agent', async () => {
      const fetchImpl = makeFetch([
        (): Response => jsonResponse(200, tokenBody()),
        (): Response => jsonResponse(200, {}),
      ]);
      await makeClient(fetchImpl).get('documents/x/status');

      const headers = (fetchImpl.mock.calls[1] as [string, RequestInit])[1].headers as Record<
        string,
        string
      >;
      expect(headers['X-Api-Version']).toBe('3');
      expect(headers['User-Agent']).toContain('OpenLinker');
      expect(headers.Authorization).toBe('Bearer token-1');
    });

    it('should omit the integration id header when the connection declares none', async () => {
      const fetchImpl = makeFetch([
        (): Response => jsonResponse(200, tokenBody()),
        (): Response => jsonResponse(200, {}),
      ]);
      await makeClient(fetchImpl).get('documents/x/status');

      const headers = (fetchImpl.mock.calls[1] as [string, RequestInit])[1].headers as Record<
        string,
        string
      >;
      expect(headers['X-Integration-Id']).toBeUndefined();
    });

    it('should not let a caller header override the bearer token', async () => {
      const fetchImpl = makeFetch([
        (): Response => jsonResponse(200, tokenBody()),
        (): Response => jsonResponse(200, {}),
      ]);
      await makeClient(fetchImpl).get('documents/x/status', {
        headers: { Authorization: 'Bearer attacker' },
      });

      const headers = (fetchImpl.mock.calls[1] as [string, RequestInit])[1].headers as Record<
        string,
        string
      >;
      expect(headers.Authorization).toBe('Bearer token-1');
    });
  });

  describe('error mapping', () => {
    it('should classify a deterministic 4xx as rejected', async () => {
      const fetchImpl = makeFetch([
        (url): Response =>
          url.includes('/auth/token')
            ? jsonResponse(200, tokenBody())
            : jsonResponse(400, { statusCode: 400, errorCode: 41 }),
      ]);
      await expect(makeClient(fetchImpl).get('documents/x/status')).rejects.toMatchObject({
        failureMode: 'rejected',
        errorCode: 41,
      });
    });

    it('should carry an undocumented error code without throwing on the parse', async () => {
      // The published list documents 100 for a missing document; live probing
      // returned 92. Neither may be treated as a closed set.
      const fetchImpl = makeFetch([
        (url): Response =>
          url.includes('/auth/token')
            ? jsonResponse(200, tokenBody())
            : jsonResponse(400, { statusCode: 400, errorCode: 92, unexpected: 'field' }),
      ]);
      await expect(makeClient(fetchImpl).get('documents/x/status')).rejects.toMatchObject({
        errorCode: 92,
      });
    });

    it('should tolerate a non-JSON error body when the vendor answers with plain text', async () => {
      const fetchImpl = makeFetch([
        (url): Response =>
          url.includes('/auth/token')
            ? jsonResponse(200, tokenBody())
            : new Response('upstream said no', { status: 400 }),
      ]);
      const error = await makeClient(fetchImpl)
        .get('documents/x/status')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EparagonyApiError);
      expect((error as EparagonyApiError).errorCode).toBeNull();
    });

    it('should classify an exhausted 5xx retry budget as in-doubt', async () => {
      const fetchImpl = makeFetch([
        (url): Response =>
          url.includes('/auth/token')
            ? jsonResponse(200, tokenBody())
            : jsonResponse(503, { statusCode: 503 }),
      ]);
      await expect(makeClient(fetchImpl).get('documents/x/status')).rejects.toMatchObject({
        failureMode: 'in-doubt',
      });
    });

    it('should classify a network failure as in-doubt', async () => {
      const fetchImpl = jest.fn().mockImplementation((url: string): Promise<Response> => {
        if (String(url).includes('/auth/token')) {
          return Promise.resolve(jsonResponse(200, tokenBody()));
        }
        return Promise.reject(new Error('ECONNRESET'));
      });
      await expect(makeClient(fetchImpl).get('documents/x/status')).rejects.toBeInstanceOf(
        EparagonyNetworkError,
      );
    });

    it('should not retry a non-idempotent POST on a server error', async () => {
      let apiCalls = 0;
      const fetchImpl = jest.fn().mockImplementation((url: string): Promise<Response> => {
        if (String(url).includes('/auth/token')) {
          return Promise.resolve(jsonResponse(200, tokenBody()));
        }
        apiCalls += 1;
        return Promise.resolve(jsonResponse(503, { statusCode: 503 }));
      });
      await expect(makeClient(fetchImpl).post('documents', {})).rejects.toBeInstanceOf(
        EparagonyApiError,
      );
      expect(apiCalls).toBe(1);
    });

    it('should retry a POST flagged idempotent on a server error', async () => {
      let apiCalls = 0;
      const fetchImpl = jest.fn().mockImplementation((url: string): Promise<Response> => {
        if (String(url).includes('/auth/token')) {
          return Promise.resolve(jsonResponse(200, tokenBody()));
        }
        apiCalls += 1;
        return Promise.resolve(
          apiCalls === 1 ? jsonResponse(503, {}) : jsonResponse(202, { ok: true }),
        );
      });
      await expect(
        makeClient(fetchImpl).post('documents', {}, { idempotent: true }),
      ).resolves.toMatchObject({ status: 202 });
      expect(apiCalls).toBe(2);
    });
  });

  describe('host safety', () => {
    it('should refuse a non-https base URL at construction', () => {
      expect(() =>
        makeClient(makeFetch([]), { apiBaseUrl: 'http://sandbox.eparagony.pl' }),
      ).toThrow(EparagonyConfigException);
    });

    it('should refuse an absolute path that resolves outside the configured host', async () => {
      const fetchImpl = makeFetch([(): Response => jsonResponse(200, tokenBody())]);
      await expect(
        makeClient(fetchImpl).get('https://evil.example.com/steal'),
      ).rejects.toBeInstanceOf(EparagonyConfigException);
    });

    it('should neutralize a protocol-relative path rather than retarget the origin', async () => {
      const fetchImpl = makeFetch([
        (): Response => jsonResponse(200, tokenBody()),
        (): Response => jsonResponse(200, {}),
      ]);
      await makeClient(fetchImpl).get('//evil.example.com/steal');

      const [apiUrl] = fetchImpl.mock.calls[1] as [string];
      expect(apiUrl.startsWith('https://sandbox.eparagony.pl/')).toBe(true);
    });
  });
});
