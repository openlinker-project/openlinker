/**
 * Order Domain Types
 *
 * Type definitions for order domain operations. Defines core order structures
 * (Order, OrderItem, OrderTotals, Address), status values, and legacy filter
 * criteria. Consumed by application services that materialize unified orders
 * after ingestion through `OrderSourcePort`.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * Order status values
 *
 * Runtime array of all valid order status values. Used for validation,
 * Swagger documentation, and UI dropdowns. Follows OpenLinker engineering
 * standards: `as const` + derived union type pattern.
 */
export const OrderStatusValues = [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;

/**
 * Order status type
 *
 * Derived union type from OrderStatusValues. Provides type safety
 * without runtime overhead.
 */
export type OrderStatus = (typeof OrderStatusValues)[number];

/**
 * Order filters
 *
 * Legacy filter criteria retained for `OrderProcessorManagerPort.getOrders`
 * and administrative queries. Not used by `OrderSourcePort`, which uses
 * cursor-based `OrderFeedInput` instead.
 */
export interface OrderFilters {
  /**
   * Start date for date range filter (inclusive)
   */
  dateFrom?: Date;

  /**
   * End date for date range filter (inclusive)
   */
  dateTo?: Date;

  /**
   * Filter orders updated since this date (for delta sync)
   */
  updatedSince?: Date;

  /**
   * Filter by order status(es)
   */
  status?: OrderStatus | OrderStatus[];

  /**
   * Maximum number of orders to return
   */
  limit?: number;

  /**
   * Number of orders to skip (for pagination)
   */
  offset?: number;
}

/**
 * Unified order structure used across the orders domain after ingestion.
 *
 * Populated by `OrderIngestionService.buildUnifiedOrder` from an `IncomingOrder`
 * once all item references are resolved to internal IDs.
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

  /**
   * Source-reported display label, propagated from `IncomingOrderItem.name`
   * by `OrderIngestionService.buildUnifiedOrder`. Optional because not every
   * order-source adapter populates it.
   */
  name?: string;

  /**
   * Absolute product-image URL when the source supplies one. Reserved for
   * future enrichment — no current adapter sets this on ingestion.
   */
  imageUrl?: string;
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
