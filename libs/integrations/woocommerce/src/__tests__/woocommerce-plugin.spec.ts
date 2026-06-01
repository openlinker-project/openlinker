/**
 * WooCommerce Plugin Descriptor — unit tests
 *
 * Verifies the static manifest shape, that `register(host)` self-registers
 * the connection tester, config shape validator, and credentials shape
 * validator, and that `createCapabilityAdapter` throws the expected error for
 * any capability (empty dispatch table at scaffold stage — #874+ populate it).
 *
 * @module libs/integrations/woocommerce/src/__tests__
 */
import type { HostServices } from '@openlinker/plugin-sdk';
import { woocommerceAdapterManifest, createWooCommercePlugin } from '../woocommerce-plugin';

function makeHostStub(): {
  host: HostServices;
  testerRegistry: { register: jest.Mock };
  configRegistry: { register: jest.Mock };
  credentialsRegistry: { register: jest.Mock };
} {
  const testerRegistry = { register: jest.fn() };
  const configRegistry = { register: jest.fn() };
  const credentialsRegistry = { register: jest.fn() };

  const host = {
    connectionTesterRegistry: testerRegistry,
    connectionConfigShapeValidatorRegistry: configRegistry,
    connectionCredentialsShapeValidatorRegistry: credentialsRegistry,
    // Other host services not used by this plugin at scaffold stage
    emailNormalizerRegistry: { register: jest.fn() },
    retryClassifierRegistry: { register: jest.fn() },
    authFailureClassifierRegistry: { register: jest.fn() },
    schedulerTaskRegistry: { register: jest.fn() },
    webhookProvisioningRegistry: { register: jest.fn() },
    oauthCompletionRegistry: { register: jest.fn() },
    adapterRegistry: { register: jest.fn() },
    factoryResolver: { registerFactory: jest.fn() },
    logger: jest.fn(),
    identifierMapping: {} as HostServices['identifierMapping'],
    credentialsResolver: {} as HostServices['credentialsResolver'],
  } as unknown as HostServices;

  return { host, testerRegistry, configRegistry, credentialsRegistry };
}

describe('woocommerceAdapterManifest', () => {
  it('should declare adapterKey as woocommerce.restapi.v3', () => {
    expect(woocommerceAdapterManifest.adapterKey).toBe('woocommerce.restapi.v3');
  });

  it('should declare platformType as woocommerce', () => {
    expect(woocommerceAdapterManifest.platformType).toBe('woocommerce');
  });

  it('should declare supportedCapabilities as empty array at scaffold stage', () => {
    expect(woocommerceAdapterManifest.supportedCapabilities).toEqual([]);
  });

  it('should be marked as the default adapter for the platform', () => {
    expect(woocommerceAdapterManifest.isDefault).toBe(true);
  });
});

describe('createWooCommercePlugin → register(host)', () => {
  it('should register connection tester at the plugin adapterKey', () => {
    const { host, testerRegistry } = makeHostStub();
    createWooCommercePlugin().register!(host);
    expect(testerRegistry.register).toHaveBeenCalledWith(
      'woocommerce.restapi.v3',
      expect.objectContaining({ test: expect.any(Function) }),
    );
  });

  it('should register config shape validator at the plugin adapterKey', () => {
    const { host, configRegistry } = makeHostStub();
    createWooCommercePlugin().register!(host);
    expect(configRegistry.register).toHaveBeenCalledWith(
      'woocommerce.restapi.v3',
      expect.objectContaining({ validate: expect.any(Function) }),
    );
  });

  it('should register credentials shape validator at the plugin adapterKey', () => {
    const { host, credentialsRegistry } = makeHostStub();
    createWooCommercePlugin().register!(host);
    expect(credentialsRegistry.register).toHaveBeenCalledWith(
      'woocommerce.restapi.v3',
      expect.objectContaining({ validate: expect.any(Function) }),
    );
  });
});

describe('createWooCommercePlugin → createCapabilityAdapter', () => {
  it('should throw unsupported capability error for any capability', async () => {
    const { host } = makeHostStub();
    const plugin = createWooCommercePlugin();
    const connection = { id: 'conn-1' } as Parameters<typeof plugin.createCapabilityAdapter>[0];

    await expect(
      plugin.createCapabilityAdapter(connection, 'ProductMaster', host),
    ).rejects.toThrow('WooCommerce adapter does not support capability: ProductMaster');
  });

  it('should list empty supported capabilities in the error message', async () => {
    const { host } = makeHostStub();
    const plugin = createWooCommercePlugin();
    const connection = { id: 'conn-1' } as Parameters<typeof plugin.createCapabilityAdapter>[0];

    await expect(
      plugin.createCapabilityAdapter(connection, 'OrderSource', host),
    ).rejects.toThrow('Supported capabilities: ');
  });
});
