/**
 * KSeF connection tester specs — validation branches + handshake delegation.
 *
 * The actual `challenge → submit → poll → redeem` sequence (real crypto/HTTP
 * wiring) is already covered by `ksef-auth-handshake.service.spec.ts` (unit,
 * `FakeKsefHttpClient`) and `ksef-auth-handshake.int-spec.ts` (real sandbox).
 * This spec mocks `createKsefHttpClient` so it can focus on the tester's own
 * logic: config/credential validation short-circuits, and mapping the
 * handshake's outcome (or thrown exception) onto `ConnectionTestResult`.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import { Connection } from '@openlinker/core/identifier-mapping';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { KsefConnectionTesterAdapter } from '../ksef-connection-tester.adapter';
import { KsefAuthenticationException } from '../../../domain/exceptions/ksef-authentication.exception';
import { KsefConfigException } from '../../../domain/exceptions/ksef-config.exception';
import { KsefSessionCryptoException } from '../../../domain/exceptions/ksef-session-crypto.exception';
import * as httpClientFactory from '../../http/ksef-http-client.factory';

jest.mock('../../http/ksef-http-client.factory');

/** The connection-bound transport `forConnection` hands back (#1810). */
const boundFetch = jest.fn();
const http: jest.Mocked<HttpTransportFactoryPort> = {
  forConnection: jest.fn().mockReturnValue(boundFetch),
  evict: jest.fn(),
};

const SELLER_CONFIG = {
  nip: '1234567890',
  name: 'Acme Sp. z o.o.',
  address: {
    line1: 'ul. Testowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    countryIso2: 'PL',
  },
};

function connection(opts: { config?: Record<string, unknown>; credentialsRef?: string } = {}): Connection {
  return new Connection(
    'conn-1',
    'ksef',
    'KSeF',
    'active',
    opts.config ?? { env: 'test', seller: SELLER_CONFIG },
    opts.credentialsRef ?? 'ref:ksef',
    new Date(),
    new Date(),
    undefined,
    [],
  );
}

function resolver(map: Record<string, unknown>): CredentialsResolverPort {
  return {
    get: <T>(ref: string): Promise<T> => {
      if (!(ref in map)) {
        return Promise.reject(new Error(`no secret for ${ref}`));
      }
      return Promise.resolve(map[ref] as T);
    },
  };
}

describe('KsefConnectionTesterAdapter', () => {
  const createKsefHttpClientMock = httpClientFactory.createKsefHttpClient as jest.MockedFunction<
    typeof httpClientFactory.createKsefHttpClient
  >;

  beforeEach(() => {
    createKsefHttpClientMock.mockReset();
    http.forConnection.mockClear();
  });

  it('should fail fast when the connection has no valid environment', async () => {
    const adapter = new KsefConnectionTesterAdapter(http);
    const result = await adapter.test(
      connection({ config: { seller: SELLER_CONFIG } }),
      resolver({ 'ref:ksef': { authType: 'ksef-token', secret: 'tok' } }),
    );
    expect(result).toMatchObject({ success: false, message: expect.stringContaining('environment') });
    expect(createKsefHttpClientMock).not.toHaveBeenCalled();
  });

  it('should fail fast when the connection has no stored credentials', async () => {
    const adapter = new KsefConnectionTesterAdapter(http);
    const result = await adapter.test(connection({ credentialsRef: '' }), resolver({}));
    expect(result).toMatchObject({
      success: false,
      message: 'Connection has no stored credentials',
    });
  });

  it('should fail fast when credentials are missing authType or secret', async () => {
    const adapter = new KsefConnectionTesterAdapter(http);
    const result = await adapter.test(connection(), resolver({ 'ref:ksef': { authType: 'ksef-token' } }));
    expect(result).toMatchObject({ success: false, message: expect.stringContaining('authType') });
  });

  it('should report qualified-seal as not yet supported, without attempting a handshake', async () => {
    const adapter = new KsefConnectionTesterAdapter(http);
    const result = await adapter.test(
      connection(),
      resolver({ 'ref:ksef': { authType: 'qualified-seal', secret: 'cert-ref' } }),
    );
    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining('qualified-seal'),
    });
    expect(createKsefHttpClientMock).not.toHaveBeenCalled();
  });

  it('should fail fast when the seller NIP is missing (no session context identifier)', async () => {
    const adapter = new KsefConnectionTesterAdapter(http);
    const result = await adapter.test(
      connection({ config: { env: 'test' } }),
      resolver({ 'ref:ksef': { authType: 'ksef-token', secret: 'tok' } }),
    );
    expect(result).toMatchObject({ success: false, message: expect.stringContaining('seller NIP') });
  });

  it('should report success when the handshake authenticates', async () => {
    const authenticate = jest.fn().mockResolvedValue({
      accessToken: 'acc',
      refreshToken: 'ref',
      accessTokenExpiresAt: new Date(),
    });
    createKsefHttpClientMock.mockReturnValue({
      httpClient: {} as never,
      publicKeyCache: {} as never,
      handshake: { authenticate } as never,
    });

    const adapter = new KsefConnectionTesterAdapter(http);
    const result = await adapter.test(
      connection(),
      resolver({ 'ref:ksef': { authType: 'ksef-token', secret: 'super-secret-token' } }),
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('authenticated');
    expect(authenticate).toHaveBeenCalledWith({
      authType: 'ksef-token',
      token: 'super-secret-token',
      contextNip: '1234567890',
    });
  });

  describe('issuance-permission probe (DEF-17)', () => {
    function withGrants(post: jest.Mock): KsefConnectionTesterAdapter {
      createKsefHttpClientMock.mockReturnValue({
        httpClient: { post } as never,
        publicKeyCache: {} as never,
        handshake: { authenticate: jest.fn().mockResolvedValue({}) } as never,
      });
      return new KsefConnectionTesterAdapter(http);
    }
    const creds = resolver({ 'ref:ksef': { authType: 'ksef-token', secret: 't' } });

    it('should say the token may issue when KSeF lists InvoiceWrite', async () => {
      const post = jest.fn().mockResolvedValue({
        data: { permissions: [{ permissionScope: 'InvoiceWrite' }], hasMore: false },
      });

      const result = await withGrants(post).test(connection(), creds);

      expect(result).toMatchObject({ success: true, message: expect.stringContaining('may issue') });
      expect(post).toHaveBeenCalledWith(
        '/permissions/query/personal/grants',
        expect.objectContaining({ permissionTypes: ['InvoiceWrite'] }),
        expect.objectContaining({ idempotent: true }),
      );
    });

    it('should count an owner grant as permission to issue', async () => {
      const post = jest.fn().mockResolvedValue({
        data: { permissions: [], ownerPermissions: ['InvoiceWrite'], hasMore: false },
      });

      const result = await withGrants(post).test(connection(), creds);

      expect(result.message).toContain('may issue');
    });

    it('should not read an empty grants list as a missing permission', async () => {
      // A token's own scope is not in the grants list: an owner's token came
      // back empty there on KSeF TEST while it issued fine.
      const post = jest.fn().mockResolvedValue({ data: { permissions: [], hasMore: false } });

      const result = await withGrants(post).test(connection(), creds);

      expect(result.success).toBe(true);
      expect(result.message).toContain('not verified');
    });

    describe("from the token's own status", () => {
      const tokenCreds = resolver({
        'ref:ksef': { authType: 'ksef-token', secret: '20261022-EC-AAAA-BBBB-51|nip-1234563218|secret' },
      });
      function withTokenStatus(get: jest.Mock, post = jest.fn()): KsefConnectionTesterAdapter {
        createKsefHttpClientMock.mockReturnValue({
          httpClient: { get, post } as never,
          publicKeyCache: {} as never,
          handshake: { authenticate: jest.fn().mockResolvedValue({}) } as never,
        });
        return new KsefConnectionTesterAdapter(http);
      }

      it('should read the reference from the token and trust its permission list', async () => {
        const get = jest.fn().mockResolvedValue({ data: { requestedPermissions: ['InvoiceRead', 'InvoiceWrite'] } });
        const post = jest.fn();

        const result = await withTokenStatus(get, post).test(connection(), tokenCreds);

        expect(result.message).toContain('may issue');
        expect(get).toHaveBeenCalledWith('/tokens/20261022-EC-AAAA-BBBB-51', expect.anything());
        expect(post).not.toHaveBeenCalled();
      });

      it('should warn when the token itself lacks InvoiceWrite', async () => {
        const get = jest.fn().mockResolvedValue({ data: { requestedPermissions: ['InvoiceRead'] } });

        const result = await withTokenStatus(get).test(connection(), tokenCreds);

        expect(result.success).toBe(true);
        expect(result.message).toContain('InvoiceWrite');
      });

      it('should fall back to the grants query when the status read fails', async () => {
        const get = jest.fn().mockRejectedValue(new Error('404'));
        const post = jest.fn().mockResolvedValue({
          data: { permissions: [{ permissionScope: 'InvoiceWrite' }], hasMore: false },
        });

        const result = await withTokenStatus(get, post).test(connection(), tokenCreds);

        expect(result.message).toContain('may issue');
      });
    });

    it('should say the check was not verified when the query fails', async () => {
      const post = jest.fn().mockRejectedValue(new Error('403'));

      const result = await withGrants(post).test(connection(), creds);

      expect(result.success).toBe(true);
      expect(result.message).toContain('not verified');
    });
  });

  it('should probe through the connection-bound transport, not a bare fetch (#1810)', async () => {
    // Once the client stops calling `globalThis.fetch` directly its `?? globalThis.fetch`
    // default IS the bypass, so lint can no longer detect a dropped transport — only
    // this assertion can.
    createKsefHttpClientMock.mockReturnValue({
      httpClient: {} as never,
      publicKeyCache: {} as never,
      handshake: {
        authenticate: jest.fn().mockResolvedValue({
          accessToken: 'acc',
          refreshToken: 'ref',
          accessTokenExpiresAt: new Date(),
        }),
      } as never,
    });
    const conn = connection();

    await new KsefConnectionTesterAdapter(http).test(
      conn,
      resolver({ 'ref:ksef': { authType: 'ksef-token', secret: 'tok' } }),
    );

    // Exactly one argument — KSeF ships no manifest `defaultRateLimit`.
    expect(http.forConnection).toHaveBeenCalledWith(conn);
    expect(createKsefHttpClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ fetchImpl: boundFetch }),
    );
  });

  it('should map a live auth rejection to a failed result carrying the status code', async () => {
    const authenticate = jest
      .fn()
      .mockRejectedValue(new KsefAuthenticationException('KSeF rejected the token', 401));
    createKsefHttpClientMock.mockReturnValue({
      httpClient: {} as never,
      publicKeyCache: {} as never,
      handshake: { authenticate } as never,
    });

    const adapter = new KsefConnectionTesterAdapter(http);
    const result = await adapter.test(
      connection(),
      resolver({ 'ref:ksef': { authType: 'ksef-token', secret: 'tok' } }),
    );

    expect(result).toEqual({
      success: false,
      status: 401,
      message: 'KSeF rejected the token',
      latencyMs: expect.any(Number),
    });
  });

  it('should never leak an unrecognised error into the operator-facing message', async () => {
    const authenticate = jest.fn().mockRejectedValue(new Error('ECONNRESET at socket level'));
    createKsefHttpClientMock.mockReturnValue({
      httpClient: {} as never,
      publicKeyCache: {} as never,
      handshake: { authenticate } as never,
    });

    const adapter = new KsefConnectionTesterAdapter(http);
    const result = await adapter.test(
      connection(),
      resolver({ 'ref:ksef': { authType: 'ksef-token', secret: 'tok' } }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe('KSeF connection test failed');
  });

  it('should treat a config exception the same as any other test failure', async () => {
    const authenticate = jest
      .fn()
      .mockRejectedValue(new KsefConfigException('KSeF auth handshake used before wiring completed'));
    createKsefHttpClientMock.mockReturnValue({
      httpClient: {} as never,
      publicKeyCache: {} as never,
      handshake: { authenticate } as never,
    });

    const adapter = new KsefConnectionTesterAdapter(http);
    const result = await adapter.test(
      connection(),
      resolver({ 'ref:ksef': { authType: 'ksef-token', secret: 'tok' } }),
    );

    expect(result).toMatchObject({
      success: false,
      message: 'KSeF auth handshake used before wiring completed',
    });
  });

  it('should surface a session-crypto failure (cert fetch/validation, RSA wrap) instead of the generic fallback', async () => {
    const authenticate = jest
      .fn()
      .mockRejectedValue(
        new KsefSessionCryptoException('No valid MF public-key certificate for usage KsefTokenEncryption', 'CERT_NOT_FOUND'),
      );
    createKsefHttpClientMock.mockReturnValue({
      httpClient: {} as never,
      publicKeyCache: {} as never,
      handshake: { authenticate } as never,
    });

    const adapter = new KsefConnectionTesterAdapter(http);
    const result = await adapter.test(
      connection(),
      resolver({ 'ref:ksef': { authType: 'ksef-token', secret: 'tok' } }),
    );

    expect(result).toMatchObject({
      success: false,
      message: 'No valid MF public-key certificate for usage KsefTokenEncryption',
    });
  });
});
