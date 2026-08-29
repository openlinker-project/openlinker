/**
 * PrestaShop Plugin Descriptor — unit tests
 *
 * Focused coverage for the plugin's `createCapabilityAdapter` dispatch:
 *
 *   - The `OrderProcessorManager` null-guard fires a descriptive error when
 *     the underlying factory yields no OPM adapter (which it does when the
 *     customer-side deps weren't wired in — see
 *     `prestashop-adapter.factory.ts` § "Create orderProcessorManager only
 *     if customer provisioning dependencies … are provided"). The branch
 *     is one of the few in the plugin file that can't be reached by a
 *     mis-typed capability name, so the dispatch helper alone doesn't
 *     cover it.
 *
 *   - The unsupported-capability path is exercised via the SDK's
 *     `dispatchCapability` helper, which the plugin delegates to.
 *
 * @module libs/integrations/prestashop/src/__tests__
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { WebhookSecretProviderPort } from '@openlinker/core/integrations';
import type { HostServices } from '@openlinker/plugin-sdk';

import { PrestashopAdapterFactory } from '../application/prestashop-adapter.factory';
import type { PrestashopAdapters } from '../application/interfaces/prestashop-adapter.factory.interface';
import { createPrestashopPlugin, prestashopAdapterManifest } from '../prestashop-plugin';
import type { PrestashopCustomerProvisioner } from '../infrastructure/provisioners/prestashop-customer-provisioner';
import type { PrestashopAddressProvisioner } from '../infrastructure/provisioners/prestashop-address-provisioner';
import type { PrestashopWebhookProvisioningAdapter } from '../infrastructure/adapters/prestashop-webhook-provisioning.adapter';

function makeDeps(): Parameters<typeof createPrestashopPlugin>[0] {
  // The plugin descriptor constructs one `PrestashopAdapterFactory(deps...)` in
  // its closure (#2592) and the factory is fully stubbed below via
  // `jest.spyOn`. The deps only need to satisfy the type; their runtime values
  // are never reached.
  return {
    customerProvisioner: {} as PrestashopCustomerProvisioner,
    addressProvisioner: {} as PrestashopAddressProvisioner,
    customerProjectionRepository: {} as CustomerProjectionRepositoryPort,
    mappingConfigService: {} as IMappingConfigService,
    webhookSecretProvider: {} as WebhookSecretProviderPort,
    webhookProvisioningAdapter: {} as PrestashopWebhookProvisioningAdapter,
  };
}

function makeHost(): HostServices {
  return {
    identifierMapping: {} as IdentifierMappingPort,
    credentialsResolver: {} as CredentialsResolverPort,
    cache: undefined,
    // The plugin's `createCapabilityAdapter` resolves a connection-bound
    // transport via `host.http.forConnection(connection, defaultRateLimit)` (#1810)
    // before constructing the adapter factory — `http` must be stubbed or
    // that call throws. The other host-services slots
    // (`connectionTesterRegistry`, …) are exercised by `register(host)` only,
    // which we don't invoke here.
    http: { forConnection: jest.fn().mockReturnValue(jest.fn()), evict: jest.fn() },
  } as Partial<HostServices> as HostServices;
}

const makeConnection = (): Connection =>
  ({
    id: 'connection-1',
    platformType: 'prestashop',
  }) as Connection;

describe('createPrestashopPlugin → createCapabilityAdapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the productMaster adapter for capability=ProductMaster', async () => {
    const stubProductMaster = { kind: 'productMaster' };
    jest.spyOn(PrestashopAdapterFactory.prototype, 'createAdapters').mockResolvedValue({
      productMaster: stubProductMaster,
      inventoryMaster: {},
      orderSource: {},
      orderProcessorManager: undefined,
    } as unknown as PrestashopAdapters);

    const plugin = createPrestashopPlugin(makeDeps());
    const adapter = await plugin.createCapabilityAdapter(
      makeConnection(),
      'ProductMaster',
      makeHost(),
    );

    expect(adapter).toBe(stubProductMaster);
  });

  it('resolves the connection-bound transport via host.http.forConnection with the manifest defaultRateLimit (#1810)', async () => {
    jest.spyOn(PrestashopAdapterFactory.prototype, 'createAdapters').mockResolvedValue({
      productMaster: {},
      inventoryMaster: {},
      orderSource: {},
      orderProcessorManager: undefined,
    } as unknown as PrestashopAdapters);

    const host = makeHost();
    const connection = makeConnection();
    const plugin = createPrestashopPlugin(makeDeps());
    await plugin.createCapabilityAdapter(connection, 'ProductMaster', host);

    expect(host.http.forConnection).toHaveBeenCalledWith(connection, prestashopAdapterManifest.defaultRateLimit);
  });

  // The factory holds every per-connection resolver cache (shop currency, tax
  // rate, features, category paths). Building one per capability resolution
  // threw all of them away on every child job - measured at 2 of 7.96 requests
  // per SKU for the shop-currency pair alone (#2592). One factory for the
  // lifetime of the plugin is the fix, and this pins it: two resolutions must
  // run on the SAME instance.
  it('reuses one adapter factory across capability resolutions (#2592)', async () => {
    const createAdapters = jest
      .spyOn(PrestashopAdapterFactory.prototype, 'createAdapters')
      .mockResolvedValue({
        productMaster: {},
        inventoryMaster: {},
        orderSource: {},
        orderProcessorManager: undefined,
      } as unknown as PrestashopAdapters);

    const plugin = createPrestashopPlugin(makeDeps());
    await plugin.createCapabilityAdapter(makeConnection(), 'ProductMaster', makeHost());
    await plugin.createCapabilityAdapter(makeConnection(), 'InventoryMaster', makeHost());

    expect(createAdapters).toHaveBeenCalledTimes(2);
    expect(new Set(createAdapters.mock.instances).size).toBe(1);
  });

  it('throws when OrderProcessorManager is requested but the factory wired up no OPM adapter', async () => {
    // Mirror the runtime state described at `prestashop-adapter.factory.ts:111-117`:
    // customer-provisioning deps absent → `adapters.orderProcessorManager === undefined`.
    jest.spyOn(PrestashopAdapterFactory.prototype, 'createAdapters').mockResolvedValue({
      productMaster: {},
      inventoryMaster: {},
      orderSource: {},
      orderProcessorManager: undefined,
    } as unknown as PrestashopAdapters);

    const plugin = createPrestashopPlugin(makeDeps());

    await expect(
      plugin.createCapabilityAdapter(makeConnection(), 'OrderProcessorManager', makeHost()),
    ).rejects.toThrow(
      'OrderProcessorManager adapter is not available. ' +
        'Customer provisioner and customer projection repository are required for order processing.',
    );
  });

  it('returns the orderProcessorManager adapter when present', async () => {
    const stubOpm = { kind: 'orderProcessorManager' };
    jest.spyOn(PrestashopAdapterFactory.prototype, 'createAdapters').mockResolvedValue({
      productMaster: {},
      inventoryMaster: {},
      orderSource: {},
      orderProcessorManager: stubOpm,
    } as unknown as PrestashopAdapters);

    const plugin = createPrestashopPlugin(makeDeps());
    const adapter = await plugin.createCapabilityAdapter(
      makeConnection(),
      'OrderProcessorManager',
      makeHost(),
    );

    expect(adapter).toBe(stubOpm);
  });

  it('returns the productPublisher adapter for capability=ProductPublisher', async () => {
    const stubProductPublisher = { kind: 'productPublisher' };
    jest.spyOn(PrestashopAdapterFactory.prototype, 'createAdapters').mockResolvedValue({
      productMaster: {},
      inventoryMaster: {},
      orderSource: {},
      orderProcessorManager: undefined,
      productPublisher: stubProductPublisher,
    } as unknown as PrestashopAdapters);

    const plugin = createPrestashopPlugin(makeDeps());
    const adapter = await plugin.createCapabilityAdapter(
      makeConnection(),
      'ProductPublisher',
      makeHost(),
    );

    expect(adapter).toBe(stubProductPublisher);
  });

  it('returns the productPublisher adapter for capability=CategoryProvisioner', async () => {
    const stubProductPublisher = { kind: 'productPublisher' };
    jest.spyOn(PrestashopAdapterFactory.prototype, 'createAdapters').mockResolvedValue({
      productMaster: {},
      inventoryMaster: {},
      orderSource: {},
      orderProcessorManager: undefined,
      productPublisher: stubProductPublisher,
    } as unknown as PrestashopAdapters);

    const plugin = createPrestashopPlugin(makeDeps());
    const adapter = await plugin.createCapabilityAdapter(
      makeConnection(),
      'CategoryProvisioner',
      makeHost(),
    );

    expect(adapter).toBe(stubProductPublisher);
  });

  it('throws for an unsupported capability via the dispatchCapability helper', async () => {
    jest.spyOn(PrestashopAdapterFactory.prototype, 'createAdapters').mockResolvedValue({
      productMaster: {},
      inventoryMaster: {},
      orderSource: {},
      orderProcessorManager: undefined,
      productPublisher: {},
    } as unknown as PrestashopAdapters);

    const plugin = createPrestashopPlugin(makeDeps());

    await expect(
      plugin.createCapabilityAdapter(makeConnection(), 'OfferManager', makeHost()),
    ).rejects.toThrow(
      'PrestaShop adapter does not support capability: OfferManager. ' +
        'Supported capabilities: ProductMaster, InventoryMaster, OrderSource, OrderProcessorManager, ProductPublisher, CategoryProvisioner',
    );
  });
});

describe('createPrestashopPlugin → register(host)', () => {
  // Wire-up coverage for #586 / #587. The plugin must self-register the
  // config and credentials shape-validators at its adapterKey so the host
  // can replace the legacy platform-switch in ConnectionService.
  function makeRegisterHost(): {
    host: HostServices;
    configRegistry: { register: jest.Mock };
    credentialsRegistry: { register: jest.Mock };
    retryClassifierRegistry: { register: jest.Mock };
  } {
    const configRegistry = { register: jest.fn() };
    const credentialsRegistry = { register: jest.fn() };
    const retryClassifierRegistry = { register: jest.fn() };
    const host = {
      identifierMapping: {} as IdentifierMappingPort,
      credentialsResolver: {} as CredentialsResolverPort,
      cache: undefined,
      // Minimal logger stub — `register()` may emit a `debug` line on the
      // no-ConfigService path (#834). Return an object with the four
      // LogLevel methods so any of them are safely callable.
      logger: jest.fn().mockReturnValue({
        log: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
      connectionTesterRegistry: { register: jest.fn() },
      webhookProvisioningRegistry: { register: jest.fn() },
      webhookEventTranslatorRegistry: { register: jest.fn() },
      connectionConfigShapeValidatorRegistry: configRegistry,
      connectionCredentialsShapeValidatorRegistry: credentialsRegistry,
      retryClassifierRegistry,
      schedulerTaskRegistry: { register: jest.fn() },
    } as unknown as HostServices;
    return { host, configRegistry, credentialsRegistry, retryClassifierRegistry };
  }

  it('registers the config-shape validator at adapterKey prestashop.webservice.v1', () => {
    const { host, configRegistry } = makeRegisterHost();
    createPrestashopPlugin(makeDeps()).register?.(host);

    expect(configRegistry.register).toHaveBeenCalledWith(
      'prestashop.webservice.v1',
      expect.objectContaining({ validate: expect.any(Function) }),
    );
  });

  it('registers the credentials-shape validator at adapterKey prestashop.webservice.v1', () => {
    const { host, credentialsRegistry } = makeRegisterHost();
    createPrestashopPlugin(makeDeps()).register?.(host);

    expect(credentialsRegistry.register).toHaveBeenCalledWith(
      'prestashop.webservice.v1',
      expect.objectContaining({ validate: expect.any(Function) }),
    );
  });

  // #2052 — the package registered no retry classifier at all, so every
  // PrestaShop failure was retryable and a tax-configuration error burned five
  // attempts with backoff before an operator saw it.
  it('registers the retry classifier at adapterKey prestashop.webservice.v1', () => {
    const { host, retryClassifierRegistry } = makeRegisterHost();
    createPrestashopPlugin(makeDeps()).register?.(host);

    expect(retryClassifierRegistry.register).toHaveBeenCalledWith(
      'prestashop.webservice.v1',
      expect.objectContaining({ isNonRetryable: expect.any(Function) }),
    );
  });
});
