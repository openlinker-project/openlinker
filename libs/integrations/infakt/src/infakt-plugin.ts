/**
 * Infakt Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the Infakt SaaS accounting integration.
 * Capability: `'Invoicing'` — implements `InvoicingPort`, `RegulatoryStatusReader`,
 * and `CorrectionIssuer`. `supportedCapabilities` lists only `Invoicing` — the
 * two sub-capabilities are narrowed via type guards at call sites, not
 * declared separately in the manifest (mirrors KSeF).
 *
 * KSeF model: Infakt submits to KSeF natively. OL does not build FA(3) XML.
 * This is why the adapter implements `RegulatoryStatusReader` (read clearance
 * status) rather than `RegulatoryTransmitter` (active KSeF session).
 *
 * Side-registrations land in `register(host)` (`createNestAdapterModule`
 * invokes it): the connection config + credentials shape validators and the
 * retry classifier, so malformed connections are rejected before persistence
 * and terminal/in-doubt Infakt failures aren't blindly retried by the worker
 * runner (see `InfaktRetryClassifierAdapter` for the fiscal-safety reasoning).
 *
 * @module libs/integrations/infakt/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { InfaktAdapterFactory } from './application/infakt-adapter.factory';
import { InfaktConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/infakt-connection-config-shape-validator.adapter';
import { InfaktConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/infakt-connection-credentials-shape-validator.adapter';
import { InfaktRetryClassifierAdapter } from './infrastructure/adapters/infakt-retry-classifier.adapter';
import { InfaktInboundWebhookDecoderAdapter } from './infrastructure/adapters/infakt-inbound-webhook-decoder.adapter';
import { InfaktWebhookEventTranslatorAdapter } from './infrastructure/adapters/infakt-webhook-event-translator.adapter';

/**
 * Static plugin manifest. Exported for host tooling (capability-matrix, manifest
 * diff); `createInfaktPlugin().manifest` returns this same reference.
 */
export const infaktAdapterManifest: AdapterMetadata = {
  adapterKey: 'infakt.accounting.v1',
  platformType: 'infakt',
  supportedCapabilities: ['Invoicing'],
  displayName: 'Infakt Accounting API v3',
  version: '1.0.0',
  isDefault: true,
};

const INFAKT_BRAND = 'Infakt';
const INFAKT_ADAPTER_KEY = infaktAdapterManifest.adapterKey;

export function createInfaktPlugin(): AdapterPlugin {
  return {
    manifest: infaktAdapterManifest,

    register(host: HostServices): void {
      host.connectionConfigShapeValidatorRegistry.register(
        INFAKT_ADAPTER_KEY,
        new InfaktConnectionConfigShapeValidatorAdapter(INFAKT_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        INFAKT_ADAPTER_KEY,
        new InfaktConnectionCredentialsShapeValidatorAdapter(INFAKT_BRAND),
      );
      host.retryClassifierRegistry.register(INFAKT_ADAPTER_KEY, new InfaktRetryClassifierAdapter());

      // #1281 / ADR-021 — third-party-native webhook ingress. The decoder
      // (provider-keyed) authenticates + decodes Infakt's KSeF-relay webhook
      // (incl. the subscription-verification handshake) at the host ingress;
      // the translator (adapterKey-keyed) maps the decoded event onto the
      // `invoicing` inbound domain downstream.
      host.inboundWebhookDecoderRegistry.register(
        infaktAdapterManifest.platformType,
        new InfaktInboundWebhookDecoderAdapter(),
      );
      host.webhookEventTranslatorRegistry.register(
        INFAKT_ADAPTER_KEY,
        new InfaktWebhookEventTranslatorAdapter(),
      );
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const logger = new Logger(`Infakt:${connection.id}`);
      const factory = new InfaktAdapterFactory();
      const invoicingAdapter = await factory.createInvoicingAdapter(
        connection,
        host.credentialsResolver,
        logger,
      );
      return dispatchCapability<T>(capability, { Invoicing: () => invoicingAdapter }, INFAKT_BRAND);
    },
  };
}
