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
 * ## Known blind spot: the method name is shared with a DIFFERENT port
 *
 * `orders`' `FulfillmentStatusReader.getFulfillmentStatus({ externalOrderId })` — a
 * sub-capability of `OrderProcessorManagerPort` — uses this exact method name, keyed by
 * external ORDER id and answering a status-shaped `FulfillmentStatusSnapshot`. There is no
 * TypeScript conflict (different interfaces, different contexts), but a runtime probe tests
 * only that the property is a function: a single class implementing both ports and dispatched
 * as the `FulfillmentExecutor` would pass this guard and then be called with a
 * `FulfillmentWorkRef` where it expects `{ externalOrderId }`.
 *
 * The name is kept because it is the signature in both #2398 and DESIGN §5.4, and the hazard
 * requires one class to implement two ports from two contexts — already a design smell. It is
 * named HERE rather than left to be met at runtime, because a guard whose failure mode is
 * invisible is what ADR-055's probe rule exists to bound. If a real adapter ever does need
 * both ports, `getWorkFulfillmentStatus` is the structurally safe rename.
 *
 * @module libs/core/src/fulfillment/domain/ports/capabilities
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.4
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
import type { FulfillmentProgressSnapshot } from '../../types/fulfillment-execution.types';
import type { FulfillmentWorkRef } from '../../types/fulfillment-work.types';
import type { FulfillmentExecutorPort } from '../fulfillment-executor.port';

export interface FulfillmentStatusSource {
  getFulfillmentStatus(workRef: FulfillmentWorkRef): Promise<FulfillmentProgressSnapshot>;
}

export function isFulfillmentStatusSource(
  adapter: FulfillmentExecutorPort,
): adapter is FulfillmentExecutorPort & FulfillmentStatusSource {
  return typeof (adapter as Partial<FulfillmentStatusSource>).getFulfillmentStatus === 'function';
}
