/**
 * Order Hold Projection Types (#2340, DESIGN §6.3)
 *
 * The shapes the `order_records.activeHoldReason` cache and its reconcile pass
 * speak. Intra-context, like `OrderHoldProjectionRepositoryPort` itself.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { HoldReason } from '@openlinker/core/order-lifecycle';

/**
 * One order whose projection disagrees with `order_holds`.
 *
 * `expectedReason` is what the authority says (`null` = no open hold);
 * `projectedReason` is what the column currently holds.
 *
 * **`projectedReason` is typed `string | null`, not `HoldReason | null`, on
 * purpose**: it is what the column ACTUALLY holds, including a value no longer
 * in the vocabulary, and it is the compare-and-set witness the repair carries
 * back into `setActiveHoldReason` (see that method's `ifCurrentlyIs`).
 * Narrowing it to the union here would make an unrecognised value unrepresentable
 * and so unrepairable.
 */
export interface HoldProjectionDivergence {
  internalOrderId: string;
  expectedReason: HoldReason | null;
  projectedReason: string | null;
}

/**
 * What one `orders.holds.reconcile` page did.
 *
 * The four counters are kept separate because collapsing them would make "the
 * pass ran and changed nothing" indistinguishable from "the pass ran and could
 * not change anything" — and a cache whose repairs are invisible is a cache
 * nobody can trust.
 */
export interface HoldProjectionReconcileResult {
  /** Divergent rows read this page. */
  examined: number;
  /** Rows this pass actually corrected. */
  repaired: number;
  /** Compare-and-set lost — a peer (place/release) wrote first. Not an error. */
  superseded: number;
  /** Rows whose repair threw. Counted, never rethrown (see the service). */
  failed: number;
}
