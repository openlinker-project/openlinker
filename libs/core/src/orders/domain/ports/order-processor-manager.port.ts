/**
 * Order Processor Manager Port
 *
 * Defines the contract for order lifecycle management in external systems.
 * This port handles write operations (create, update, cancel) for orders,
 * complementing OrderSourcePort which handles read operations.
 *
 * Adapters implementing this port are responsible for:
 * - Mapping unified Order schema to external platform format
 * - Translating internal OpenLinker IDs to external platform IDs using IdentifierMappingService
 * - Creating/updating orders in the destination system
 *
 * @module libs/core/src/orders/domain/ports
 * @see {@link OrderSourcePort} for read-only order operations
 */
import type { OrderCreate, OrderRef } from '../types/order-processor.types';

/**
 * Order Processor Manager Port
 *
 * Interface for order lifecycle management operations. Implementations handle
 * creating and managing orders in external systems (e.g., PrestaShop, Allegro).
 */
export interface OrderProcessorManagerPort {
  /**
   * Create a new order
   *
   * Creates an order in the external system. The order data uses internal
   * OpenLinker IDs; the adapter must map these to external IDs before
   * submitting to the destination platform.
   *
   * @param order - Order creation request with internal IDs
   * @returns Order reference (orderId and optional orderNumber)
   * @throws Error if order creation fails
   */
  createOrder(order: OrderCreate): Promise<OrderRef>;
}
