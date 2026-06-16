/**
 * Erli Plugin Descriptor Tests (#980)
 *
 * Asserts the static manifest shape (including the empty capability set the
 * skeleton ships), the static === runtime manifest identity (no-drift
 * invariant, #575), the SDK's uniform unsupported-capability rejection from
 * `createCapabilityAdapter` until the real adapters land (#984 / #993), and
 * that `ErliIntegrationModule` constructs via `createNestAdapterModule`.
 *
 * @module libs/integrations/erli/src/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import { isOfferCreator, type OfferManagerPort } from '@openlinker/core/listings';
import type { OrderSourcePort } from '@openlinker/core/orders';
import type { HostServices } from '@openlinker/plugin-sdk';
import { createErliPlugin, erliAdapterManifest, ErliIntegrationModule } from '../index';

const connection: Connection = {
  id: 'conn-erli-1',
  platformType: 'erli',
  name: 'Test Erli',
  status: 'active',
  config: {},
  credentialsRef: 'ref-1',
  enabledCapabilities: [],
  adapterKey: 'erli.shopapi.v1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Host stub for `createCapabilityAdapter` — the factory resolves credentials. */
function makeDispatchHost(): HostServices {
  return {
    identifierMapping: {},
    credentialsResolver: { get: jest.fn().mockResolvedValue({ apiKey: 'k-123' }) },
  } as unknown as HostServices;
}

/** Host stub exposing only the registries `register(host)` touches (#982/#984). */
function makeRegisterHost(): {
  host: HostServices;
  configRegistry: { register: jest.Mock };
  credentialsRegistry: { register: jest.Mock };
  testerRegistry: { register: jest.Mock };
  emailNormalizerRegistry: { register: jest.Mock };
  retryClassifierRegistry: { register: jest.Mock };
  authFailureClassifierRegistry: { register: jest.Mock };
  schedulerTaskRegistry: { register: jest.Mock };
  webhookEventTranslatorRegistry: { register: jest.Mock };
  webhookProvisioningRegistry: { register: jest.Mock };
} {
  const configRegistry = { register: jest.fn() };
  const credentialsRegistry = { register: jest.fn() };
  const testerRegistry = { register: jest.fn() };
  const emailNormalizerRegistry = { register: jest.fn() };
  const retryClassifierRegistry = { register: jest.fn() };
  const authFailureClassifierRegistry = { register: jest.fn() };
  const schedulerTaskRegistry = { register: jest.fn() };
  const webhookEventTranslatorRegistry = { register: jest.fn() };
  const webhookProvisioningRegistry = { register: jest.fn() };
  const hostStub = {
    connectionConfigShapeValidatorRegistry: configRegistry,
    connectionCredentialsShapeValidatorRegistry: credentialsRegistry,
    connectionTesterRegistry: testerRegistry,
    emailNormalizerRegistry,
    retryClassifierRegistry,
    authFailureClassifierRegistry,
    schedulerTaskRegistry,
    webhookEventTranslatorRegistry,
    webhookProvisioningRegistry,
  } as unknown as HostServices;
  return {
    host: hostStub,
    configRegistry,
    credentialsRegistry,
    testerRegistry,
    emailNormalizerRegistry,
    retryClassifierRegistry,
    authFailureClassifierRegistry,
    schedulerTaskRegistry,
    webhookEventTranslatorRegistry,
    webhookProvisioningRegistry,
  };
}

describe('erliAdapterManifest', () => {
  it('should declare the erli.shopapi.v1 adapter key', () => {
    expect(erliAdapterManifest.adapterKey).toBe('erli.shopapi.v1');
  });

  it('should declare the erli platform type', () => {
    expect(erliAdapterManifest.platformType).toBe('erli');
  });

  it('should declare OfferManager + OrderSource (the capabilities #984/#993 deliver)', () => {
    // Each capability is declared in lockstep with its adapter; declaring a
    // capability the factory cannot build would let listCapabilityAdapters
    // request an undeliverable adapter.
    expect(erliAdapterManifest.supportedCapabilities).toEqual(['OfferManager', 'OrderSource']);
  });

  it('should be the platform-default adapter', () => {
    expect(erliAdapterManifest.isDefault).toBe(true);
  });

  it('should carry a display name and version', () => {
    expect(erliAdapterManifest.displayName).toBe('Erli Shop API v1');
    expect(erliAdapterManifest.version).toBe('1.0.0');
  });
});

describe('createErliPlugin', () => {
  it('should return the same manifest reference as the static export (no drift)', () => {
    expect(createErliPlugin().manifest).toBe(erliAdapterManifest);
  });

  describe('register', () => {
    it('should register the config-shape validator at erli.shopapi.v1 (#982)', () => {
      const { host, configRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(configRegistry.register).toHaveBeenCalledWith(
        'erli.shopapi.v1',
        expect.objectContaining({ validate: expect.any(Function) }),
      );
    });

    it('should register the credentials-shape validator at erli.shopapi.v1 (#982)', () => {
      const { host, credentialsRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(credentialsRegistry.register).toHaveBeenCalledWith(
        'erli.shopapi.v1',
        expect.objectContaining({ validate: expect.any(Function) }),
      );
    });

    it('should register the connection tester at erli.shopapi.v1 (#982)', () => {
      const { host, testerRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(testerRegistry.register).toHaveBeenCalledWith(
        'erli.shopapi.v1',
        expect.objectContaining({ test: expect.any(Function) }),
      );
    });

    it('should register the email normalizer at erli.shopapi.v1 (#995)', () => {
      // PROVISIONAL (#992): the normalizer is baseline-only; this asserts the
      // per-platform seam is wired under the Erli adapter key.
      const { host, emailNormalizerRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(emailNormalizerRegistry.register).toHaveBeenCalledWith(
        'erli.shopapi.v1',
        expect.objectContaining({ normalize: expect.any(Function) }),
      );
    });

    it('should register the retry + auth-failure classifiers at erli.shopapi.v1 (#984)', () => {
      const { host, retryClassifierRegistry, authFailureClassifierRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(retryClassifierRegistry.register).toHaveBeenCalledWith(
        'erli.shopapi.v1',
        expect.objectContaining({ isNonRetryable: expect.any(Function) }),
      );
      expect(authFailureClassifierRegistry.register).toHaveBeenCalledWith(
        'erli.shopapi.v1',
        expect.objectContaining({ isCredentialRejected: expect.any(Function) }),
      );
    });

    it('should register the erli-offer-status-sync scheduler task (#989)', () => {
      const { host, schedulerTaskRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(schedulerTaskRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'erli-offer-status-sync',
          platformType: 'erli',
          jobType: 'marketplace.offer.statusSync',
          enabledEnvVar: 'OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED',
        }),
      );
    });

    it('should register the erli-orders-poll scheduler task (#993)', () => {
      const { host, schedulerTaskRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(schedulerTaskRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'erli-orders-poll',
          platformType: 'erli',
          jobType: 'marketplace.orders.poll',
          enabledEnvVar: 'OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED',
        }),
      );
    });

    it('should register the webhook event translator at erli.shopapi.v1 (#996)', () => {
      const { host, webhookEventTranslatorRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(webhookEventTranslatorRegistry.register).toHaveBeenCalledWith(
        'erli.shopapi.v1',
        expect.objectContaining({ translate: expect.any(Function) }),
      );
    });

    it('should NOT register the webhook provisioner from register() (#996)', () => {
      // The automated provisioner needs NestJS-injected ConnectionPort +
      // IWebhookSecretService (not in HostServices), so it is registered by
      // ErliWebhookProvisioningModule's onModuleInit, NOT here.
      const { host, webhookProvisioningRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(webhookProvisioningRegistry.register).not.toHaveBeenCalled();
    });
  });

  describe('createCapabilityAdapter', () => {
    it('should resolve OfferManager to an offer-creator adapter (#984)', async () => {
      const adapter = await createErliPlugin().createCapabilityAdapter<OfferManagerPort>(
        connection,
        'OfferManager',
        makeDispatchHost(),
      );

      expect(isOfferCreator(adapter)).toBe(true);
    });

    it('should resolve OrderSource to an order-source adapter (#993)', async () => {
      const adapter = await createErliPlugin().createCapabilityAdapter<OrderSourcePort>(
        connection,
        'OrderSource',
        makeDispatchHost(),
      );

      expect(typeof adapter.listOrderFeed).toBe('function');
      expect(typeof adapter.getOrder).toBe('function');
    });

    it('should reject an unsupported capability with the SDK unsupported-capability error', async () => {
      await expect(
        createErliPlugin().createCapabilityAdapter(connection, 'ProductMaster', makeDispatchHost()),
      ).rejects.toThrow('Erli adapter does not support capability: ProductMaster');
    });
  });
});

describe('ErliIntegrationModule', () => {
  it('should construct a DynamicModule via createNestAdapterModule when the package is loaded', () => {
    expect(ErliIntegrationModule.module).toBeDefined();
    expect(ErliIntegrationModule.imports?.length).toBeGreaterThan(0);
  });
});
