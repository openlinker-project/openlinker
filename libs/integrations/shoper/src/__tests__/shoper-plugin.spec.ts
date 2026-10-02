import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';

import { ShoperInventoryMasterAdapter } from '../infrastructure/adapters/inventory-master/shoper-inventory-master.adapter';
import { ShoperProductMasterAdapter } from '../infrastructure/adapters/product-master/shoper-product-master.adapter';
import { ShoperOrderProcessorAdapter } from '../infrastructure/adapters/order-processor/shoper-order-processor.adapter';
import type { ShoperCustomerProvisioner } from '../infrastructure/provisioners/shoper-customer.provisioner';
import { createShoperPlugin, shoperAdapterManifest } from '../shoper-plugin';

function hostWithRegistries(): {
  host: HostServices;
  registries: Record<string, { register: jest.Mock }>;
  credentialsGet: jest.Mock;
} {
  const registries = {
    connectionTesterRegistry: { register: jest.fn() },
    connectionConfigShapeValidatorRegistry: { register: jest.fn() },
    connectionCredentialsShapeValidatorRegistry: { register: jest.fn() },
    authFailureClassifierRegistry: { register: jest.fn() },
    retryClassifierRegistry: { register: jest.fn() },
  };
  const credentialsGet = jest.fn().mockResolvedValue({ token: 'secret-token-value' });
  const host = {
    http: { forConnection: jest.fn().mockReturnValue(jest.fn()) },
    identifierMapping: {},
    credentialsResolver: { get: credentialsGet },
    ...registries,
  } as unknown as HostServices;
  return { host, registries, credentialsGet };
}

function connection(overrides: Record<string, unknown> = {}): Connection {
  return {
    id: 'c',
    platformType: 'shoper',
    config: { baseUrl: 'sklep729770.shoparena.pl' },
    credentialsRef: 'db:cred-1',
    ...overrides,
  } as unknown as Connection;
}

describe('Shoper plugin', () => {
  it('should expose the documented manifest with the ProductMaster and InventoryMaster capabilities', () => {
    expect(shoperAdapterManifest).toMatchObject({
      adapterKey: 'shoper.restapi.v1',
      platformType: 'shoper',
      supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
      isDefault: true,
    });
    expect(shoperAdapterManifest.defaultRateLimit).toBeUndefined();
    expect(createShoperPlugin().manifest).toBe(shoperAdapterManifest);
  });

  it('should register the tester, both shape validators and both classifiers under its adapter key', () => {
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

  it('should resolve InventoryMaster to the Shoper inventory master adapter', async () => {
    const { host } = hostWithRegistries();

    const adapter = await createShoperPlugin().createCapabilityAdapter<unknown>(
      connection(),
      'InventoryMaster',
      host,
    );

    expect(adapter).toBeInstanceOf(ShoperInventoryMasterAdapter);
  });

  it('should resolve OrderProcessorManager to the Shoper order processor adapter', async () => {
    const { host } = hostWithRegistries();
    const deps = { customerProvisioner: {} as ShoperCustomerProvisioner };

    const adapter = await createShoperPlugin(deps).createCapabilityAdapter<unknown>(
      connection(),
      'OrderProcessorManager',
      host,
    );

    expect(adapter).toBeInstanceOf(ShoperOrderProcessorAdapter);
  });

  it('should refuse OrderProcessorManager when built without the customer provisioner', async () => {
    const { host } = hostWithRegistries();

    await expect(
      createShoperPlugin().createCapabilityAdapter(connection(), 'OrderProcessorManager', host),
    ).rejects.toThrow(/customer provisioner/);
  });

  it('should route the connection through the connection-bound transport', async () => {
    const { host } = hostWithRegistries();
    const conn = connection();

    await createShoperPlugin().createCapabilityAdapter<unknown>(conn, 'ProductMaster', host);

    expect(host.http.forConnection).toHaveBeenCalledWith(conn);
  });

  describe('an unsupported capability', () => {
    it('should fail with the SDK’s uniform error', async () => {
      const { host } = hostWithRegistries();

      await expect(
        createShoperPlugin().createCapabilityAdapter(connection(), 'OrderSource', host),
      ).rejects.toThrow(/does not support capability: OrderSource/);
    });

    it('should not decrypt the credentials or open a transport to say so', async () => {
      const { host, credentialsGet } = hostWithRegistries();

      await createShoperPlugin()
        .createCapabilityAdapter(connection(), 'OrderSource', host)
        .catch(() => undefined);

      expect(credentialsGet).not.toHaveBeenCalled();
      expect(host.http.forConnection).not.toHaveBeenCalled();
    });

    it('should report the unsupported capability even when the connection config is broken', async () => {
      const { host } = hostWithRegistries();

      await expect(
        createShoperPlugin().createCapabilityAdapter(
          connection({ config: {} }),
          'OrderSource',
          host,
        ),
      ).rejects.toThrow(/does not support capability/);
    });
  });

  it('should still surface a broken config for the capability it does support', async () => {
    const { host } = hostWithRegistries();

    await expect(
      createShoperPlugin().createCapabilityAdapter(connection({ config: {} }), 'ProductMaster', host),
    ).rejects.toThrow(/misconfigured/);
  });
});
