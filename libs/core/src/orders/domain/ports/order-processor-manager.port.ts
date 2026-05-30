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
   * **Returns the destination-native external order id (#909).** The returned
   * `OrderRef.orderId` MUST be the id assigned by the destination platform,
   * never an internal OpenLinker id. Implementations create unconditionally —
   * idempotency (skip-if-already-created) and the external↔internal identifier
   * mapping write are owned by `OrderSyncService` under a per-(order,
   * destination) lock, so an adapter carries no create-or-skip guard of its
   * own. Adapters MAY keep platform-side duplicate recovery (e.g. recover the
   * existing order id on a unique-constraint error) as defense-in-depth.
   *
   * **Source-authoritative pricing invariant (#895, ADR-014):** implementations
   * MUST create destination order lines priced at the supplied
   * `order.items[].price` (the buyer-paid source price), honouring
   * `order.totals.taxTreatment`. Implementations MUST NOT substitute the
   * destination's own catalog price. An implementation that cannot pin the
   * buyer-paid price MUST fail (throw) rather than silently fall back to the
   * catalog. This is a base-contract invariant of every destination order
   * processor, not an optional capability.
   *
   * @param order - Order creation request with internal IDs
   * @returns Order reference (destination-native orderId and optional orderNumber)
   * @throws Error if order creation fails
   */
  createOrder(order: OrderCreate): Promise<OrderRef>;
}
