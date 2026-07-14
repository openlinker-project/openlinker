/**
 * WooCommerce Plugin Descriptor — unit tests
 *
 * Verifies the static manifest shape, that `register(host)` self-registers
 * the connection tester, config shape validator, credentials shape validator,
 * auth failure classifier, and scheduler tasks, and that `createCapabilityAdapter`
 * correctly handles the capabilities added in #874 (ProductMaster), #875
 * (InventoryMaster), #877 (OrderProcessorManager), #876 (OrderSource), and
 * rejects unsupported ones.
 *
 * @module libs/integrations/woocommerce/src/__tests__
 */
import type { HostServices } from '@openlinker/plugin-sdk';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { woocommerceAdapterManifest, createWooCommercePlugin } from '../woocommerce-plugin';
import { WooCommerceIntegrationModule } from '../woocommerce-integration.module';
import { WooCommerceConfigException } from '../domain/exceptions/woocommerce-config.exception';
import { WooCommerceAuthFailureClassifierAdapter } from '../infrastructure/adapters/woocommerce-auth-failure-classifier.adapter';

interface HostStub {
  host: HostServices;
  testerRegistry: { register: jest.Mock };
  configRegistry: { register: jest.Mock };
  credentialsRegistry: { register: jest.Mock };
  authFailureRegistry: { register: jest.Mock };
  schedulerRegistry: { register: jest.Mock };
  translatorRegistry: { register: jest.Mock };
}

function makeHostStub(): HostStub {
  const testerRegistry = { register: jest.fn() };
  const configRegistry = { register: jest.fn() };
  const credentialsRegistry = { register: jest.fn() };
  const authFailureRegistry = { register: jest.fn() };
  const schedulerRegistry = { register: jest.fn() };
  const translatorRegistry = { register: jest.fn() };

  const host = {
    connectionTesterRegistry: testerRegistry,
    connectionConfigShapeValidatorRegistry: configRegistry,
    connectionCredentialsShapeValidatorRegistry: credentialsRegistry,
    emailNormalizerRegistry: { register: jest.fn() },
    retryClassifierRegistry: { register: jest.fn() },
    authFailureClassifierRegistry: authFailureRegistry,
    schedulerTaskRegistry: schedulerRegistry,
    webhookProvisioningRegistry: { register: jest.fn() },
    webhookEventTranslatorRegistry: translatorRegistry,
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

  return {
    host,
    testerRegistry,
    configRegistry,
    credentialsRegistry,
    authFailureRegistry,
    schedulerRegistry,
    translatorRegistry,
  };
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

  it('should include OrderProcessorManager in supportedCapabilities (#877)', () => {
    expect(woocommerceAdapterManifest.supportedCapabilities).toContain('OrderProcessorManager');
  });

  it('should include OrderSource in supportedCapabilities (#876)', () => {
    expect(woocommerceAdapterManifest.supportedCapabilities).toContain('OrderSource');
  });

  it('should include OfferManager in supportedCapabilities (#1498)', () => {
    expect(woocommerceAdapterManifest.supportedCapabilities).toContain('OfferManager');
  });

  it('should NOT declare offer-creation sub-capabilities (WC is a destination shop, #1498)', () => {
    expect(woocommerceAdapterManifest.supportedCapabilities).not.toContain('OfferCreator');
    expect(woocommerceAdapterManifest.supportedCapabilities).not.toContain('OfferEventReader');
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

  it('should resolve OrderSource adapter when capability is OrderSource (#876)', async () => {
    const { host } = makeHostStub();
    const plugin = createWooCommercePlugin();
    const adapter = await plugin.createCapabilityAdapter(mockConnection, 'OrderSource', host);
    expect(adapter).toBeDefined();
    expect(typeof (adapter as { listOrderFeed?: unknown }).listOrderFeed).toBe('function');
    expect(typeof (adapter as { getOrder?: unknown }).getOrder).toBe('function');
  });

  it('should resolve OfferManager adapter when capability is OfferManager (#1498)', async () => {
    const { host } = makeHostStub();
    const plugin = createWooCommercePlugin();
    const adapter = await plugin.createCapabilityAdapter(mockConnection, 'OfferManager', host);
    expect(adapter).toBeDefined();
    expect(typeof (adapter as { updateOfferQuantity?: unknown }).updateOfferQuantity).toBe(
      'function',
    );
  });

  it('should reject unsupported capability with descriptive error', async () => {
    const { host } = makeHostStub();
    const plugin = createWooCommercePlugin();
    await expect(
      plugin.createCapabilityAdapter(mockConnection, 'Invoicing', host),
    ).rejects.toThrow('WooCommerce');
  });
});

describe('createWooCommercePlugin → register(host) — #876 additions', () => {
  it('should register auth failure classifier at the plugin adapterKey', () => {
    const { host, authFailureRegistry } = makeHostStub();
    createWooCommercePlugin().register!(host);
    expect(authFailureRegistry.register).toHaveBeenCalledWith(
      'woocommerce.restapi.v3',
      expect.any(WooCommerceAuthFailureClassifierAdapter),
    );
  });

  it('should register the orders-poll scheduler task', () => {
    const { host, schedulerRegistry } = makeHostStub();
    createWooCommercePlugin().register!(host);
    expect(schedulerRegistry.register).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'woocommerce-orders-poll' }),
    );
  });
});

describe('createWooCommercePlugin → register(host) — #1548 inbound webhooks', () => {
  it('should register the webhook event translator at the plugin adapterKey', () => {
    const { host, translatorRegistry } = makeHostStub();
    createWooCommercePlugin().register!(host);
    expect(translatorRegistry.register).toHaveBeenCalledWith(
      'woocommerce.restapi.v3',
      expect.objectContaining({ translate: expect.any(Function) }),
    );
  });
});

describe('WooCommerceIntegrationModule', () => {
  // Since #1552 the module is a bespoke `@Module` class (Shape A) — it provides
  // the customer + address provisioners and builds the descriptor with those
  // plugin-specific deps in `onModuleInit`, mirroring PrestaShop. Importing this
  // spec exercises the decorator metadata; a class-shape regression surfaces at
  // unit speed (no host bootstrap required).
  it('is a NestJS module class implementing onModuleInit', () => {
    expect(typeof WooCommerceIntegrationModule).toBe('function');
    expect(typeof WooCommerceIntegrationModule.prototype.onModuleInit).toBe('function');
  });
});
