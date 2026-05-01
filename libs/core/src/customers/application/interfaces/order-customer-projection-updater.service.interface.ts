/**
 * Order Customer Projection Updater Service Interface
 *
 * Defines the contract for syncing customer projection state from an ingested
 * order: address projections (shipping / billing) and name backfill onto the
 * customer projection itself. Implemented by OrderCustomerProjectionUpdaterService.
 *
 * @module libs/core/src/customers/application/interfaces
 * @see {@link OrderCustomerProjectionUpdaterService} for the implementation
 */
import type { Order } from '@openlinker/core/orders';

export interface IOrderCustomerProjectionUpdaterService {
  /**
   * Update customer + address projections from an ingested order.
   *
   * - Backfills `firstName` / `lastName` on the customer projection from
   *   `order.shippingAddress` (fallback to `order.billingAddress`), without
   *   clobbering already-set names with `null`.
   * - Upserts shipping + billing address projections.
   * - Honours `OL_STORE_PII`: hash-only mode forces names + address fields to `null`.
   *
   * Designed to be called best-effort from the order ingestion pipeline; the
   * caller wraps in try/catch and never lets a projection failure block order sync.
   */
  updateProjectionsForOrder(
    order: Order,
    internalCustomerId: string,
    sourceConnectionId: string,
  ): Promise<void>;
}

// Re-export token for convenience
export { ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN } from '../../customers.tokens';
