/**
 * eparagony.pl Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the eparagony.pl Documents REST API v3
 * integration. Capability: `'Fiscalization'` (ADR-042) - `EparagonyFiscalizationAdapter`
 * implements `FiscalizationPort` plus the `FiscalRegistrationLocator`
 * sub-capability.
 *
 * `supportedCapabilities` lists only `Fiscalization`. The locator is narrowed at
 * the call site with `isFiscalRegistrationLocator`, never resolved by name from
 * the registry - asking `getCapabilityAdapter` for a sub-capability passes the
 * manifest gate and then throws inside `dispatchCapability`.
 *
 * NOT declared, and each for a stated reason:
 *   - `FiscalDeviceOperator` (#1910, closed `not_planned`) - the fiscal printer
 *     sits BELOW this vendor's boundary, driven by the vendor's own print
 *     service. The vendor exposes `print` and `fiscalize` as booleans inside the
 *     document payload, not as device operations, so there is no device surface
 *     to implement here.
 *   - Any invoicing capability - this vendor also relays invoices to KSeF, but
 *     that regime is `InvoicingPort`'s (ADR-042 decision 1) and is out of scope
 *     for #1908.
 *
 * Side-registrations land in `register(host)`: the config + credentials shape
 * validators, the retry classifier and the auth-failure classifier, so a
 * malformed connection is rejected before persistence and no fiscal registration
 * whose outcome is unknown is ever blindly re-driven by the worker runner.
 *
 * @module libs/integrations/eparagony/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';

import { EPARAGONY_ADAPTER_KEY, EPARAGONY_BRAND, EPARAGONY_PROVIDER_TYPE } from './eparagony.constants';
import { EparagonyAdapterFactory } from './application/eparagony-adapter.factory';
import { EparagonyAuthFailureClassifierAdapter } from './infrastructure/adapters/eparagony-auth-failure-classifier.adapter';
import { EparagonyConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/eparagony-connection-config-shape-validator.adapter';
import { EparagonyConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/eparagony-connection-credentials-shape-validator.adapter';
import { EparagonyConnectionTesterAdapter } from './infrastructure/adapters/eparagony-connection-tester.adapter';
import { EparagonyRetryClassifierAdapter } from './infrastructure/adapters/eparagony-retry-classifier.adapter';

/**
 * Static plugin manifest (#575). Exported for host tooling (capability matrix,
 * manifest diff); `createEparagonyPlugin().manifest` returns this same reference,
 * so the static and runtime views cannot drift.
 */
export const eparagonyAdapterManifest: AdapterMetadata = {
  adapterKey: EPARAGONY_ADAPTER_KEY,
  platformType: EPARAGONY_PROVIDER_TYPE,
  supportedCapabilities: ['Fiscalization'],
  displayName: 'eparagony.pl Documents API v3',
  version: '1.0.0',
  isDefault: true,
  // No `defaultRateLimit`. A manifest default exists for merchant-hosted
  // platforms whose remote is the operator's own box; this is multi-tenant SaaS
  // publishing no request ceiling for the documents API. It matters more than
  // usual here that we do NOT invent one: `registerTransaction` blocks on a
  // status poll, and a cap that starves those reads turns a sale the device DID
  // register into an in-doubt record parked for manual review. Absent means
  // unlimited until the operator sets `config.rateLimit`.
};

export function createEparagonyPlugin(): AdapterPlugin {
  return {
    manifest: eparagonyAdapterManifest,

    register(host: HostServices): void {
      host.connectionConfigShapeValidatorRegistry.register(
        EPARAGONY_ADAPTER_KEY,
        new EparagonyConnectionConfigShapeValidatorAdapter(EPARAGONY_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        EPARAGONY_ADAPTER_KEY,
        new EparagonyConnectionCredentialsShapeValidatorAdapter(EPARAGONY_BRAND),
      );
      host.retryClassifierRegistry.register(
        EPARAGONY_ADAPTER_KEY,
        new EparagonyRetryClassifierAdapter(),
      );
      host.authFailureClassifierRegistry.register(
        EPARAGONY_ADAPTER_KEY,
        new EparagonyAuthFailureClassifierAdapter(),
      );
      host.connectionTesterRegistry.register(
        EPARAGONY_ADAPTER_KEY,
        new EparagonyConnectionTesterAdapter(host.http),
      );

      // No webhook decoder / translator is registered. The vendor DOES push
      // fiscalization status to a `statusUrl`, but the host's inbound routing
      // keys on a closed `CanonicalInboundEvent.domain` union that has no
      // fiscalization member and no fiscalization job to route to - so a
      // registered decoder would authenticate every delivery and then
      // dead-letter it. The synchronous status read covers the same ground; see
      // the known-gaps section of this package's README.
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const logger = host.logger(`Eparagony:${connection.id}`);
      const factory = new EparagonyAdapterFactory();
      const fiscalizationAdapter = await factory.createFiscalizationAdapter(
        connection,
        host.credentialsResolver,
        logger,
        // Connection-bound outbound transport (#1810). No manifest default is
        // passed - this plugin declares none (see the manifest note above).
        host.http.forConnection(connection),
      );
      return dispatchCapability<T>(
        capability,
        { Fiscalization: () => fiscalizationAdapter },
        EPARAGONY_BRAND,
      );
    },
  };
}
