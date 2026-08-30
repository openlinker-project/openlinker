/**
 * Fulfillment Status Source Capability (#2398, DESIGN §5.4)
 *
 * Optional sub-capability of `FulfillmentExecutorPort` — the pull-shaped read that serves a
 * **polling** holder. A holder that pushes progress instead reaches core through the inbound
 * seam (`IFulfillmentProgressService.record`, #2400); this exists for the vendor that offers
 * no webhook, and for nothing else.
 *
 * ## Advertised-without-dispatch
 *
 * Resolved ONLY by narrowing the dispatched `FulfillmentExecutor` adapter with the guard
 * below — never `getCapabilityAdapter(connectionId, 'FulfillmentStatusSource')`, which passes
 * the manifest gate and then throws inside `dispatchCapability` (and in the list path aborts
 * the whole listing rather than skipping the connection). The name is absent from
 * `CoreCapabilityValues` and from every manifest, and must stay so.
 *
 * ## The guard narrows by RUNTIME METHOD PROBE, not by manifest membership
 *
 * ADR-055's R1 forward-compat rule, and the ADR-046 resolver precedent: an out-of-tree
 * adapter compiled against an older `libs/core` must **degrade** — read as "does not offer a
 * status pull", so the caller falls back to whatever it does when a holder cannot be polled —
 * rather than throw. A manifest test would also stop recognising an adapter that implements
 * the method and declares nothing, which is the failure mode the probe exists to avoid.
 *
 * ## The method is `getWorkFulfillmentStatus`, DIVERGING from DESIGN §5.4's `getFulfillmentStatus`
 *
 * The design text spells this `getFulfillmentStatus(workRef)`. That name is **unsafe against a
 * structural probe already in the tree**, so the signature diverges and the design has been
 * updated to match rather than the other way round.
 *
 * `orders` ships `FulfillmentStatusReader.getFulfillmentStatus({ externalOrderId })` — a
 * sub-capability of `OrderProcessorManagerPort` — whose guard is nothing but
 * `typeof adapter.getFulfillmentStatus === 'function'`. The hazard is **one-directional and
 * needs no class implementing both ports deliberately**: any adapter implementing THIS
 * capability under the old name would satisfy THAT guard, be narrowed to
 * `FulfillmentStatusReader`, and be called by `FulfillmentStatusSyncService`
 * (`libs/core/src/shipping/application/services/fulfillment-status-sync.service.ts`) with
 * `{ externalOrderId }` while expecting a `FulfillmentWorkRef`. Adapters routinely implement
 * several ports on one class, so this is reachable rather than contrived.
 *
 * This is the exact failure ADR-046 records — `isOfferFieldUpdater` tests only
 * `updateOfferFields`, so a plugin compiled against an older `libs/core` satisfies it and
 * throws at publish time — and #2229 repeats it for `isEanCategoryMatcherStreaming`. Both were
 * fixed by probing more narrowly. **Neither could have been fixed by a comment**, which is why
 * the earlier decision to keep the name and document the collision was wrong: a distinct name
 * makes the mis-narrowing impossible, where a docblock only asks the next author to notice it.
 *
 * Renaming is free precisely NOW: nothing implements or calls this port, and #2399 / #2400 /
 * #2402 are not yet written. It stops being free the moment an adapter exists to be
 * mis-narrowed.
 *
 * @module libs/core/src/fulfillment/domain/ports/capabilities
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.4
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
import type { FulfillmentProgressSnapshot } from '../../types/fulfillment-execution.types';
import type { FulfillmentWorkRef } from '../../types/fulfillment-work.types';
import type { FulfillmentExecutorPort } from '../fulfillment-executor.port';

export interface FulfillmentStatusSource {
  getWorkFulfillmentStatus(workRef: FulfillmentWorkRef): Promise<FulfillmentProgressSnapshot>;
}

export function isFulfillmentStatusSource(
  adapter: FulfillmentExecutorPort,
): adapter is FulfillmentExecutorPort & FulfillmentStatusSource {
  return typeof (adapter as Partial<FulfillmentStatusSource>).getWorkFulfillmentStatus === 'function';
}
