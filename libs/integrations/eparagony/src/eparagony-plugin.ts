/**
 * eparagony.pl Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the eparagony.pl Documents REST API v3
 * integration. TWO capabilities on ONE connection (#3192): `'Fiscalization'`
 * (ADR-042) via `EparagonyFiscalizationAdapter`, and `'Invoicing'` (ADR-026) via
 * `EparagonyInvoicingAdapter`. The vendor issues both a receipt and an invoice
 * through the same `POST /documents` endpoint, under the same OAuth scopes, so
 * an operator configures the provider once and enables the lanes they want.
 *
 * `supportedCapabilities` lists those two plus their sub-capabilities,
 * `FiscalRegistrationLocator` and `RegulatoryStatusReader`, both
 * advertised-without-dispatch (ADR-042 decision 5 / the KSeF
 * `OfflineResubmitter` precedent, and the same pattern as `CategoryBrowser` /
 * `OfferCreator` / `ShopCategoryBrowser`): a sub-capability is ALWAYS narrowed
 * at the call site with its `is*` guard, never resolved by name from the
 * registry - asking `getCapabilityAdapter` for one would pass this manifest gate
 * and then throw inside `dispatchCapability`, since the dispatch table below
 * carries only the two base capabilities. Those manifest entries exist purely so
 * host/FE discovery (the connection response) can tell that this connection is
 * reconcilable before an operator ever sees an in-doubt row, and that its
 * invoices report a clearance status. Neither is a `CoreCapability`, so neither
 * renders as an operator-tickable toggle.
 *
 * Adding `Invoicing` here does NOT grant it to any EXISTING connection.
 * `enabledCapabilities` is stamped at create and never retro-filled (#2085), so
 * every connection that exists today stays receipts-only until an operator ticks
 * the new capability on the connection page. That is the intended path, not an
 * oversight: the invoice lane needs seller configuration (`merchantTIN` at
 * minimum) that no existing connection carries.
 *
 * It DOES change what a NEW connection is born with, and that needed a decision
 * rather than a default. `ConnectionService.create` falls back to this manifest's
 * whole supported set when a caller omits `enabledCapabilities`, so from this
 * change on the guided wizard - which collects an environment, a POS id and
 * credentials, and no seller invoicing configuration at all - would mint a
 * connection claiming it can invoice. Two consequences are visible rather than
 * cosmetic: `selectInvoicingCandidates` filters on that array, so a second
 * candidate beside an existing inFakt/KSeF connection turns that install's
 * one-click issue into a must-ask pick; and `deriveSalesDocumentRows` tests
 * `'Invoicing'` before `'Fiscalization'`, so a receipts connection would render
 * as an Invoicing row in Settings -> Sales documents. The wizard therefore sends
 * `enabledCapabilities: ['Fiscalization']` explicitly
 * (`eparagony-setup.schema.ts`), which keeps the invoice lane opt-in on every
 * path into the product, and matches the rule applied to `CorrectionIssuer`
 * below: a capability is claimed together with the ability to deliver it.
 *
 * Note what an explicit set cannot carry. `CreateConnectionDto` validates it
 * with `@IsIn(CoreCapabilityValues, { each: true })`, and `FiscalRegistrationLocator`
 * / `RegulatoryStatusReader` are deliberately not core capabilities - passing
 * either would 400. Nothing reads those two names off `enabledCapabilities`
 * anywhere (both are narrowed from the dispatched adapter with their `is*`
 * guard), and `ConnectionCapabilitiesPanel` saves the `isCoreCapability`-filtered
 * set, so a connection created the omitted way used to persist both and then
 * silently lose them on the operator's first capability toggle. Sending
 * `['Fiscalization']` is where such a connection lands either way; the
 * manifest, not `enabledCapabilities`, is what makes the two sub-capabilities
 * discoverable.
 *
 * NOT declared, and each for a stated reason:
 *   - `FiscalDeviceOperator` (#1910, closed `not_planned`) - the fiscal printer
 *     sits BELOW this vendor's boundary, driven by the vendor's own print
 *     service. The vendor exposes `print` and `fiscalize` as booleans inside the
 *     document payload, not as device operations, so there is no device surface
 *     to implement here.
 *   - `CorrectionIssuer` - the vendor models a correction as its own
 *     `eCorrectiveInvoice` document kind with its own before/after metadata
 *     pair, which `EparagonyInvoicingAdapter` does not compose (#3193). It
 *     refuses a correction command pre-call instead, so advertising the name
 *     would promise a document this plugin cannot produce.
 *   - `RegulatoryTransmitter` - this vendor RELAYS to the national e-invoicing
 *     hub on the seller's behalf rather than OpenLinker holding the authority
 *     session, which is why the adapter reads clearance (`RegulatoryStatusReader`)
 *     and never submits. Same split `InfaktInvoicingAdapter` sits on.
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
  supportedCapabilities: [
    'Fiscalization',
    'FiscalRegistrationLocator',
    'Invoicing',
    'RegulatoryStatusReader',
  ],
  displayName: 'eparagony.pl Documents API v3',
  version: '1.0.0',
  isDefault: true,
  // #3350: this manifest declares BOTH `Invoicing` and `Fiscalization`, so a
  // caller omitting `enabledCapabilities` at connection-create time needs a
  // default that does NOT include `Invoicing` — the guided wizard collects
  // only the receipts-lane config, and defaulting the invoice lane on would
  // silently grant it to a connection whose seller fields
  // (`merchantTIN`/`merchantName`/`merchantAddress`) the wizard never
  // collects. Everything else the manifest supports (including the two
  // advertised-without-dispatch sub-capabilities) stays in the default,
  // preserving this connection's exact prior default-capability set.
  defaultEnabledCapabilities: ['Fiscalization', 'FiscalRegistrationLocator', 'RegulatoryStatusReader'],
  // No `defaultRateLimit`. A manifest default exists for merchant-hosted
  // platforms whose remote is the operator's own box; this is multi-tenant SaaS
  // publishing no request ceiling for the documents API. It matters more than
  // usual here that we do NOT invent one: both `registerTransaction` and
  // `issueInvoice` block on a status poll, and a cap that starves those reads
  // turns a document the vendor DID create into an in-doubt record parked for
  // manual review. Absent means unlimited until the operator sets
  // `config.rateLimit`.
};

export function createEparagonyPlugin(): AdapterPlugin {
  // One factory for the lifetime of the plugin rather than one per capability
  // resolution (the #2592 hoist, mirroring `createPrestashopPlugin`). Safe
  // because the factory holds no per-connection state: it takes no constructor
  // arguments and the connection is a parameter of `createAdapters`.
  //
  // Be precise about what this does and does not buy here. It does NOT make the
  // OAuth token cache outlive a capability resolution - that cache lives on the
  // `EparagonyHttpClient`, which `createAdapters` still builds per call, so two
  // resolutions for one connection still fetch two tokens. What it buys is the
  // seam: the factory is now the only place a per-connection client could be
  // cached, and caching one is a separate decision that owes an invalidation
  // story (rotated credentials, a changed host override) of the kind
  // `PrestashopAdapterFactory.dropCachesOnShopIdentityChange` carries. The
  // doubling this slice had to avoid is the one WITHIN a resolution: both
  // adapters ride the single client `createAdapters` builds.
  const factory = new EparagonyAdapterFactory();

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
      const adapters = await factory.createAdapters(
        connection,
        host.credentialsResolver,
        logger,
        // Connection-bound outbound transport (#1810). No manifest default is
        // passed - this plugin declares none (see the manifest note above).
        host.http.forConnection(connection),
      );
      return dispatchCapability<T>(
        capability,
        {
          Fiscalization: () => adapters.fiscalization,
          Invoicing: () => adapters.invoicing,
        },
        EPARAGONY_BRAND,
      );
    },
  };
}
