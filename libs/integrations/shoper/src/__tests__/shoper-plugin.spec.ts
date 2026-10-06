import type { Connection } from '@openlinker/core/identifier-mapping';
import { isOrderStatusWriteback } from '@openlinker/core/orders';
import type { HostServices } from '@openlinker/plugin-sdk';

import { ShoperInventoryMasterAdapter } from '../infrastructure/adapters/inventory-master/shoper-inventory-master.adapter';
import { ShoperProductMasterAdapter } from '../infrastructure/adapters/product-master/shoper-product-master.adapter';
import { ShoperOrderProcessorAdapter } from '../infrastructure/adapters/order-processor/shoper-order-processor.adapter';
import { ShoperInboundWebhookDecoderAdapter } from '../infrastructure/adapters/shoper-inbound-webhook-decoder.adapter';
import { ShoperWebhookEventTranslatorAdapter } from '../infrastructure/adapters/shoper-webhook-event-translator.adapter';
import { ShoperOrderSourceAdapter } from '../infrastructure/adapters/order-source/shoper-order-source.adapter';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { ShoperCustomerProvisioner } from '../infrastructure/provisioners/shoper-customer.provisioner';
import { createShoperPlugin, shoperAdapterManifest } from '../shoper-plugin';

function hostWithRegistries(): {
  host: HostServices;
  registries: Record<string, { register: jest.Mock }>;
  webhookRegistries: { decoder: { register: jest.Mock }; translator: { register: jest.Mock } };
  credentialsGet: jest.Mock;
} {
  const registries = {
    connectionTesterRegistry: { register: jest.fn() },
    connectionConfigShapeValidatorRegistry: { register: jest.fn() },
    connectionCredentialsShapeValidatorRegistry: { register: jest.fn() },
    authFailureClassifierRegistry: { register: jest.fn() },
    retryClassifierRegistry: { register: jest.fn() },
  };
  const webhookRegistries = { decoder: { register: jest.fn() }, translator: { register: jest.fn() } };
  const credentialsGet = jest.fn().mockResolvedValue({ token: 'secret-token-value' });
  const host = {
    http: { forConnection: jest.fn().mockReturnValue(jest.fn()) },
    identifierMapping: {},
    credentialsResolver: { get: credentialsGet },
    inboundWebhookDecoderRegistry: webhookRegistries.decoder,
    webhookEventTranslatorRegistry: webhookRegistries.translator,
    ...registries,
  } as unknown as HostServices;
  return { host, registries, webhookRegistries, credentialsGet };
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
  it('should not enable OrderProcessorManager or OrderSource by default, so a catalogue-only shop neither receives nor ingests orders', () => {
    const defaults = shoperAdapterManifest.defaultEnabledCapabilities;

    expect(defaults).toEqual(['ProductMaster', 'InventoryMaster']);
    expect(defaults).not.toContain('OrderProcessorManager');
    expect(defaults).not.toContain('OrderSource');
    // Every default must be a capability the adapter really supports.
    for (const capability of defaults ?? []) {
      expect(shoperAdapterManifest.supportedCapabilities).toContain(capability);
    }
  });

  it('should expose the documented manifest with its four capabilities', () => {
    expect(shoperAdapterManifest).toMatchObject({
      adapterKey: 'shoper.restapi.v1',
      platformType: 'shoper',
      supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderProcessorManager', 'OrderSource'],
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

  it('should register the webhook decoder by PLATFORM TYPE and the translator by adapter key', () => {
    const { host, webhookRegistries } = hostWithRegistries();

    createShoperPlugin().register?.(host);

    expect(webhookRegistries.decoder.register).toHaveBeenCalledTimes(1);
    expect(webhookRegistries.decoder.register).toHaveBeenCalledWith(
      'shoper',
      expect.any(ShoperInboundWebhookDecoderAdapter),
    );
    expect(webhookRegistries.translator.register).toHaveBeenCalledTimes(1);
    expect(webhookRegistries.translator.register).toHaveBeenCalledWith(
      'shoper.restapi.v1',
      expect.any(ShoperWebhookEventTranslatorAdapter),
    );
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

  it('should resolve OrderSource to the Shoper order source adapter without the Nest-provided deps', async () => {
    const { host } = hostWithRegistries();

    const adapter = await createShoperPlugin().createCapabilityAdapter<unknown>(
      connection(),
      'OrderSource',
      host,
    );

    expect(adapter).toBeInstanceOf(ShoperOrderSourceAdapter);
  });

  it('should resolve OrderProcessorManager to the Shoper order processor adapter', async () => {
    const { host } = hostWithRegistries();
    const deps = {
      customerProvisioner: {} as ShoperCustomerProvisioner,
      mappingConfigService: {} as IMappingConfigService,
    };

    const adapter = await createShoperPlugin(deps).createCapabilityAdapter<unknown>(
      connection(),
      'OrderProcessorManager',
      host,
    );

    expect(adapter).toBeInstanceOf(ShoperOrderProcessorAdapter);
    // The lifecycle relay reaches a destination through exactly this narrowing
    // (#3643): resolve as OrderProcessorManager, then isOrderStatusWriteback.
    expect(isOrderStatusWriteback(adapter as object)).toBe(true);
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
        createShoperPlugin().createCapabilityAdapter(connection(), 'OfferManager', host),
      ).rejects.toThrow(/does not support capability: OfferManager/);
    });

    it('should not decrypt the credentials or open a transport to say so', async () => {
      const { host, credentialsGet } = hostWithRegistries();

      await createShoperPlugin()
        .createCapabilityAdapter(connection(), 'OfferManager', host)
        .catch(() => undefined);

      expect(credentialsGet).not.toHaveBeenCalled();
      expect(host.http.forConnection).not.toHaveBeenCalled();
    });

    it('should report the unsupported capability even when the connection config is broken', async () => {
      const { host } = hostWithRegistries();

      await expect(
        createShoperPlugin().createCapabilityAdapter(
          connection({ config: {} }),
          'OfferManager',
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
