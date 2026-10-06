import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';

import { ShoperConfigException } from '../../domain/exceptions/shoper-config.exception';
import { ShoperOrderSourceAdapter } from '../../infrastructure/adapters/order-source/shoper-order-source.adapter';
import { ShoperProductMasterAdapter } from '../../infrastructure/adapters/product-master/shoper-product-master.adapter';
import { ShoperAdapterFactory } from '../shoper-adapter.factory';

const TOKEN = 'secret-token-value';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    platformType: 'shoper',
    config: { baseUrl: 'sklep729770.shoparena.pl' },
    credentialsRef: 'db:cred-1',
    ...overrides,
  } as Connection;
}

function resolver(credentials: unknown): CredentialsResolverPort {
  return { get: jest.fn().mockResolvedValue(credentials) } as unknown as CredentialsResolverPort;
}

const mapping = {} as IdentifierMappingPort;
const fetchImpl = jest.fn() as unknown as typeof fetch;

describe('ShoperAdapterFactory', () => {
  const factory = new ShoperAdapterFactory();

  it('should build the product master adapter for a valid connection', async () => {
    const adapters = await factory.createAdapters(
      connection(),
      mapping,
      resolver({ token: TOKEN }),
      fetchImpl,
    );

    expect(adapters.productMaster).toBeInstanceOf(ShoperProductMasterAdapter);
  });

  it('should always build the order source, which needs no customer provisioner', async () => {
    const adapters = await factory.createAdapters(
      connection(),
      mapping,
      resolver({ token: TOKEN }),
      fetchImpl,
    );

    expect(adapters.orderSource).toBeInstanceOf(ShoperOrderSourceAdapter);
    expect(adapters.orderProcessor).toBeNull();
  });

  it('should resolve credentials per call from the connection credentialsRef', async () => {
    const credentialsResolver = resolver({ token: TOKEN });

    await factory.createAdapters(connection(), mapping, credentialsResolver, fetchImpl);

    expect(credentialsResolver.get).toHaveBeenCalledWith('db:cred-1');
  });

  it.each([
    ['a missing baseUrl', { config: {} }, { token: TOKEN }, /non-empty string/],
    ['a private baseUrl', { config: { baseUrl: '10.0.0.1' } }, { token: TOKEN }, /IP address/],
    ['no credentialsRef', { credentialsRef: '' }, { token: TOKEN }, /no stored credentials/],
    ['an empty token', {}, { token: '  ' }, /no API token/],
    ['a missing token', {}, {}, /no API token/],
  ])('should refuse a connection with %s', async (_label, patch, credentials, message) => {
    await expect(
      factory.createAdapters(
        connection(patch as Partial<Connection>),
        mapping,
        resolver(credentials),
        fetchImpl,
      ),
    ).rejects.toThrow(message);
  });

  it('should raise the plugin config exception naming the connection', async () => {
    const error = await factory
      .createAdapters(connection({ config: {} }), mapping, resolver({ token: TOKEN }), fetchImpl)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShoperConfigException);
    expect((error as ShoperConfigException).connectionId).toBe('conn-1');
  });

  it('should never put the token in an error message', async () => {
    const error = await factory
      .createAdapters(connection({ config: {} }), mapping, resolver({ token: TOKEN }), fetchImpl)
      .catch((e: unknown) => e);

    expect((error as Error).message).not.toContain(TOKEN);
  });
});
