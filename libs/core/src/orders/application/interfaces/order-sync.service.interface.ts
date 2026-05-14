/**
 * Order Sync Service Interface
 *
 * Defines the contract for order synchronization operations. Implemented by
 * OrderSyncService to provide order routing from sources to destination processors.
 *
 * @module libs/core/src/orders/application/interfaces
 * @see {@link OrderSyncService} for the implementation
 */
import type { Order } from '../../domain/types/order.types';

/**
 * Order sync request metadata
 *
 * Contains source connection information for order synchronization.
 */
export interface OrderSyncRequest {
  /**
   * Unified order with internal OpenLinker IDs
   */
  order: Order;

  /**
   * Source connection ID (where the order originated)
   */
  sourceConnectionId: string;

  /**
   * Optional source event ID (for tracking the event that triggered this sync)
   */
  sourceEventId?: string;
}

/**
 * Order sync result
 *
 * Discriminated union describing the outcome of syncing an order to a single
 * destination processor. `status: 'success'` carries the destination order
 * reference; `status: 'failed'` carries the error message so callers can
 * surface partial failures without losing track of successful destinations.
 */
export type OrderSyncResult =
  | {
      destinationConnectionId: string;
      status: 'success';
      orderRef: {
        orderId: string;
        orderNumber?: string;
      };
    }
  | {
      destinationConnectionId: string;
      status: 'failed';
      error: {
        message: string;
        code?: string;
      };
    };

/**
 * Order Sync Service Interface
 *
 * Application service for synchronizing orders from sources to destination processors.
 * Routes unified orders (with internal IDs) to configured OrderProcessorManager adapters.
 */
export interface IOrderSyncService {
  /**
   * Sync order to destination processor(s)
   *
   * Resolves all active OrderProcessorManager adapters (excluding the source
   * connection) and dispatches the order to each in parallel. Per-destination
   * failures are isolated — a failed destination yields a `status: 'failed'`
   * result rather than aborting the entire sync.
   *
   * @param request - Order sync request with order and source metadata
   * @returns Array of sync results (one per destination, success or failed)
   * @throws {NoOrderDestinationsAvailableException} if no eligible destinations are resolved
   */
  syncOrder(request: OrderSyncRequest): Promise<OrderSyncResult[]>;
}
