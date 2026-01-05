/**
 * Order Domain Types
 *
 * Type definitions for order domain operations. Defines order filters,
 * order status values, and other order-related types used across the
 * orders domain.
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
 * Filter criteria for querying orders. All fields are optional.
 * Used by OrderSourcePort for filtering orders from external sources.
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




