/**
 * Offer Stock Restore Service Interface
 *
 * Contract for the order-cancellation stock-restore orchestration (#1146).
 * Given a cancelled order, resolves the order's variants → distinct external
 * offer ids + absolute master-inventory targets, then dispatches the
 * destination marketplace's `OfferStockRestorer` capability. No-op when the
 * connection's adapter does not support the capability.
 *
 * @module libs/core/src/listings/application/interfaces
 */

export interface IOfferStockRestoreService {
  /**
   * Restore marketplace stock for a cancelled order's offers.
   *
   * @param connectionId - The order's source marketplace connection.
   * @param internalOrderId - OL internal order id (`ol_order_*`).
   */
  restoreStockForCancelledOrder(connectionId: string, internalOrderId: string): Promise<void>;
}
