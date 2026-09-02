/**
 * Offer Stock Restore Service Interface
 *
 * Contract for the order-cancellation sequence (#1146 / ADR-028, repointed onto
 * the reservation ledger by #2348).
 *
 * ONE method, because the ORDERING IS THE CONTRACT. A cancellation has to do two
 * things — give OL's own hold back to the ledger, and publish the resulting
 * available-to-promise to the marketplace — and they are not interchangeable:
 *
 *   1. **RELEASE** the order's held reservations (`held → released`). This is
 *      what lowers `olReservedQuantity`, and the ATP read filters
 *      `status = 'held'`, so a released row leaves the subtraction immediately.
 *      It is therefore a real ATP transition, not bookkeeping.
 *   2. **RESTORE** — publish the recomputed ATP outward.
 *
 * Run in the other order, the restore reads an ATP still net of the very hold
 * being cancelled and publishes a quantity SHORT by exactly the cancelled
 * amount — a live offer under-selling, permanently, with nothing in any log to
 * say so. Splitting the two across two handlers would make that ordering a
 * convention; here it is a single method whose restore step is unreachable
 * without the release's own return value (see the implementation).
 *
 * The result is reported rather than voided so every non-restoring exit is
 * observable — see {@link OfferStockRestoreOutcome}.
 *
 * @module libs/core/src/listings/application/interfaces
 */
import type { OfferStockRestoreResult } from '../types/offer-stock-restore.types';

export interface IOfferStockRestoreService {
  /**
   * Release a cancelled order's holds, then restore its offers' marketplace
   * stock to the recomputed available-to-promise.
   *
   * **Throws** when the release could not close every hold. That is not a
   * degradation: live holds still stand, so publishing would under-restore, and
   * a handler returning `ok` would end the job forever — there is no reconcile
   * sweep for stock restore, unlike #1689's pause. Throwing puts the whole
   * (idempotent) sequence back on the ordinary retry ladder.
   *
   * @param connectionId - The order's source marketplace connection.
   * @param internalOrderId - OL internal order id (`ol_order_*`).
   */
  restoreStockForCancelledOrder(
    connectionId: string,
    internalOrderId: string,
  ): Promise<OfferStockRestoreResult>;
}
