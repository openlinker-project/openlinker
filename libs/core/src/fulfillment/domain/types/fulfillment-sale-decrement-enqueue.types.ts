/**
 * Sale Decrement Enqueue Intents (#3453, epic #3460)
 *
 * The pure half of the producer of `inventory.saleDecrement`. With the OMS on, a
 * routed order is never created in the product master, so its stock must be
 * lowered there by OpenLinker; one job per routed work does that. This decides
 * which jobs to enqueue and under which dedupe key; the two routing hosts
 * (`OrderIngestionService` and `FulfillmentWorkRouteHandler`) perform the I/O.
 *
 * A derivation rather than an enqueue for the reason its dispatch sibling is
 * (`fulfillment-dispatch-enqueue.types.ts`): `fulfillment` is a registered
 * zero-sibling-edge leaf and may not import `@openlinker/core/sync`, and the two
 * hosts reach different enqueue ports.
 *
 * @module libs/core/src/fulfillment/domain/types
 */
import type { RoutedWorkRef } from './fulfillment-dispatch-enqueue.types';

/** "Lower this routed work's sold quantities in their product masters." */
export interface SaleDecrementEnqueueIntent {
  readonly workId: string;
  readonly orderId: string;
  /**
   * `SyncJob.connectionId` — the connection the ORDER came through, never a
   * synthetic id and never the holder. Every OMS-packed work shares one holder,
   * so scoping by it would serialise every decrement in the installation behind
   * one per-scope cap (#2609's defect); the order's source spreads them the way
   * orders actually arrive.
   */
  readonly connectionId: string;
  readonly dedupeKey: string;
}

/**
 * The enqueue dedupe key for one work's decrement job.
 *
 * Its own namespace. It answers "have we already asked a worker to lower this
 * work's stock?"; the per-LINE at-most-once guarantee is the Postgres claim the
 * job takes, keyed `sale:{owner}:{workId}:{lineId}`, so a swallowed duplicate
 * enqueue can never cost a decrement and a duplicate job can never repeat one.
 */
export function buildSaleDecrementJobDedupeKey(workId: string): string {
  return `inventory:sale-decrement:${workId}`;
}

/**
 * One decrement job per routed work.
 *
 * Unlike the dispatch derivation, a work with NO holder is included: the units
 * were sold whoever ends up packing them, and leaving the master's stock high
 * until a holder is assigned is exactly the oversell window this closes.
 *
 * Pure: no I/O, no clock, no mutation of its arguments.
 */
export function deriveSaleDecrementEnqueueIntents(
  works: readonly RoutedWorkRef[],
  orderId: string,
  orderSourceConnectionId: string
): readonly SaleDecrementEnqueueIntent[] {
  return works.map((work) => ({
    workId: work.workId,
    orderId,
    connectionId: orderSourceConnectionId,
    dedupeKey: buildSaleDecrementJobDedupeKey(work.workId),
  }));
}
