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
import { KsefConnectionTesterAdapter } from '../ksef-connection-tester.adapter';
import { KsefAuthenticationException } from '../../../domain/exceptions/ksef-authentication.exception';
import { KsefConfigException } from '../../../domain/exceptions/ksef-config.exception';
import * as httpClientFactory from '../../http/ksef-http-client.factory';

jest.mock('../../http/ksef-http-client.factory');

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
  });

  it('should fail fast when the connection has no valid environment', async () => {
    const adapter = new KsefConnectionTesterAdapter();
    const result = await adapter.test(
      connection({ config: { seller: SELLER_CONFIG } }),
      resolver({ 'ref:ksef': { authType: 'ksef-token', secret: 'tok' } }),
    );
    expect(result).toMatchObject({ success: false, message: expect.stringContaining('environment') });
    expect(createKsefHttpClientMock).not.toHaveBeenCalled();
  });

  it('should fail fast when the connection has no stored credentials', async () => {
    const adapter = new KsefConnectionTesterAdapter();
    const result = await adapter.test(connection({ credentialsRef: '' }), resolver({}));
    expect(result).toMatchObject({
      success: false,
      message: 'Connection has no stored credentials',
    });
  });

  it('should fail fast when credentials are missing authType or secret', async () => {
    const adapter = new KsefConnectionTesterAdapter();
    const result = await adapter.test(connection(), resolver({ 'ref:ksef': { authType: 'ksef-token' } }));
    expect(result).toMatchObject({ success: false, message: expect.stringContaining('authType') });
  });

  it('should report qualified-seal as not yet supported, without attempting a handshake', async () => {
    const adapter = new KsefConnectionTesterAdapter();
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
    const adapter = new KsefConnectionTesterAdapter();
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

    const adapter = new KsefConnectionTesterAdapter();
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

  it('should map a live auth rejection to a failed result carrying the status code', async () => {
    const authenticate = jest
      .fn()
      .mockRejectedValue(new KsefAuthenticationException('KSeF rejected the token', 401));
    createKsefHttpClientMock.mockReturnValue({
      httpClient: {} as never,
      publicKeyCache: {} as never,
      handshake: { authenticate } as never,
    });

    const adapter = new KsefConnectionTesterAdapter();
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

    const adapter = new KsefConnectionTesterAdapter();
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

    const adapter = new KsefConnectionTesterAdapter();
    const result = await adapter.test(
      connection(),
      resolver({ 'ref:ksef': { authType: 'ksef-token', secret: 'tok' } }),
    );

    expect(result).toMatchObject({
      success: false,
      message: 'KSeF auth handshake used before wiring completed',
    });
  });
});
