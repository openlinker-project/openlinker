/**
 * Fulfillment Sale-Decrement Reconcile Service Interface (#3629)
 *
 * The read half of the sale-decrement reconcile pass, exposed as an `I*Service`
 * so the WORKER can reach it (`FulfillmentWorkRepositoryPort` is an intra-context
 * contract that cross-context imports reject). It REPORTS candidates and enqueues
 * nothing: `fulfillment` is a registered zero-sibling-edge leaf and may not import
 * `@openlinker/core/sync`, so the worker performs the enqueue - ADR-053's
 * report-don't-perform discipline.
 *
 * @module libs/core/src/fulfillment/application/interfaces
 */
import type {
  ListWorksMissingSaleDecrementJobInput,
  ListWorksMissingSaleDecrementJobResult,
} from '../types/fulfillment-sale-decrement-reconcile-sweep.types';

export interface IFulfillmentSaleDecrementReconcileService {
  /**
   * One page of the frontier: routed works, past the grace window, on a live
   * order, whose decrement job was never enqueued - oldest first.
   *
   * Oldest-first has a cost the caller must handle: a candidate whose enqueue
   * keeps failing stays at the head and starves the rest. There is no scan offset
   * (frontier-as-query), so the caller SURFACES it rather than working around it.
   */
  listWorksMissingSaleDecrementJob(
    input: ListWorksMissingSaleDecrementJobInput
  ): Promise<ListWorksMissingSaleDecrementJobResult>;
}
