/**
 * Erli Plugin Descriptor (#980)
 *
 * Framework-neutral `AdapterPlugin` describing the Erli Shop API v1
 * integration. `supportedCapabilities` lists each capability in lockstep with
 * the adapter that delivers it — a registered manifest must declare only
 * capabilities its factory can construct (`IntegrationsService
 * .listCapabilityAdapters` treats any non-`AdapterNotFoundException` factory
 * error as fatal). #984 adds `'OfferManager'` (offers) with
 * `ErliOfferManagerAdapter`; #993 adds `'OrderSource'`.
 *
 * Side-registrations land in `register(host)`: connection tester +
 * config/credentials shape validators (#982), retry + auth-failure classifiers
 * over the Erli exception hierarchy (#984, ADR-008 — without these a revoked
 * static key would retry-storm instead of flipping the connection to
 * `needs_reauth`).
 *
 * #1198: `createErliPlugin` now accepts an optional `ErliPluginDeps` bag. The
 * `inventoryQuery` dep enables the `OrderStatusWriteback` `cancelled`
 * stock-restore path in `ErliOrderSourceAdapter`. Erli's module was converted
 * from `createNestAdapterModule` to a custom `@Module` class to inject this dep
 * from the DI container — see `erli-integration.module.ts`.
 *
 * @module libs/integrations/erli/src
 * @see {@link erliAdapterManifest} for the static manifest (#575 pattern)
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { IInventoryQueryService } from '@openlinker/core/inventory';
import { ErliAdapterFactory } from './application/erli-adapter.factory';
import { ERLI_ADAPTER_KEY } from './erli.constants';
import { ErliAuthFailureClassifierAdapter } from './infrastructure/adapters/erli-auth-failure-classifier.adapter';
import { ErliConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/erli-connection-config-shape-validator.adapter';
import { ErliConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/erli-connection-credentials-shape-validator.adapter';
import { ErliConnectionTesterAdapter } from './infrastructure/adapters/erli-connection-tester.adapter';
import { ErliEmailNormalizerAdapter } from './infrastructure/adapters/erli-email-normalizer.adapter';
import { ErliRetryClassifierAdapter } from './infrastructure/adapters/erli-retry-classifier.adapter';
import { ErliInboundWebhookDecoderAdapter } from './infrastructure/adapters/erli-inbound-webhook-decoder.adapter';
import { ErliWebhookEventTranslator } from './infrastructure/adapters/erli-webhook-event-translator.adapter';
import { buildErliSchedulerTasks } from './infrastructure/scheduler/erli-scheduler-tasks';

/** Human-readable plugin identifier surfaced in dispatch errors (#573). */
const ERLI_BRAND = 'Erli';

/**
 * Static plugin manifest (#575).
 *
 * Exported as a top-level `const` so host-side tooling can read
 * `adapterKey` / `supportedCapabilities` / `version` without instantiating
 * the plugin. `createErliPlugin().manifest` returns this same reference, so
 * static and runtime views can't drift.
 */
export const erliAdapterManifest: AdapterMetadata = {
  adapterKey: ERLI_ADAPTER_KEY,
  platformType: 'erli',
  // Each capability is added by the PR that ships its adapter, in lockstep with
  // a dispatch-table entry below: #984 → 'OfferManager', #993 → 'OrderSource'.
  // 'OfferCreator' (#1498) is an OfferManager sub-capability the adapter
  // already implements — advertised (no dispatch entry; callers narrow with
  // `isOfferCreator`) so FE offer-creation flows, gated on `OfferCreator`,
  // keep showing Erli after WooCommerce's quantity-only OfferManager landed.
  // 'ResponsibleProducerReader' (#1531) and 'DeliveryPriceListReader' (#1530) are
  // likewise advertised-without-dispatch OfferManager sub-capabilities — the FE
  // gates the producer / delivery-price-list pickers on them; callers narrow the
  // dispatched OfferManager adapter with `isResponsibleProducerReader` /
  // `isDeliveryPriceListReader`, never `getCapabilityAdapter('...')`.
  supportedCapabilities: [
    'OfferManager',
    'OrderSource',
    'OfferCreator',
    'ResponsibleProducerReader',
    'DeliveryPriceListReader',
  ],
  displayName: 'Erli Shop API v1',
  version: '1.0.0',
  isDefault: true,
};

/**
 * Plugin-specific dependencies not available from the framework-neutral
 * `HostServices` bag. Passed to `createErliPlugin` so the DI host can supply
 * them from the NestJS container without widening the SDK `HostServices`
 * contract (#1198 / ADR-003 plugin-sdk trust model).
 */
export interface ErliPluginDeps {
  /**
   * Master-inventory read service for the `OrderStatusWriteback` `cancelled`
   * stock-restore path (#1198). When absent the path reports `unsupported`.
   */
  inventoryQuery: IInventoryQueryService;
}

export function createErliPlugin(deps?: ErliPluginDeps): AdapterPlugin {
  return {
    manifest: erliAdapterManifest,

    register(host: HostServices): void {
      host.connectionConfigShapeValidatorRegistry.register(
        ERLI_ADAPTER_KEY,
        new ErliConnectionConfigShapeValidatorAdapter(ERLI_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        ERLI_ADAPTER_KEY,
        new ErliConnectionCredentialsShapeValidatorAdapter(ERLI_BRAND),
      );
      host.connectionTesterRegistry.register(ERLI_ADAPTER_KEY, new ErliConnectionTesterAdapter());
      // Buyer-identity email normalizer (#995). PROVISIONAL (#992): baseline-only
      // (trim + lowercase, NO +suffix strip) — the per-platform seam + regression
      // anchor; a domain-gated strip mirroring Allegro lands once Erli's relay
      // domain is confirmed.
      host.emailNormalizerRegistry.register(ERLI_ADAPTER_KEY, new ErliEmailNormalizerAdapter());
      // Classifiers (#984). The runner dispatches these OR-across-all (it holds
      // the raw error, not an adapterKey), so the key is a bookkeeping label;
      // safe because each classifier only recognises Erli's own exceptions.
      host.retryClassifierRegistry.register(ERLI_ADAPTER_KEY, new ErliRetryClassifierAdapter());
      host.authFailureClassifierRegistry.register(
        ERLI_ADAPTER_KEY,
        new ErliAuthFailureClassifierAdapter(),
      );
      // Scheduler tasks: offer-status reconciliation (#989) and the
      // `erli-orders-poll` order-source poll (#993) — `buildErliSchedulerTasks`
      // now returns both. Registered unconditionally; each task's env gate
      // (OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED / OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED)
      // is re-checked by the scheduler at each tick.
      for (const task of buildErliSchedulerTasks()) {
        host.schedulerTaskRegistry.register(task);
      }
      // Inbound webhook path (#996, #1081, ADR-015 / ADR-021).
      // Decoder (provider-keyed by platformType): authenticates + decodes real
      // Erli deliveries so they are no longer rejected by the host's fail-closed
      // OL-HMAC default (#1081). PROVISIONAL (#992): header name + body shape
      // isolated in erli-webhook.types.ts — single reconciliation point when
      // sandbox confirms. The inbox poll (#993) remains the authoritative path.
      host.inboundWebhookDecoderRegistry.register(
        erliAdapterManifest.platformType,
        new ErliInboundWebhookDecoderAdapter(),
      );
      // Translator (adapterKey-keyed): maps the decoded envelope to a neutral
      // CanonicalInboundEvent that the core routing policy dispatches to
      // marketplace.order.sync.
      host.webhookEventTranslatorRegistry.register(
        ERLI_ADAPTER_KEY,
        new ErliWebhookEventTranslator(),
      );
      // The webhook PROVISIONER (#996) is registered by `ErliWebhookProvisioningModule`,
      // NOT here: it needs NestJS-injected `ConnectionPort` + `IWebhookSecretService`
      // that aren't in the framework-neutral `HostServices` bag.
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const factory = new ErliAdapterFactory();
      const adapters = await factory.createAdapters(
        connection,
        host.identifierMapping,
        host.credentialsResolver,
        // #1066: distributed frozen-stock flag. Optional on HostServices — when
        // absent the offer adapter fails open (pushes stock = pre-#1066 behaviour).
        host.cache,
        // #1198: master-inventory query for the `cancelled` stock-restore path.
        // Only present when `ErliIntegrationModule` injected `inventoryQuery` via
        // `createErliPlugin({ inventoryQuery: this.inventoryQuery })`.
        deps?.inventoryQuery,
      );
      return dispatchCapability<T>(
        capability,
        {
          OfferManager: () => adapters.offerManager,
          OrderSource: () => adapters.orderSource,
        },
        ERLI_BRAND,
      );
    },
  };
}
