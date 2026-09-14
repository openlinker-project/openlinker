/**
 * Fulfillment Relay Reconcile Service Interface (#2728, ADR-054)
 *
 * The read half of the dispatch-relay reconcile pass, exposed as an `I*Service` so
 * the WORKER can reach it — `FulfillmentWorkRepositoryPort` is an intra-context
 * persistence contract that `scripts/check-cross-context-imports.mjs` rejects by
 * deny pattern, and is deliberately absent from the barrel.
 *
 * ## Why this reports candidates instead of relaying them
 *
 * The re-drive is `IFulfillmentDispatchRelayService.relayDispatch`, which lives in
 * `orders` because the relay itself does. Performing it here would mean importing
 * `@openlinker/core/orders` from inside `libs/core/src/fulfillment/**`, which two
 * guards independently forbid. That is ADR-053's design rather than an obstacle to
 * route around, and the evidence this split is the right one is that #2728 adds
 * **zero** entries to either guard's allow-set.
 *
 * It is also why the loop lives in the handler and not here, unlike
 * `IFulfillmentDispatchTimeoutService` (#2712) — that pass can perform its own
 * write, this one structurally cannot.
 *
 * ## What this is NOT
 *
 * It is not a second relay path and it holds no claim. Every candidate is re-driven
 * through the unchanged `claimDispatchRelay`, which stays the serialisation point
 * between this sweep and any concurrent progress-driven trigger — exactly as
 * `Shipment.waybillRelayedAt` is between the status poll and the carrier webhook
 * (#1947). A sweep that claimed for itself would be a second writer of that column
 * and would defeat the guarantee it exists to provide.
 *
 * @module libs/core/src/fulfillment/application/interfaces
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */
import type {
  ListUnrelayedDispatchesInput,
  ListUnrelayedDispatchesResult,
} from '../types/fulfillment-relay-reconcile-sweep.types';

export interface IFulfillmentRelayReconcileService {
  /**
   * One page of the frontier: works a holder reported SHIPPED, past the grace
   * window, whose dispatch relay never landed — oldest first.
   *
   * Ordering is oldest-first because the operator-facing harm is how long a source
   * has been uninformed. That has a cost the caller must handle: a candidate whose
   * relay fails permanently keeps its `shippedAt`, stays at the head, and is
   * re-read every tick — so enough of them fill the page and starve the rest. A
   * scan offset is unavailable here (frontier-as-query, see the port), so the
   * condition is SURFACED by the caller rather than worked around, the same answer
   * #2346 and #2712 give to the identical shape.
   */
  listUnrelayedDispatches(
    input: ListUnrelayedDispatchesInput
  ): Promise<ListUnrelayedDispatchesResult>;
}
