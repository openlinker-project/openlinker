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

import { OMS_ADAPTER_KEY, OMS_BRAND, OMS_PLATFORM_TYPE } from './oms.constants';

/**
 * The OL-OMS adapter manifest.
 *
 * **`supportedCapabilities` is deliberately empty.** A capability name enters
 * this array together with the adapter that delivers it — the Erli precedent
 * (#980 shipped `[]`; #984/#993 added `OfferManager`/`OrderSource` alongside
 * their adapters). Advertising `FulfillmentExecutor` here before #2409 builds
 * it would not merely be inert: `listCapabilityAdapters` skips a connection
 * whose factory raises `AdapterNotFoundException`, but `dispatchCapability`
 * throws a plain `Error` for a name absent from its table, which aborts the
 * whole listing rather than skipping this one connection.
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
 * the bare-`fetch` ESLint ban.
 */
export const omsAdapterManifest: AdapterMetadata = {
  adapterKey: OMS_ADAPTER_KEY,
  platformType: OMS_PLATFORM_TYPE,
  supportedCapabilities: [],
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
 * `deps` is optional so the host can compose the descriptor through
 * `createNestAdapterModule` while the dispatch table is empty — matching
 * `createErliPlugin(deps?)`, which was likewise optional before #1198 gave it
 * a consumer.
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
    // `async` is contractual — `AdapterPlugin.createCapabilityAdapter` returns
    // a Promise — not incidental. It becomes genuinely async in #2408/#2409.
    // eslint-disable-next-line @typescript-eslint/require-await -- see above
    async createCapabilityAdapter<T>(
      _connection: Connection,
      capability: string,
      _host: HostServices
    ): Promise<T> {
      return dispatchCapability<T>(capability, {}, OMS_BRAND);
    },
  };
}
