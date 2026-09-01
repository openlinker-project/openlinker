/**
 * `@openlinker/oms` — plugin descriptor
 *
 * OpenLinker's own OMS, expressed as an ordinary `AdapterPlugin` (#2405,
 * ADR-055). **The descriptor IS the OMS's adapter to OpenLinker**: core
 * resolves it through the same `getCapabilityAdapter` path as any vendor and
 * receives the same port implementations. The only asymmetry sits below the
 * port line, where the OL-OMS answers from OpenLinker's own tables instead of
 * a vendor API — which is why the connection is credential-less and no wire
 * machinery exists here at all.
 *
 * @module libs/oms/src
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 * @see docs/architecture/adrs/062-trust-posture-authority-holding-capabilities.md
 */
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { IInventoryQueryService } from '@openlinker/core/inventory';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type { IProductsService } from '@openlinker/core/products';
import type { IShipmentQueryService } from '@openlinker/core/shipping';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { AdapterPlugin, HostServices } from '@openlinker/plugin-sdk';
import { dispatchCapability } from '@openlinker/plugin-sdk';

import { OlFulfillmentExecutorAdapter } from './execution/ol-fulfillment-executor.adapter';
import { OMS_ADAPTER_KEY, OMS_BRAND, OMS_PLATFORM_TYPE } from './oms.constants';

/**
 * The OL-OMS adapter manifest.
 *
 * **`supportedCapabilities` carries `FulfillmentExecutor` since #2409**, and
 * #2409 is what made that safe: a capability name enters this array together
 * with the adapter that delivers it — the Erli precedent (#980 shipped `[]`;
 * #984/#993 added `OfferManager`/`OrderSource` alongside their adapters).
 * Advertising it earlier would not merely have been inert:
 * `listCapabilityAdapters` skips a connection whose factory raises
 * `AdapterNotFoundException`, but `dispatchCapability` throws a plain `Error`
 * for a name absent from its table, aborting the whole listing rather than
 * skipping that one connection.
 *
 * **What advertising it makes reachable.** `FulfillmentExecutor` has been in
 * `CoreCapabilityValues` since #2403 while no manifest advertised it, so A3
 * (`fulfillment-execution`) was assignable only through a hand-rolled
 * `PATCH /connections/:id` — both capability-checkbox surfaces intersect the
 * adapter's advertised list with the core set. It is now assignable in the UI
 * for an `openlinker` connection; `getCapabilityAdapter(id, 'FulfillmentExecutor')`
 * resolves, so `fulfillment.work.dispatch` can dispatch to the OL-OMS instead of
 * raising its retryable "could not resolve" error; and
 * `InboundRoutingPolicyService`'s `'fulfillment'` arm can resolve GATED rather
 * than `ungated`. None of it activates on its own: an OL-OMS `Connection` row
 * exists only once an operator enables the OMS (ADR-055's never-seeded rule,
 * pinned by `oms-connection-never-seeded.int-spec.ts`), and the capability must
 * then be enabled on it.
 *
 * **`isDefault: true` is required, not decorative.** The connection create
 * form omits `adapterKey`, so `resolveAdapterMetadata` falls back to
 * `getDefaultAdapterKey(platformType)`; without the default flag an
 * operator-created OMS row could not resolve an adapter at all. The registry
 * permits at most one default per `platformType` and throws on a second, and
 * `openlinker` has exactly one adapter.
 *
 * **No `defaultRateLimit`**: that value paces outbound HTTP, and this plugin
 * issues none — `libs/oms` is in `check-outbound-http.mjs`'s scan roots and in
 * the bare-`fetch` ESLint ban (both source-text guards), and
 * `__tests__/no-http-in-dependency-graph.spec.ts` (#2409) additionally pins the
 * dependency graph, which is the half a source grep cannot see.
 */
export const omsAdapterManifest: AdapterMetadata = {
  adapterKey: OMS_ADAPTER_KEY,
  platformType: OMS_PLATFORM_TYPE,
  supportedCapabilities: ['FulfillmentExecutor'],
  displayName: OMS_BRAND,
  version: '1.0.0',
  isDefault: true,
  requiresCredentials: false,
};

/**
 * Core services the OL-OMS reads through, supplied by the host at composition
 * time rather than through the SDK's `HostServices` bag.
 *
 * **`HostServices` is deliberately NOT widened** (ADR-055, ADR-062 decision 4).
 * Its own contract asks whether "every plausible future plugin needs this";
 * five OMS-specific reads plainly fail that test, and its docblock already
 * names `IMappingConfigService` as a port kept out and passed through a
 * descriptor closure instead. `createErliPlugin(deps?: ErliPluginDeps)` is the
 * shipped precedent for exactly this shape.
 *
 * **Declared here, injected by #2408/#2409.** The dispatch table is empty in
 * this slice, so nothing reads these yet — but the contract is what this issue
 * exists to establish, and `scripts/check-no-injection-contracts.mjs` already
 * cites `createOmsPlugin({inventoryQuery, orderRecords, products, shipping,
 * mappingConfig})` by name as its reason for exempting `libs/oms` from the
 * ADR-053 no-injection prohibition. Declaring it makes that carve-out true
 * rather than aspirational.
 *
 * Injecting them today would carry a real cost with no consumer: `ShippingModule`
 * and `MappingsModule` are absent from the worker's shared spine and enter only
 * under the `jobs` role, so an injecting module would have to import them
 * itself — dragging those providers into the `events`, `scheduler` and
 * `maintenance` roles too, and breaching ADR-051's guarantee that a role which
 * is off contributes no providers. #2408/#2409 make the Erli #1198 conversion
 * (from `createNestAdapterModule` to a hand-written `@Module`) when they have a
 * consumer and can weigh that cost against a real need.
 */
export interface OmsPluginDeps {
  inventoryQuery: IInventoryQueryService;
  orderRecords: IOrderRecordService;
  products: IProductsService;
  shipping: IShipmentQueryService;
  mappingConfig: IMappingConfigService;
}

/**
 * Build the OL-OMS plugin descriptor.
 *
 * `deps` is **still** optional, and still unread, after #2409 gave the dispatch
 * table its first entry: `OlFulfillmentExecutorAdapter` is stateless and injects
 * nothing (see its own docblock for why that is the stronger guarantee). So the
 * host keeps composing this through `createNestAdapterModule` rather than making
 * the #1198 Erli conversion to a hand-written `@Module` — which #2405 expected
 * #2409 to force, and which would have dragged `ShippingModule` /
 * `MappingsModule` providers into the `events`, `scheduler` and `maintenance`
 * worker roles, breaching ADR-051's guarantee that a role which is off
 * contributes no providers. #2408 is where that cost gets weighed against a real
 * need.
 *
 * There is deliberately **no `register(host)`**: this plugin has no connection
 * tester, no scheduler task, no webhook translator and no shape validator to
 * register. `createNestAdapterModule` calls `plugin.register?.(host)`
 * optional-chained, so its absence is fully supported, and a connection test
 * correctly answers "not supported for adapter openlinker.oms.v1" rather than
 * pretending to probe a network boundary that does not exist.
 */
export function createOmsPlugin(_deps?: OmsPluginDeps): AdapterPlugin {
  return {
    manifest: omsAdapterManifest,
    // `async` is contractual — `AdapterPlugin.createCapabilityAdapter` returns a
    // Promise — not incidental. It is still not GENUINELY async at #2409, which
    // #2405 expected it to become: the executor is constructed synchronously
    // because it resolves no credentials and reads no store.
    // eslint-disable-next-line @typescript-eslint/require-await -- see above
    async createCapabilityAdapter<T>(
      _connection: Connection,
      capability: string,
      _host: HostServices
    ): Promise<T> {
      return dispatchCapability<T>(
        capability,
        {
          // A fresh instance per resolution, matching every other plugin's factory.
          // It is stateless, so sharing one would be safe — but "safe because the
          // class happens to hold nothing" is a property a future field silently
          // revokes, whereas per-call construction stays correct either way.
          FulfillmentExecutor: () => new OlFulfillmentExecutorAdapter(),
        },
        OMS_BRAND
      );
    },
  };
}
