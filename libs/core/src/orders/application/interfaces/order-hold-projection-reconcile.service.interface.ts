/**
 * Order Hold Projection Reconcile Service Interface (#2340, DESIGN §6.3)
 *
 * Repairs `order_records.activeHoldReason` where it disagrees with
 * `order_holds`. One-directional: the table is the authority, the column is a
 * cache, and this pass only ever moves the cache.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type { HoldProjectionReconcileResult } from '../../domain/types/order-hold-projection.types';

export interface IOrderHoldProjectionReconcileService {
  /**
   * Repair one bounded page of divergent rows.
   *
   * **Frontier-as-query with NO cursor.** Every repair consumes its own
   * selection, so a `LIMIT n` page is total and self-draining; an offset over a
   * shrinking set would step over rows. See
   * `OrderHoldProjectionRepositoryPort.findDivergentProjections`.
   *
   * **This pass never completes and carries no latch**, unlike #2317's
   * one-shot backfill: divergence can reappear at any time. Its steady-state
   * cost is one indexed query returning zero rows.
   */
  runPage(limit: number): Promise<HoldProjectionReconcileResult>;
}
