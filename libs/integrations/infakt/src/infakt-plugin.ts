/**
 * Infakt Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the Infakt SaaS accounting integration.
 * Capability: `'Invoicing'` — implements `InvoicingPort`, `RegulatoryStatusReader`,
 * and `CorrectionIssuer`.
 *
 * KSeF model: Infakt submits to KSeF natively. OL does not build FA(3) XML.
 * This is why the adapter implements `RegulatoryStatusReader` (read clearance
 * status) rather than `RegulatoryTransmitter` (active KSeF session).
 *
 * @module libs/integrations/infakt/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { InfaktAdapterFactory } from './application/infakt-adapter.factory';

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

export function createInfaktPlugin(): AdapterPlugin {
  return {
    manifest: infaktAdapterManifest,

    // No side-registrations for the POC — add connection config validator,
    // connection tester, and retry classifier in the production implementation.
    register(_host: HostServices): void {},

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      try {
        const logger = new Logger(`Infakt:${connection.id}`);
        const factory = new InfaktAdapterFactory();
        const invoicingAdapter = await factory.createInvoicingAdapter(
          connection,
          host.credentialsResolver,
          logger,
        );
        return dispatchCapability<T>(
          capability,
          { Invoicing: () => invoicingAdapter },
          INFAKT_BRAND,
        );
      } catch (err) {
        return Promise.reject(err as Error);
      }
    },
  };
}
