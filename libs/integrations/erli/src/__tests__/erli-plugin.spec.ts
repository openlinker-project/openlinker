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
import type { ConnectionTesterPort, CredentialsResolverPort } from '@openlinker/core/integrations';
import {
  isOfferCreator,
  isResponsibleProducerReader,
  type OfferManagerPort,
} from '@openlinker/core/listings';
import type { OrderSourcePort } from '@openlinker/core/orders';
import type { SchedulerTaskConfig } from '@openlinker/core/sync';
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
    // Connection-bound outbound transport (#1810) — the factory resolves
    // `host.http.forConnection(connection)` for every adapter.
    http: { forConnection: jest.fn().mockReturnValue(jest.fn()), evict: jest.fn() },
  } as unknown as HostServices;
}

/**
 * Host stub for `register(host)` — the registries it touches (#982/#984) plus
 * the outbound transport factory (#1810), which `register` now threads into the
 * connection tester. `http` must be a real mock, not absent: a stub without it
 * constructs the tester with `undefined` and the registration assertions still
 * pass, so a regression that stopped threading `host.http` would go unnoticed.
 */
function makeRegisterHost(): {
  host: HostServices;
  http: { forConnection: jest.Mock; evict: jest.Mock };
  configRegistry: { register: jest.Mock };
  credentialsRegistry: { register: jest.Mock };
  testerRegistry: { register: jest.Mock };
  emailNormalizerRegistry: { register: jest.Mock };
  retryClassifierRegistry: { register: jest.Mock };
  authFailureClassifierRegistry: { register: jest.Mock };
  schedulerTaskRegistry: { register: jest.Mock };
  inboundWebhookDecoderRegistry: { register: jest.Mock };
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
  const inboundWebhookDecoderRegistry = { register: jest.fn() };
  const webhookEventTranslatorRegistry = { register: jest.fn() };
  const webhookProvisioningRegistry = { register: jest.fn() };
  const http = { forConnection: jest.fn().mockReturnValue(jest.fn()), evict: jest.fn() };
  const hostStub = {
    http,
    connectionConfigShapeValidatorRegistry: configRegistry,
    connectionCredentialsShapeValidatorRegistry: credentialsRegistry,
    connectionTesterRegistry: testerRegistry,
    emailNormalizerRegistry,
    retryClassifierRegistry,
    authFailureClassifierRegistry,
    schedulerTaskRegistry,
    inboundWebhookDecoderRegistry,
    webhookEventTranslatorRegistry,
    webhookProvisioningRegistry,
  } as unknown as HostServices;
  return {
    host: hostStub,
    http,
    configRegistry,
    credentialsRegistry,
    testerRegistry,
    emailNormalizerRegistry,
    retryClassifierRegistry,
    authFailureClassifierRegistry,
    schedulerTaskRegistry,
    inboundWebhookDecoderRegistry,
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
    expect(erliAdapterManifest.supportedCapabilities).toEqual(
      expect.arrayContaining(['OfferManager', 'OrderSource'])
    );
  });

  it('should advertise the OfferCreator sub-capability so FE offer-creation flows keep showing Erli (#1498)', () => {
    expect(erliAdapterManifest.supportedCapabilities).toContain('OfferCreator');
    // Erli has no offer-event journal — the offers-sync trigger stays hidden.
    expect(erliAdapterManifest.supportedCapabilities).not.toContain('OfferEventReader');
  });

  it('should advertise the ResponsibleProducerReader sub-capability so the wizard producer picker shows for Erli (#1531)', () => {
    expect(erliAdapterManifest.supportedCapabilities).toContain('ResponsibleProducerReader');
  });

  it('should advertise the DeliveryPriceListReader sub-capability so the FE gates the delivery-price-list picker (#1530)', () => {
    expect(erliAdapterManifest.supportedCapabilities).toContain('DeliveryPriceListReader');
  });

  it('should be the platform-default adapter', () => {
    expect(erliAdapterManifest.isDefault).toBe(true);
  });

  it('should declare explicit-group variant grouping so a per-variant category is treated as ordinary metadata, not a split (#1924)', () => {
    expect(erliAdapterManifest.variantGrouping).toBe('explicit-group');
  });

  it('should declare NO defaultRateLimit — a manifest default is for merchant-hosted platforms, not a marketplace (#1810 §1)', () => {
    // Erli publishes no RPM ceiling, so any number here would be a fabricated
    // policy the FE presents to the operator as an "adapter default" — and,
    // unlike WooCommerce (whose client is not wired to the transport yet), it
    // WOULD take effect, silently throttling every existing Erli connection.
    // 429s stay covered reactively by ErliHttpClient's Retry-After handling.
    expect(erliAdapterManifest.defaultRateLimit).toBeUndefined();
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

    it('should register a connection tester wired to the host outbound transport (#1810)', async () => {
      const { host, http, testerRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      const registrations = testerRegistry.register.mock.calls as unknown as [
        string,
        ConnectionTesterPort,
      ][];
      const tester = registrations[0][1];
      // A "Test connection" probe must go through the rate-limited transport, so
      // the tester resolves it BEFORE building its client — which is why a
      // rejecting credentials resolver still proves the wiring. Asserting on the
      // registered instance's behaviour (not a private field) also keeps this
      // test honest if the construction seam changes shape.
      const result = await tester.test(connection, {
        get: jest.fn().mockRejectedValue(new Error('no credentials in this fixture')),
      } as unknown as CredentialsResolverPort);

      expect(http.forConnection).toHaveBeenCalledWith(connection);
      expect(result.success).toBe(false);
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

    // #2230: registration is unconditional and the descriptor's own `enabledEnvVar`
    // carries the toggle, so all three env states must register the SAME descriptor.
    // The `'false'` case is deliberately a registration assertion, not a
    // "does not run" one: disabling happens per tick inside the scheduler, and a
    // task that is not registered writes no snapshot at all - which is exactly the
    // defect this issue fixed (every Erli mapping stuck in `Unsynced` forever).
    describe.each([
      ['unset', undefined],
      ['true', 'true'],
      ['false', 'false'],
    ])(
      'erli-offer-status-sync registration with OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED=%s',
      (_label: string, value: string | undefined) => {
        it('should register the task with its runtime env gate (#989, #2230)', () => {
          const prev = process.env.OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED;
          if (value === undefined) delete process.env.OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED;
          else process.env.OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED = value;
          try {
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
          } finally {
            if (prev === undefined) delete process.env.OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED;
            else process.env.OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED = prev;
          }
        });
      },
    );

    it('should never omit enabledDefault on the offer-status task, so an unset env var means ON (#2230)', () => {
      // The scheduler resolves an unset env var against `enabledDefault`, which
      // itself defaults to enabled. An `enabledDefault: false` here would silently
      // reinstate the opt-in posture while still registering the descriptor.
      const prev = process.env.OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED;
      delete process.env.OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED;
      try {
        const { host, schedulerTaskRegistry } = makeRegisterHost();
        createErliPlugin().register?.(host);

        const registered = (
          schedulerTaskRegistry.register.mock.calls as unknown as [SchedulerTaskConfig][]
        ).map(([task]) => task);
        const task = registered.find((t) => t.taskId === 'erli-offer-status-sync');

        expect(task).toBeDefined();
        expect(task?.enabledDefault).toBeUndefined();
      } finally {
        if (prev === undefined) delete process.env.OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED;
        else process.env.OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED = prev;
      }
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

    it('should register the inbound webhook decoder at platform type erli (#1081)', () => {
      const { host, inboundWebhookDecoderRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(inboundWebhookDecoderRegistry.register).toHaveBeenCalledWith(
        'erli',
        expect.objectContaining({ verify: expect.any(Function), extractEnvelope: expect.any(Function) }),
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

    it('should resolve OfferManager to a responsible-producer-reader adapter (#1531)', async () => {
      const adapter = await createErliPlugin().createCapabilityAdapter<OfferManagerPort>(
        connection,
        'OfferManager',
        makeDispatchHost(),
      );

      expect(isResponsibleProducerReader(adapter)).toBe(true);
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

    it('should resolve the connection-bound transport with no manifest policy argument (#1810)', async () => {
      const host = makeDispatchHost();

      await createErliPlugin().createCapabilityAdapter(connection, 'OfferManager', host);

      // Exactly one argument: passing a second would reintroduce an adapter-level
      // default cap Erli deliberately does not declare (see the manifest spec above).
      expect(host.http.forConnection).toHaveBeenCalledWith(connection);
    });

    it('should reject an unsupported capability with the SDK unsupported-capability error', async () => {
      await expect(
        createErliPlugin().createCapabilityAdapter(connection, 'ProductMaster', makeDispatchHost()),
      ).rejects.toThrow('Erli adapter does not support capability: ProductMaster');
    });

    it('should advertise OfferCreator but reject dispatching it directly — it is narrow-only via isOfferCreator on the OfferManager adapter (#1498)', async () => {
      expect(erliAdapterManifest.supportedCapabilities).toContain('OfferCreator');

      await expect(
        createErliPlugin().createCapabilityAdapter(connection, 'OfferCreator', makeDispatchHost()),
      ).rejects.toThrow('Erli adapter does not support capability: OfferCreator');
    });
  });
});

describe('ErliIntegrationModule', () => {
  it('should be a NestJS @Module class with declared imports', () => {
    const imports: unknown[] = Reflect.getMetadata('imports', ErliIntegrationModule);
    expect(Array.isArray(imports)).toBe(true);
    expect(imports.length).toBeGreaterThan(0);
  });
});
