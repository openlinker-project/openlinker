/**
 * Order Source Port
 *
 * Defines the contract for reading orders from external sources (e.g., PrestaShop,
 * Allegro). This is a read-only port for fetching orders from order sources.
 * Order lifecycle management (create, update, cancel) is handled by OrderProcessorManagerPort.
 *
 * This separation enables multiple order sources (PrestaShop website orders + Allegro
 * marketplace orders) while keeping write operations separate.
 *
 * @module libs/core/src/orders/domain/ports
 * @see {@link OrderProcessorManagerPort} for order lifecycle management
 */
import { OrderFilters } from '../types/order.types';

/**
 * Order domain entity (minimal interface for port)
 * Full entity definition should be in domain/entities/order.entity.ts
 */
export interface Order {
  id: string;
  orderNumber?: string;
  status: string;
  customerId?: string;
  items: OrderItem[];
  totals: OrderTotals;
  shippingAddress?: Address;
  billingAddress?: Address;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  id: string;
  productId: string;
  variantId?: string;
  quantity: number;
  price: number;
  sku?: string;
}

export interface OrderTotals {
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
}

export interface Address {
  firstName?: string;
  lastName?: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
}

/**
 * Order Source Port
 *
 * Read-only port for fetching orders from external sources.
 * Adapters implementing this port are responsible for:
 * - Fetching orders from external platforms
 * - Transforming external order data to OpenLinker unified schema
 * - Replacing external IDs with internal OpenLinker IDs using IdentifierMappingService
 */
export interface OrderSourcePort {
  /**
   * Get orders with filters
   *
   * Fetches orders from the external source matching the provided filters.
   * Returns orders with internal OpenLinker IDs (not external platform IDs).
   *
   * @param filters - Filter criteria (date range, status, pagination, etc.)
   * @returns Array of orders with internal IDs
   */
  getOrders(filters: OrderFilters): Promise<Order[]>;

  /**
   * Get order by ID
   *
   * Fetches a single order by its internal OpenLinker ID.
   * The adapter must resolve the internal ID to external ID using IdentifierMappingService.
   *
   * @param orderId - Internal OpenLinker order ID
   * @returns Order with internal IDs
   * @throws Error if order not found
   */
  getOrder(orderId: string): Promise<Order>;
}

