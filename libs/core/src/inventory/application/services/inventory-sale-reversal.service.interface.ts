/**
 * Inventory Sale Reversal Service Interface (#3479)
 *
 * The inverse of #3453's `IInventorySaleDecrementService`: raises a cancelled,
 * not-yet-dispatched routed order's `order_sale` decrements back into the
 * product master that owns each line.
 *
 * The order arrives as an ARGUMENT — `internalOrderId` — never resolved from
 * `orders` internally, for the same module-cycle reason #3453 states on
 * `DecrementForWorkInput`. `OfferStockRestoreService` (`listings`) is the sole
 * caller and supplies it.
 *
 * @module libs/core/src/inventory/application/services
 */
import type {
  InventorySaleDecrementReason,
  InventorySaleDecrementStatus,
} from '../../domain/types/inventory-sale-decrement.types';

/** What happened to one line's reversal this run. */
export interface SaleReversalLineOutcome {
  readonly orderLineId: string;
  readonly status: InventorySaleDecrementStatus;
  readonly reason: InventorySaleDecrementReason | null;
  readonly ownerConnectionId: string;
  /** True when this run crossed the adapter boundary for the line. */
  readonly attempted: boolean;
}

export interface ReverseSaleForOrderResult {
  readonly lines: readonly SaleReversalLineOutcome[];
}

export interface IInventorySaleReversalService {
  /**
   * Raise every one of the order's successful `order_sale` decrements back
   * into their owning product master, exactly once each.
   *
   * Reads the order's decrement rows itself (`findByOrderId`) rather than
   * taking lines as input — the caller (cancellation) has no reason to know
   * which lines were ever decremented; that is precisely what #3453's own
   * ledger already records. A line whose decrement never applied (never
   * attempted, blocked, skipped as a storefront order, or still in doubt) is
   * left alone: there is nothing on the master to give back, and reversing an
   * `in_doubt` write would risk moving stock on a line no one confirmed was
   * ever moved the other way.
   *
   * Idempotent — a retried cancellation job re-finds each line's claimed
   * reversal row and never raises the master's stock twice.
   */
  reverseForOrder(internalOrderId: string): Promise<ReverseSaleForOrderResult>;
}
