/**
 * KSeF auth handshake specs — challenge → submit → poll → redeem (ksef-token).
 *
 * Wire shapes reconciled to the authoritative KSeF 2.0 OpenAPI spec:
 * `AuthenticationInitResponse` (referenceNumber + authenticationToken),
 * `AuthenticationOperationStatusResponse` (status.code: 100 in-progress / 200
 * success), `AuthenticationTokensResponse` (accessToken/refreshToken nested
 * TokenInfo), redeem with no body + Bearer authenticationToken.
 *
 * @module libs/integrations/ksef/src/infrastructure/http/auth
 */
import {
  KsefAuthHandshakeService,
  type KsefTokenAuthMaterial,
} from '../ksef-auth-handshake.service';
import { KsefTokenEncryptor } from '../ksef-token-encryptor.service';
import type { MfPublicKeyCacheService } from '../../../crypto/mf-public-key-cache.service';
import { FakeKsefHttpClient } from '../../../../testing/fake-ksef-http-client';
import { KsefAuthenticationException } from '../../../../domain/exceptions/ksef-authentication.exception';
import { KsefHttpClient, type KsefTokenLifecycle } from '../../ksef-http-client';
import type { KsefHttpResponse } from '../../ksef-http-client.types';
import type { InitTokenAuthenticationRequest } from '../../ksef-auth.types';

function jwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.`;
}

function ok<T>(data: T): KsefHttpResponse<T> {
  return { data, status: 200, headers: {} };
}

/** `AuthenticationInitResponse` shape. */
function initResult(referenceNumber: string): {
  referenceNumber: string;
  authenticationToken: { token: string; validUntil: string };
} {
  return {
    referenceNumber,
    authenticationToken: { token: 'AUTH-TKN', validUntil: '2030-01-01T00:00:00Z' },
  };
}

/** `AuthenticationOperationStatusResponse` with a given status code. */
function status(code: number): { status: { code: number; description: string } } {
  return { status: { code, description: `status ${code}` } };
}

/** `AuthenticationTokensResponse` — nested TokenInfo. */
function tokens(expSeconds: number): {
  accessToken: { token: string; validUntil: string };
  refreshToken: { token: string; validUntil: string };
} {
  return {
    accessToken: { token: jwt(expSeconds), validUntil: '2030-01-01T00:00:00Z' },
    refreshToken: { token: jwt(expSeconds), validUntil: '2030-01-01T00:00:00Z' },
  };
}

const MATERIAL: KsefTokenAuthMaterial = {
  authType: 'ksef-token',
  token: 'TKN',
  contextNip: '1234567890',
};

const FAKE_INIT_REQUEST: InitTokenAuthenticationRequest = {
  challenge: 'CH',
  contextIdentifier: { type: 'Nip', value: '1234567890' },
  encryptedToken: 'CIPHER',
};

function encryptorStub(): KsefTokenEncryptor {
  const cache = {
    fetchAndCachePublicKey: jest.fn().mockResolvedValue({
      certificatePem: 'PEM',
      usage: ['KsefTokenEncryption'],
      validFrom: new Date(0),
      validTo: new Date(Date.now() + 1e9),
      certificateHash: 'h',
    }),
  } as unknown as MfPublicKeyCacheService;
  const encryptor = new KsefTokenEncryptor(cache);
  jest.spyOn(encryptor, 'buildInitRequest').mockResolvedValue(FAKE_INIT_REQUEST);
  return encryptor;
}

describe('KsefAuthHandshakeService', () => {
  it('should run challenge → submit → poll → redeem and return parsed tokens', async () => {
    const http = new FakeKsefHttpClient();
    const expSeconds = Math.floor((Date.now() + 3_600_000) / 1000);
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: '2026-06-23T12:00:00.000Z' }))
      .seed('POST', '/auth/ksef-token', ok(initResult('REF-1')))
      .seed('GET', '/auth/REF-1', ok(status(200)))
      .seed('POST', '/auth/token/redeem', ok(tokens(expSeconds)));

    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    const result = await service.authenticate(MATERIAL);

    expect(result.accessToken).toContain('.');
    expect(result.accessTokenExpiresAt.getTime()).toBe(expSeconds * 1000);
  });

  it('should authenticate the poll + redeem with the submit authenticationToken as Bearer', async () => {
    const http = new FakeKsefHttpClient();
    const expSeconds = Math.floor((Date.now() + 3_600_000) / 1000);
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: '2026-06-23T12:00:00.000Z' }))
      .seed('POST', '/auth/ksef-token', ok(initResult('REF-A')))
      .seed('GET', '/auth/REF-A', ok(status(200)))
      .seed('POST', '/auth/token/redeem', ok(tokens(expSeconds)));

    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    await service.authenticate(MATERIAL);

    const poll = http.calls.find((c) => c.method === 'GET' && c.path === '/auth/REF-A');
    const redeem = http.calls.find((c) => c.method === 'POST' && c.path === '/auth/token/redeem');
    expect(poll?.options?.headers?.Authorization).toBe('Bearer AUTH-TKN');
    expect(redeem?.options?.headers?.Authorization).toBe('Bearer AUTH-TKN');
    // Redeem carries no body (spec: redeem is body-less).
    expect(redeem?.body).toBeUndefined();
  });

  it('should throw KsefAuthenticationException when the reference reports a terminal failure code', async () => {
    const http = new FakeKsefHttpClient();
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: '2026-06-23T12:00:00.000Z' }))
      .seed('POST', '/auth/ksef-token', ok(initResult('REF-2')))
      .seed('GET', '/auth/REF-2', ok(status(450)));

    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    await expect(service.authenticate(MATERIAL)).rejects.toBeInstanceOf(KsefAuthenticationException);
  });

  it('should throw when the challenge is incomplete', async () => {
    const http = new FakeKsefHttpClient();
    http.seed('POST', '/auth/challenge', ok({ challenge: '', timestamp: '' }));
    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    await expect(service.authenticate(MATERIAL)).rejects.toBeInstanceOf(KsefAuthenticationException);
  });

  it('should throw when the submit returns no referenceNumber / authenticationToken', async () => {
    const http = new FakeKsefHttpClient();
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: '2026-06-23T12:00:00.000Z' }))
      .seed('POST', '/auth/ksef-token', ok({ referenceNumber: '', authenticationToken: { token: '', validUntil: '' } }));
    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    await expect(service.authenticate(MATERIAL)).rejects.toBeInstanceOf(KsefAuthenticationException);
  });

  it('should throw when redeem yields no access/refresh token', async () => {
    const http = new FakeKsefHttpClient();
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: '2026-06-23T12:00:00.000Z' }))
      .seed('POST', '/auth/ksef-token', ok(initResult('REF-3')))
      .seed('GET', '/auth/REF-3', ok(status(200)))
      .seed('POST', '/auth/token/redeem', ok({}));
    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    await expect(service.authenticate(MATERIAL)).rejects.toBeInstanceOf(KsefAuthenticationException);
  });

  it('should build the init request bound to the challenge + epoch-ms timestamp before submitting', async () => {
    const http = new FakeKsefHttpClient();
    const expSeconds = Math.floor((Date.now() + 3_600_000) / 1000);
    const timestamp = '2026-06-23T12:00:00.000Z';
    const timestampMs = Date.parse(timestamp);
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH-9', timestamp }))
      .seed('POST', '/auth/ksef-token', ok(initResult('REF-4')))
      .seed('GET', '/auth/REF-4', ok(status(200)))
      .seed('POST', '/auth/token/redeem', ok(tokens(expSeconds)));

    const encryptor = encryptorStub();
    const spy = jest.spyOn(encryptor, 'buildInitRequest');
    const service = new KsefAuthHandshakeService('conn-1', http, encryptor);
    await service.authenticate(MATERIAL);

    // token, contextNip, challenge, challengeTimestampMs — the challenge +
    // epoch-ms timestamp bind the ciphertext to this challenge window (replay
    // defence). MF reference encodes the timestamp as Unix milliseconds.
    expect(spy).toHaveBeenCalledWith('TKN', '1234567890', 'CH-9', String(timestampMs));
  });

  it('should prefer the server-supplied timestampMs over parsing the ISO timestamp', async () => {
    const http = new FakeKsefHttpClient();
    const expSeconds = Math.floor((Date.now() + 3_600_000) / 1000);
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH-9', timestamp: '2026-06-23T12:00:00.000Z', timestampMs: 1_750_680_000_000 }))
      .seed('POST', '/auth/ksef-token', ok(initResult('REF-6')))
      .seed('GET', '/auth/REF-6', ok(status(200)))
      .seed('POST', '/auth/token/redeem', ok(tokens(expSeconds)));

    const encryptor = encryptorStub();
    const spy = jest.spyOn(encryptor, 'buildInitRequest');
    const service = new KsefAuthHandshakeService('conn-1', http, encryptor);
    await service.authenticate(MATERIAL);

    expect(spy).toHaveBeenCalledWith('TKN', '1234567890', 'CH-9', '1750680000000');
  });

  it('should throw KsefAuthenticationException when the challenge timestamp is unparseable', async () => {
    const http = new FakeKsefHttpClient();
    http.seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: 'not-a-date' }));
    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    await expect(service.authenticate(MATERIAL)).rejects.toBeInstanceOf(KsefAuthenticationException);
  });

  it('should NOT trigger a second /auth/challenge when /auth/token/redeem returns 401 (AU1)', async () => {
    // Wire the REAL KsefHttpClient (so the reactive-401 path is live) with a
    // lifecycle whose refresh re-runs the handshake — the recursion the
    // noReactiveRefresh flag must prevent. redeem returns 401; the handshake must
    // fail terminally without re-entering /auth/challenge.
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    const realFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const jsonResponse = (status: number, body: unknown): Response =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });

      // challenge → ksef-token → poll(200) → redeem(401). The challenge is seeded
      // for exactly ONE response; a nested re-handshake would request it again and
      // (since it's not re-seeded) change the call count below.
      fetchMock.mockImplementation((input: unknown) => {
        const url = String(input);
        if (url.endsWith('/auth/challenge')) {
          return Promise.resolve(jsonResponse(200, { challenge: 'CH', timestamp: '2026-06-23T12:00:00.000Z' }));
        }
        if (url.endsWith('/auth/ksef-token')) {
          return Promise.resolve(jsonResponse(200, initResult('REF-401')));
        }
        if (url.endsWith('/auth/REF-401')) {
          return Promise.resolve(jsonResponse(200, status(200)));
        }
        if (url.endsWith('/auth/token/redeem')) {
          return Promise.resolve(jsonResponse(401, { error: 'authenticationToken rejected' }));
        }
        return Promise.resolve(jsonResponse(404, { error: `unexpected ${url}` }));
      });

      const lifecycle: KsefTokenLifecycle = {
        // refresh re-runs the handshake — exactly the nested-handshake path AU1
        // guards against. If reactive refresh fired on the redeem 401, this would
        // be invoked and hit /auth/challenge a second time.
        authenticate: jest.fn(),
        refresh: jest.fn(),
      };
      const httpClient = new KsefHttpClient(
        'conn-1',
        'https://api-test.ksef.mf.gov.pl/v2',
        lifecycle,
      );
      const service = new KsefAuthHandshakeService('conn-1', httpClient, encryptorStub());
      (lifecycle.refresh as jest.Mock).mockImplementation(() => service.authenticate(MATERIAL));

      await expect(service.authenticate(MATERIAL)).rejects.toBeInstanceOf(KsefAuthenticationException);

      const challengeCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/challenge'));
      expect(challengeCalls).toHaveLength(1);
      expect(lifecycle.refresh).not.toHaveBeenCalled();
    } finally {
      global.fetch = realFetch;
    }
  });

  it('should treat status code 200 as ready and redeem', async () => {
    const http = new FakeKsefHttpClient();
    const expSeconds = Math.floor((Date.now() + 3_600_000) / 1000);
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: '2026-06-23T12:00:00.000Z' }))
      .seed('POST', '/auth/ksef-token', ok(initResult('REF-5')))
      .seed('GET', '/auth/REF-5', ok(status(200)))
      .seed('POST', '/auth/token/redeem', ok(tokens(expSeconds)));

    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    const result = await service.authenticate(MATERIAL);
    expect(result.refreshToken).toContain('.');
    expect(http.calls.some((c) => c.method === 'GET' && c.path === '/auth/REF-5')).toBe(true);
    expect(http.calls.some((c) => c.method === 'POST' && c.path === '/auth/token/redeem')).toBe(true);
  });
});
