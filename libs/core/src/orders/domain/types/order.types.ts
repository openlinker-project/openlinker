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
  /**
   * Source-side shipping method reference. Carries `methodId` (the carrier-mapping
   * lookup key on the source connection) and an optional human label. Optional
   * because not every source platform exposes a method id (e.g. PrestaShop's
   * `OrderSourcePort` doesn't surface one today).
   */
  shipping?: OrderShipping;
  /**
   * Pickup-point (locker) reference. Present on Allegro orders shipped via InPost
   * Paczkomat or similar pickup networks. Carries the bare locker id alongside an
   * optional human label so destination adapters can either stamp the id into the
   * shipping address (MVP) or hand it to a module-aware carrier integration
   * (future). Decoupled from `shippingAddress` so it survives address normalization
   * and is greppable for downstream features.
   */
  pickupPoint?: OrderPickupPoint;
  /**
   * Allegro Smart! free-delivery eligibility flag, carried through from the
   * source `IncomingOrder`. Informational only — no business logic depends on
   * it in v1; future surfaces (filtering, analytics, badges) read this signal.
   * Absent (`undefined`) for non-Allegro sources and for Allegro orders
   * predating the Smart! program.
   */
  deliverySmart?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Source-side shipping reference attached to an `Order` / `IncomingOrder` /
 * `OrderCreate`. `methodId` is required when the object is present — it's the
 * carrier-mapping lookup key and the whole point of having the object. The
 * outer `shipping?:` carries the optionality.
 */
export interface OrderShipping {
  methodId: string;
  methodName?: string;
}

/**
 * Pickup-point reference (InPost Paczkomat locker etc.). `id` is the bare
 * locker code (e.g. `POZ08A`); `name` and `description` are operator-facing
 * labels (`Paczkomat POZ08A` / `Stacja paliw BP`).
 */
export interface OrderPickupPoint {
  id: string;
  name?: string;
  description?: string;
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

/**
 * How monetary amounts express tax.
 *
 * `inclusive` (gross) — `OrderItem.price`, `subtotal`, and `total` INCLUDE tax;
 * marketplaces (e.g. Allegro) report buyer-paid gross prices this way.
 * `exclusive` (net) — those amounts EXCLUDE tax.
 */
export const PriceTaxTreatmentValues = ['inclusive', 'exclusive'] as const;
export type PriceTaxTreatment = (typeof PriceTaxTreatmentValues)[number];

export interface OrderTotals {
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;

  /**
   * Whether `subtotal` / `total` and the per-line `OrderItem.price` include tax
   * (`inclusive`/gross) or exclude it (`exclusive`/net). Optional and
   * source-uniform: absent means "not asserted by the source", and a
   * destination falls back to its prior assumption. Destinations that price
   * net (e.g. PrestaShop `specific_price`) use this to decide whether the
   * buyer-paid amount must be converted to net before pinning — the tax *rate*
   * itself stays destination-side, never on the order contract.
   */
  taxTreatment?: PriceTaxTreatment;
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
