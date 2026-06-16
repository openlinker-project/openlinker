/**
 * Shop Test ShopProductManagerPort Stub Helper (#1042)
 *
 * Boot-time-registered fake `ShopProductManagerPort` + `CategoryProvisioner`
 * adapter for the shop-publish vertical int-spec. Mirrors
 * `allegro-test-offer-manager-stub.helper.ts`: registers a test-only
 * `adapterKey='shop.test.product-publisher.v1'` (capability `'ProductPublisher'`
 * + `'CategoryProvisioner'`) with the running Nest app's `AdapterRegistryService`
 * + `AdapterFactoryResolverService`, so a connection pointed at that adapterKey
 * resolves through the production `IntegrationsService.getCapabilityAdapter`
 * path. Programmable per-variant via `setNextPublishResult`.
 *
 * @module apps/api/test/integration/helpers
 */
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import {
  ProductPublishRejectedException,
  type CategoryProvisioner,
  type CreateOfferValidationError,
  type ProvisionCategoryCommand,
  type ProvisionCategoryResult,
  type PublishProductCommand,
  type PublishProductResult,
  type ShopProductManagerPort,
} from '@openlinker/core/listings';

import type { IntegrationTestHarness } from '../setup';

export const SHOP_TEST_PUBLISHER_ADAPTER_KEY = 'shop.test.product-publisher.v1';
export const SHOP_TEST_PUBLISHER_PLATFORM_TYPE = 'woocommerce';

export type ScriptedPublishResult =
  | { kind: 'success'; externalProductId: string; status: 'draft' | 'published' }
  | { kind: 'failure'; statusCode: number; errors: CreateOfferValidationError[] };

export interface ShopTestPublisherStub {
  readonly adapterKey: string;
  readonly platformType: string;
  /** Script the next `publishProduct` for a given internal variant id. */
  setNextPublishResult(internalVariantId: string, result: ScriptedPublishResult): void;
  /** Last command the adapter received (for upsert assertions). */
  lastCommand(): PublishProductCommand | null;
  reset(): void;
}

export function installShopTestPublisherStub(
  harness: IntegrationTestHarness
): ShopTestPublisherStub {
  const adapterRegistry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = harness
    .getApp()
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  const scripts = new Map<string, ScriptedPublishResult>();
  let lastCmd: PublishProductCommand | null = null;

  const stub: ShopProductManagerPort & CategoryProvisioner = {
    publishProduct(cmd: PublishProductCommand): Promise<PublishProductResult> {
      lastCmd = cmd;
      const script = scripts.get(cmd.internalVariantId);
      if (!script) {
        return Promise.reject(
          new Error(
            `shop-test-publisher-stub: no scripted result for variant ${cmd.internalVariantId}. ` +
              `Call setNextPublishResult(variantId, ...) first.`
          )
        );
      }
      if (script.kind === 'failure') {
        return Promise.reject(
          new ProductPublishRejectedException(
            SHOP_TEST_PUBLISHER_ADAPTER_KEY,
            script.statusCode,
            script.errors
          )
        );
      }
      return Promise.resolve({
        externalProductId: script.externalProductId,
        status: script.status,
      });
    },
    provisionCategory(cmd: ProvisionCategoryCommand): Promise<ProvisionCategoryResult> {
      // Mirror the source leaf id deterministically so assertions are stable.
      const leaf = cmd.path.at(-1);
      return Promise.resolve({
        destinationCategoryId: `dest:${leaf?.sourceCategoryId ?? 'root'}`,
      });
    },
  };

  adapterRegistry.register({
    adapterKey: SHOP_TEST_PUBLISHER_ADAPTER_KEY,
    platformType: SHOP_TEST_PUBLISHER_PLATFORM_TYPE,
    supportedCapabilities: ['ProductPublisher', 'CategoryProvisioner'],
    displayName: 'Shop ProductPublisher (integration-test stub)',
    version: '0.0.0-test',
    isDefault: false,
  });

  factoryResolver.registerFactory(SHOP_TEST_PUBLISHER_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(stub as unknown as T),
  });

  return {
    adapterKey: SHOP_TEST_PUBLISHER_ADAPTER_KEY,
    platformType: SHOP_TEST_PUBLISHER_PLATFORM_TYPE,
    setNextPublishResult(internalVariantId: string, result: ScriptedPublishResult): void {
      scripts.set(internalVariantId, result);
    },
    lastCommand(): PublishProductCommand | null {
      return lastCmd;
    },
    reset(): void {
      scripts.clear();
      lastCmd = null;
    },
  };
}
