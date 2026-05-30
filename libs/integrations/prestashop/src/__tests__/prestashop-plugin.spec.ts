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
import { createPrestashopPlugin } from '../prestashop-plugin';
import type { PrestashopCustomerProvisioner } from '../infrastructure/provisioners/prestashop-customer-provisioner';
import type { PrestashopAddressProvisioner } from '../infrastructure/provisioners/prestashop-address-provisioner';
import type { PrestashopWebhookProvisioningAdapter } from '../infrastructure/adapters/prestashop-webhook-provisioning.adapter';

function makeDeps(): Parameters<typeof createPrestashopPlugin>[0] {
  // The plugin descriptor's `createCapabilityAdapter` constructs a fresh
  // `PrestashopAdapterFactory(deps...)` per call but the factory is fully
  // stubbed below via `jest.spyOn`. The deps only need to satisfy the type;
  // their runtime values are never reached.
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
    // The plugin's `createCapabilityAdapter` only touches `identifierMapping`
    // and `credentialsResolver`; the other host-services slots
    // (`connectionTesterRegistry`, …) are exercised by `register(host)` only,
    // which we don't invoke here.
  } as HostServices;
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

  it('throws for an unsupported capability via the dispatchCapability helper', async () => {
    jest.spyOn(PrestashopAdapterFactory.prototype, 'createAdapters').mockResolvedValue({
      productMaster: {},
      inventoryMaster: {},
      orderSource: {},
      orderProcessorManager: undefined,
    } as unknown as PrestashopAdapters);

    const plugin = createPrestashopPlugin(makeDeps());

    await expect(
      plugin.createCapabilityAdapter(makeConnection(), 'OfferManager', makeHost()),
    ).rejects.toThrow(
      'PrestaShop adapter does not support capability: OfferManager. ' +
        'Supported capabilities: ProductMaster, InventoryMaster, OrderSource, OrderProcessorManager',
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
  } {
    const configRegistry = { register: jest.fn() };
    const credentialsRegistry = { register: jest.fn() };
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
      schedulerTaskRegistry: { register: jest.fn() },
    } as unknown as HostServices;
    return { host, configRegistry, credentialsRegistry };
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
});
