/**
 * WooCommerce Plugin Descriptor — unit tests
 *
 * Verifies the static manifest shape, that `register(host)` self-registers
 * the connection tester, config shape validator, and credentials shape
 * validator, and that `createCapabilityAdapter` correctly handles capabilities
 * added in #874 (ProductMaster) and rejects unsupported ones.
 *
 * @module libs/integrations/woocommerce/src/__tests__
 */
import type { HostServices } from '@openlinker/plugin-sdk';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { woocommerceAdapterManifest, createWooCommercePlugin } from '../woocommerce-plugin';
import { WooCommerceConfigException } from '../domain/exceptions/woocommerce-config.exception';

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
    credentialsResolver: {
      get: jest.fn().mockResolvedValue({
        consumerKey: 'ck_test',
        consumerSecret: 'cs_test',
      }),
    } as unknown as HostServices['credentialsResolver'],
  } as unknown as HostServices;

  return { host, testerRegistry, configRegistry, credentialsRegistry };
}

const mockConnection: Connection = {
  id: 'conn-1',
  platformType: 'woocommerce',
  name: 'Test',
  status: 'active',
  config: { siteUrl: 'https://myshop.com' } as Record<string, unknown>,
  credentialsRef: 'cred-ref-001',
  enabledCapabilities: ['ProductMaster'],
  adapterKey: 'woocommerce.restapi.v3',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('woocommerceAdapterManifest', () => {
  it('should declare adapterKey as woocommerce.restapi.v3', () => {
    expect(woocommerceAdapterManifest.adapterKey).toBe('woocommerce.restapi.v3');
  });

  it('should declare platformType as woocommerce', () => {
    expect(woocommerceAdapterManifest.platformType).toBe('woocommerce');
  });

  it('should include ProductMaster in supportedCapabilities (#874)', () => {
    expect(woocommerceAdapterManifest.supportedCapabilities).toContain('ProductMaster');
  });

  it('should include InventoryMaster in supportedCapabilities (#875)', () => {
    expect(woocommerceAdapterManifest.supportedCapabilities).toContain('InventoryMaster');
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
  it('should throw WooCommerceConfigException when credentialsRef is missing', async () => {
    const { host } = makeHostStub();
    const plugin = createWooCommercePlugin();
    const noCredsConnection = { ...mockConnection, credentialsRef: null } as unknown as Connection;
    await expect(
      plugin.createCapabilityAdapter(noCredsConnection, 'ProductMaster', host),
    ).rejects.toBeInstanceOf(WooCommerceConfigException);
  });

  it('should resolve ProductMaster adapter when capability is ProductMaster (#874)', async () => {
    const { host } = makeHostStub();
    const plugin = createWooCommercePlugin();
    const adapter = await plugin.createCapabilityAdapter(mockConnection, 'ProductMaster', host);
    expect(adapter).toBeDefined();
    expect(typeof (adapter as { getProduct?: unknown }).getProduct).toBe('function');
  });

  it('should reject unsupported capability with descriptive error', async () => {
    const { host } = makeHostStub();
    const plugin = createWooCommercePlugin();
    await expect(
      plugin.createCapabilityAdapter(mockConnection, 'OrderSource', host),
    ).rejects.toThrow('WooCommerce');
  });
});
