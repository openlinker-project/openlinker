/**
 * Order Sync Service Interface
 *
 * Defines the contract for order synchronization operations. Implemented by
 * OrderSyncService to provide order routing from sources to destination processors.
 *
 * @module libs/core/src/orders/application/interfaces
 * @see {@link OrderSyncService} for the implementation
 */
import { Order } from '../../domain/ports/order-source.port';

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
 * Contains the result of order synchronization to destination processors.
 */
export interface OrderSyncResult {
  /**
   * Destination connection ID where the order was synced
   */
  destinationConnectionId: string;

  /**
   * Order reference from the destination processor
   */
  orderRef: {
    orderId: string;
    orderNumber?: string;
  };
}

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
   * Routes a unified order to configured destination OrderProcessorManager adapters.
   * For MVP, routes to a single configured destination connection.
   *
   * @param request - Order sync request with order and source metadata
   * @returns Array of sync results (one per destination)
   * @throws Error if destination connection not found or order creation fails
   */
  syncOrder(request: OrderSyncRequest): Promise<OrderSyncResult[]>;
}


