/**
 * InPost Plugin Descriptor (#593)
 *
 * Framework-neutral `AdapterPlugin` for the InPost ShipX v1 integration. Holds
 * the static manifest, the config-shape validator side-registration, and the
 * per-connection `createCapabilityAdapter` factory (which resolves credentials
 * + builds the shipping adapter, then dispatches by capability name).
 *
 * InPost needs no plugin-specific NestJS providers (no repository, no
 * token-refresh service), so the host wires it via `createNestAdapterModule`
 * — see `inpost-integration.module.ts`.
 *
 * @module libs/integrations/inpost/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { createInpostShippingAdapter } from './application/inpost-adapter.factory';
import { InpostAuthFailureClassifierAdapter } from './infrastructure/adapters/inpost-auth-failure-classifier.adapter';
import { InpostConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/inpost-connection-config-shape-validator.adapter';
import { InpostConnectionTesterAdapter } from './infrastructure/adapters/inpost-connection-tester.adapter';
import { InpostInboundWebhookDecoderAdapter } from './infrastructure/adapters/inpost-inbound-webhook-decoder.adapter';
import { InpostWebhookEventTranslatorAdapter } from './infrastructure/adapters/inpost-webhook-event-translator.adapter';
import { buildInpostSchedulerTasks } from './infrastructure/scheduler/inpost-scheduler-tasks';

/**
 * Static plugin manifest (#575). Exported as a top-level `const` so host-side
 * tooling can read `adapterKey` / `supportedCapabilities` / `version` without
 * instantiating the plugin. `createInpostPlugin().manifest` returns the same
 * reference, so static and runtime views can't drift.
 */
export const inpostAdapterManifest: AdapterMetadata = {
  adapterKey: 'inpost.shipx.v1',
  platformType: 'inpost',
  supportedCapabilities: ['ShippingProviderManager'],
  displayName: 'InPost ShipX v1',
  version: '1.0.0',
  isDefault: true,
};

/** Short brand label for domain-exception prefixes (manifest.displayName is too long). */
const INPOST_BRAND = 'InPost';

export function createInpostPlugin(): AdapterPlugin {
  return {
    manifest: inpostAdapterManifest,

    register(host: HostServices): void {
      host.connectionConfigShapeValidatorRegistry.register(
        inpostAdapterManifest.adapterKey,
        new InpostConnectionConfigShapeValidatorAdapter(INPOST_BRAND),
      );
      // No credentials-shape validator: the `{ apiToken }` shape is enforced
      // at adapter construction time by the factory (deeper than this boundary).

      // #771 — connection-test probe. Makes `POST /connections/:id/test`
      // meaningful for InPost (it 400s without a registered tester): a cheap
      // authenticated `GET /v1/points` probe validates the stored token.
      host.connectionTesterRegistry.register(
        inpostAdapterManifest.adapterKey,
        new InpostConnectionTesterAdapter(),
      );

      // Auth-failure classifier (#819 / #1103): a non-retryable 401/403 from the
      // ShipX client flips the connection to `needs_reauth` on the SyncJobRunner
      // path (e.g. the shipment-status poll below).
      host.authFailureClassifierRegistry.register(
        inpostAdapterManifest.adapterKey,
        new InpostAuthFailureClassifierAdapter(),
      );

      // #768 / ADR-021 — third-party-native webhook ingress. The decoder
      // (provider-keyed) authenticates + decodes InPost's `Shipment.Tracking`
      // webhook at the host ingress; the translator (adapterKey-keyed) maps the
      // decoded event onto the `shipment` inbound domain downstream.
      host.inboundWebhookDecoderRegistry.register(
        inpostAdapterManifest.platformType,
        new InpostInboundWebhookDecoderAdapter(),
      );
      host.webhookEventTranslatorRegistry.register(
        inpostAdapterManifest.adapterKey,
        new InpostWebhookEventTranslatorAdapter(),
      );

      // #772 — schedule the carrier-generic shipment-status poll (#838) for
      // InPost connections (webhook fallback). Drained only by the api's
      // SchedulerService; the worker registers it too (no SchedulerService
      // there) but never fires it.
      for (const task of buildInpostSchedulerTasks()) {
        host.schedulerTaskRegistry.register(task);
      }
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const adapter = await createInpostShippingAdapter(connection, host.credentialsResolver);
      return dispatchCapability<T>(
        capability,
        { ShippingProviderManager: () => adapter },
        INPOST_BRAND,
      );
    },
  };
}
