/**
 * WooCommerce Plugin Descriptor (#593)
 *
 * Framework-neutral `AdapterPlugin` describing the WooCommerce REST API v3
 * integration. Holds the static manifest, the side-registrations the host
 * wires into its registries at boot (connection tester, config shape
 * validator, credentials shape validator), and the per-connection
 * `createCapabilityAdapter` factory.
 *
 * WooCommerce needs no plugin-specific NestJS providers (no repository, no
 * token-refresh service), so the host wires it via `createNestAdapterModule`
 * — see `woocommerce-integration.module.ts`.
 *
 * @module libs/integrations/woocommerce/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { WooCommerceConnectionTesterAdapter } from './infrastructure/adapters/woocommerce-connection-tester.adapter';
import { WooCommerceConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/woocommerce-connection-config-shape-validator.adapter';
import { WooCommerceConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/woocommerce-connection-credentials-shape-validator.adapter';
import { WooCommerceHttpClient } from './infrastructure/http/woocommerce-http-client';
import { WooCommerceProductMapper } from './infrastructure/mappers/woocommerce-product.mapper';
import { WooCommerceProductMasterAdapter } from './infrastructure/adapters/product-master/woocommerce-product-master.adapter';
import { WooCommerceOrderProcessorAdapter } from './infrastructure/adapters/order-processor/woocommerce-order-processor.adapter';
import { WooCommerceConfigException } from './domain/exceptions/woocommerce-config.exception';
import type { WooCommerceCredentials } from './domain/types/woocommerce-credentials.types';
import type { WooCommerceConnectionConfig } from './domain/types/woocommerce-config.types';
import { WooCommerceInventoryMasterAdapter } from './infrastructure/adapters/inventory-master/woocommerce-inventory-master.adapter';
import { WooCommerceOrderSourceAdapter } from './infrastructure/adapters/woocommerce-order-source.adapter';
import { WooCommerceProductPublisherAdapter } from './infrastructure/adapters/product-publisher/woocommerce-product-publisher.adapter';
import { WooCommerceOfferManagerAdapter } from './infrastructure/adapters/offer-manager/woocommerce-offer-manager.adapter';
import { WooCommerceAuthFailureClassifierAdapter } from './infrastructure/adapters/woocommerce-auth-failure-classifier.adapter';
import { WooCommerceWebhookEventTranslatorAdapter } from './infrastructure/adapters/woocommerce-webhook-event-translator.adapter';
import { buildWooCommerceSchedulerTasks } from './infrastructure/scheduler/woocommerce-scheduler-tasks';

/**
 * Static plugin manifest (#575).
 *
 * Exported as a top-level `const` so host-side tooling (manifest-diff CLIs,
 * capability-matrix dashboards, compatibility checks at boot) can read
 * `adapterKey` / `supportedCapabilities` / `version` without instantiating
 * the plugin. `createWooCommercePlugin().manifest` returns this same
 * reference, so static and runtime views can't drift.
 */
export const woocommerceAdapterManifest: AdapterMetadata = {
  adapterKey: 'woocommerce.restapi.v3',
  platformType: 'woocommerce',
  supportedCapabilities: [
    'ProductMaster',
    'InventoryMaster',
    'OrderProcessorManager',
    'OrderSource',
    'ProductPublisher',
    'CategoryProvisioner',
    // Inventory write-back to published products (#1498). Quantity-only —
    // WooCommerce is a destination shop, not a marketplace: no OfferCreator /
    // OfferLister sub-capabilities, so offer-creation flows (gated on
    // OfferCreator) never surface WC. Defaults OFF on new connections when
    // InventoryMaster is also in the manifest set (ConnectionService excludes
    // it), and is mutually exclusive with InventoryMaster per connection —
    // the inventory master must never be a write-back target.
    'OfferManager',
  ],
  displayName: 'WooCommerce REST API v3',
  version: '1.0.0',
  isDefault: true,
};

/** Short brand label for domain-exception prefixes (manifest.displayName is too long). */
const WOOCOMMERCE_BRAND = 'WooCommerce';

export function createWooCommercePlugin(): AdapterPlugin {
  return {
    manifest: woocommerceAdapterManifest,

    register(host: HostServices): void {
      host.connectionTesterRegistry.register(
        woocommerceAdapterManifest.adapterKey,
        new WooCommerceConnectionTesterAdapter(),
      );
      host.connectionConfigShapeValidatorRegistry.register(
        woocommerceAdapterManifest.adapterKey,
        new WooCommerceConnectionConfigShapeValidatorAdapter(WOOCOMMERCE_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        woocommerceAdapterManifest.adapterKey,
        new WooCommerceConnectionCredentialsShapeValidatorAdapter(WOOCOMMERCE_BRAND),
      );
      host.authFailureClassifierRegistry.register(
        woocommerceAdapterManifest.adapterKey,
        new WooCommerceAuthFailureClassifierAdapter(),
      );
      // Inbound webhook-event translator (ADR-015 / #1548) — decodes WC order
      // webhook events into neutral CanonicalInboundEvents. The webhook
      // PROVISIONER is registered by `WooCommerceWebhookProvisioningModule`
      // (it needs NestJS-injected ConnectionPort + IWebhookSecretService, which
      // are not in the HostServices bag).
      host.webhookEventTranslatorRegistry.register(
        woocommerceAdapterManifest.adapterKey,
        new WooCommerceWebhookEventTranslatorAdapter(),
      );
      for (const task of buildWooCommerceSchedulerTasks()) {
        host.schedulerTaskRegistry.register(task);
      }
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      if (!connection.credentialsRef) {
        return Promise.reject(
          new WooCommerceConfigException(
            `Connection ${connection.id} is missing credentialsRef — save credentials before using this capability.`,
            connection.id,
          ),
        );
      }
      // NEVER log credentials — contains consumerKey + consumerSecret
      const credentials = await host.credentialsResolver.get<WooCommerceCredentials>(
        connection.credentialsRef,
      );
      const config = (connection.config ?? {}) as unknown as WooCommerceConnectionConfig;
      const httpClient = new WooCommerceHttpClient(
        config.siteUrl,
        credentials.consumerKey,
        credentials.consumerSecret,
      );
      const mapper = new WooCommerceProductMapper({});
      try {
        return Promise.resolve(
          dispatchCapability<T>(
            capability,
            {
              ProductMaster: () =>
                new WooCommerceProductMasterAdapter(
                  httpClient,
                  host.identifierMapping,
                  mapper,
                  connection,
                ),
              InventoryMaster: () =>
                new WooCommerceInventoryMasterAdapter(
                  httpClient,
                  host.identifierMapping,
                  connection,
                ),
              OrderProcessorManager: () =>
                new WooCommerceOrderProcessorAdapter(
                  httpClient,
                  host.identifierMapping,
                  connection,
                ),
              OrderSource: () => new WooCommerceOrderSourceAdapter(httpClient, connection),
              // ProductPublisher + CategoryProvisioner are the same instance —
              // CategoryProvisioner is a sub-capability of ShopProductManagerPort,
              // narrowed at the call site via isCategoryProvisioner.
              ProductPublisher: () =>
                new WooCommerceProductPublisherAdapter(httpClient, connection),
              CategoryProvisioner: () =>
                new WooCommerceProductPublisherAdapter(httpClient, connection),
              OfferManager: () => new WooCommerceOfferManagerAdapter(httpClient, connection),
            },
            WOOCOMMERCE_BRAND,
          ),
        );
      } catch (err) {
        return Promise.reject(err as Error);
      }
    },
  };
}
