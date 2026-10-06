/**
 * Shoper Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the Shoper REST API integration.
 * Registers the adapter, a connection tester, the config + credentials shape
 * validators and the auth-failure classifier (#3639), plus the read side of
 * `ProductMaster` (#3675). Each further capability enters
 * `supportedCapabilities` together with the adapter that delivers it (the Erli
 * #980 rule), in its own task of the Shoper milestone (#3640-#3644); until
 * then asking for one fails with the SDK's uniform "does not support" error.
 *
 * Not declared, and each for a stated reason:
 *   - `defaultRateLimit` - Shoper's real request ceiling is UNKNOWN, not
 *     "unreached": every response carries `x-shop-api-limit: 10` (SPIKE-3638
 *     C5), unit unstated, and the 25-request burst that was never throttled
 *     (C6) is explicitly not evidence of no limit (open risk 2). Inventing a
 *     number is worse than none, so a connection whose operator never sets
 *     `config.rateLimit` is paced by nothing on OpenLinker's side. Revisit once
 *     the longer sustained-rate test risk 2 asks for has run.
 *   - penalty-free deferral for 429 / 503 (`getRetryDeferral`) - the request
 *     ceiling is unknown, so there is no honest delay to quote.
 *   - Sales documents (invoice / receipt) - confirmed absent from Shoper's API
 *     (SPIKE-3638), a deliberate scope boundary, not a gap.
 *
 * @module libs/integrations/shoper/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';

import { SHOPER_ADAPTER_KEY, SHOPER_BRAND, SHOPER_PLATFORM_TYPE } from './shoper.constants';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { ShoperCustomerProvisioner } from './infrastructure/provisioners/shoper-customer.provisioner';
import { ShoperAdapterFactory, type ShoperAdapters } from './application/shoper-adapter.factory';
import { ShoperInboundWebhookDecoderAdapter } from './infrastructure/adapters/shoper-inbound-webhook-decoder.adapter';
import { ShoperWebhookEventTranslatorAdapter } from './infrastructure/adapters/shoper-webhook-event-translator.adapter';
import { ShoperRetryClassifierAdapter } from './infrastructure/adapters/shoper-retry-classifier.adapter';
import { ShoperAuthFailureClassifierAdapter } from './infrastructure/adapters/shoper-auth-failure-classifier.adapter';
import { ShoperConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/shoper-connection-config-shape-validator.adapter';
import { ShoperConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/shoper-connection-credentials-shape-validator.adapter';
import { ShoperConnectionTesterAdapter } from './infrastructure/adapters/shoper-connection-tester.adapter';

/**
 * Static plugin manifest (#575). Exported as a top-level `const` so host
 * tooling can read it without instantiating the plugin;
 * `createShoperPlugin().manifest` returns this same reference.
 */
export const shoperAdapterManifest: AdapterMetadata = {
  adapterKey: SHOPER_ADAPTER_KEY,
  platformType: SHOPER_PLATFORM_TYPE,
  // A capability name enters this list together with the adapter that delivers it.
  supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderProcessorManager', 'OrderSource'],
  // `OrderSource` is likewise opt-in: ingesting a shop's orders is polling load
  // against a shop whose request ceiling is unknown (SPIKE-3638 C6), and a
  // connection that exists only as a catalogue master must not start doing it.
  // `OrderProcessorManager` is supported but NOT on by default. Without this, a
  // connection created with no explicit capability list gets every capability
  // in the manifest, and `OrderSyncService` fans each ingested order out to every
  // active `OrderProcessorManager` connection - so a Shoper shop meant only as a
  // catalogue / stock master would start receiving orders. An operator who wants
  // Shoper as an order destination enables it explicitly (#3350 mechanism).
  defaultEnabledCapabilities: ['ProductMaster', 'InventoryMaster'],
  displayName: 'Shoper REST API',
  version: '1.0.0',
  isDefault: true,
};

/** Nest-provided collaborators the plugin cannot get from the `HostServices` bag. */
export interface ShoperPluginDeps {
  readonly customerProvisioner: ShoperCustomerProvisioner;
  readonly mappingConfigService: IMappingConfigService;
}

export function createShoperPlugin(deps?: ShoperPluginDeps): AdapterPlugin {
  // One factory for the plugin's lifetime. It holds no state: the connection,
  // its credentials and the HTTP client are all parameters of `createAdapters`.
  const factory = new ShoperAdapterFactory();

  return {
    manifest: shoperAdapterManifest,

    register(host: HostServices): void {
      host.connectionTesterRegistry.register(
        SHOPER_ADAPTER_KEY,
        new ShoperConnectionTesterAdapter(host.http),
      );
      host.connectionConfigShapeValidatorRegistry.register(
        SHOPER_ADAPTER_KEY,
        new ShoperConnectionConfigShapeValidatorAdapter(SHOPER_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        SHOPER_ADAPTER_KEY,
        new ShoperConnectionCredentialsShapeValidatorAdapter(SHOPER_BRAND),
      );
      host.authFailureClassifierRegistry.register(
        SHOPER_ADAPTER_KEY,
        new ShoperAuthFailureClassifierAdapter(),
      );
      host.retryClassifierRegistry.register(
        SHOPER_ADAPTER_KEY,
        new ShoperRetryClassifierAdapter(),
      );
      // Inbound webhooks (#3644). The decoder is keyed by PLATFORM TYPE (the
      // `:provider` segment of the delivery route) and authenticates the token in
      // the delivery URL, since Shoper's own signature is unresolved (SPIKE-3638
      // X5). The translator is keyed by adapter key. The PROVISIONER is registered
      // by `ShoperIntegrationModule`: it needs `ConnectionPort` and
      // `IWebhookSecretService`, which the `HostServices` bag does not carry.
      host.inboundWebhookDecoderRegistry.register(
        shoperAdapterManifest.platformType,
        new ShoperInboundWebhookDecoderAdapter(),
      );
      host.webhookEventTranslatorRegistry.register(
        SHOPER_ADAPTER_KEY,
        new ShoperWebhookEventTranslatorAdapter(),
      );
    },

    createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      // Dispatch FIRST, build lazily: an unsupported capability must fail with
      // the SDK's uniform "does not support" error before any credential is
      // decrypted, and a bad connection config must not mask that error.
      const build = async (): Promise<ShoperAdapters> =>
        factory.createAdapters(
          connection,
          host.identifierMapping,
          host.credentialsResolver,
          // Connection-bound outbound transport (#1810). No manifest default rate
          // limit is passed - this plugin declares none (SPIKE-3638 C6).
          host.http.forConnection(connection),
          host.cache,
          deps?.customerProvisioner,
          deps?.mappingConfigService,
        );
      try {
        return dispatchCapability<Promise<T>>(
          capability,
          {
            ProductMaster: async () => (await build()).productMaster,
            InventoryMaster: async () => (await build()).inventoryMaster,
            OrderSource: async () => (await build()).orderSource,
            OrderProcessorManager: async () => {
              const { orderProcessor } = await build();
              if (orderProcessor === null) {
                throw new Error(
                  `${SHOPER_BRAND} OrderProcessorManager needs its customer provisioner - ` +
                    'resolve this capability through ShoperIntegrationModule, not a bare createShoperPlugin().',
                );
              }
              return orderProcessor;
            },
          },
          SHOPER_BRAND,
        );
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}
