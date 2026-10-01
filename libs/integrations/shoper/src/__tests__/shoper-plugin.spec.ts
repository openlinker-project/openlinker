import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';

import { ShoperProductMasterAdapter } from '../infrastructure/adapters/product-master/shoper-product-master.adapter';
import { createShoperPlugin, shoperAdapterManifest } from '../shoper-plugin';

function hostWithRegistries(): {
  host: HostServices;
  registries: Record<string, { register: jest.Mock }>;
} {
  const registries = {
    connectionTesterRegistry: { register: jest.fn() },
    connectionConfigShapeValidatorRegistry: { register: jest.fn() },
    connectionCredentialsShapeValidatorRegistry: { register: jest.fn() },
    authFailureClassifierRegistry: { register: jest.fn() },
  };
  const host = {
    http: { forConnection: jest.fn().mockReturnValue(jest.fn()) },
    identifierMapping: {},
    credentialsResolver: { get: jest.fn().mockResolvedValue({ token: 'secret-token-value' }) },
    ...registries,
  } as unknown as HostServices;
  return { host, registries };
}

function connection(): Connection {
  return {
    id: 'c',
    platformType: 'shoper',
    config: { baseUrl: 'sklep729770.shoparena.pl' },
    credentialsRef: 'db:cred-1',
  } as unknown as Connection;
}

describe('Shoper plugin', () => {
  it('should expose the documented manifest with the ProductMaster capability only', () => {
    expect(shoperAdapterManifest).toMatchObject({
      adapterKey: 'shoper.restapi.v1',
      platformType: 'shoper',
      supportedCapabilities: ['ProductMaster'],
      isDefault: true,
    });
    expect(shoperAdapterManifest.defaultRateLimit).toBeUndefined();
    expect(createShoperPlugin().manifest).toBe(shoperAdapterManifest);
  });

  it('should register the tester, both shape validators and the auth classifier under its adapter key', () => {
    const { host, registries } = hostWithRegistries();

    createShoperPlugin().register?.(host);

    for (const registry of Object.values(registries)) {
      expect(registry.register).toHaveBeenCalledTimes(1);
      expect(registry.register).toHaveBeenCalledWith('shoper.restapi.v1', expect.any(Object));
    }
  });

  it('should resolve ProductMaster to the Shoper product master adapter', async () => {
    const { host } = hostWithRegistries();

    const adapter = await createShoperPlugin().createCapabilityAdapter<unknown>(
      connection(),
      'ProductMaster',
      host,
    );

    expect(adapter).toBeInstanceOf(ShoperProductMasterAdapter);
  });

  it('should route the connection through the connection-bound transport', async () => {
    const { host } = hostWithRegistries();
    const conn = connection();

    await createShoperPlugin().createCapabilityAdapter<unknown>(conn, 'ProductMaster', host);

    expect(host.http.forConnection).toHaveBeenCalledWith(conn);
  });

  it('should still reject a capability no task has delivered yet', async () => {
    const { host } = hostWithRegistries();

    await expect(
      createShoperPlugin().createCapabilityAdapter(connection(), 'InventoryMaster', host),
    ).rejects.toThrow(/capability/);
  });
});
