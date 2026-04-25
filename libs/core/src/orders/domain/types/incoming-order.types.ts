/**
 * Incoming Order Types
 *
 * Integration-facing order DTO returned by OrderSourcePort adapters (marketplaces + shops).
 * This is intentionally decoupled from canonical persistence/domain entities so that
 * the plugin contract can remain stable even as core evolves.
 *
 * Domain-only: no framework dependencies.
 *
 * @module libs/core/src/orders/domain/types
 */

export interface IncomingOrder {
  /**
   * Marketplace-native order identifier.
   */
  externalOrderId: string;

  /**
   * Optional human-readable order number (if marketplace provides it).
   */
  orderNumber?: string;

  /**
   * Status as provided/mapped by adapter.
   */
  status: string;

  /**
   * Optional customer identifier as provided by the source (external-only).
   *
   * Core may choose to resolve this to an internal customer ID during ingestion,
   * but adapters MUST NOT emit internal OpenLinker IDs here.
   */
  customerExternalId?: string;

  /**
   * Optional buyer email from source platform.
   *
   * Used by core to create/update customer projections and enable email-fallback
   * identity resolution. Adapters should populate this when available.
   */
  customerEmail?: string;

  items: IncomingOrderItem[];
  totals: IncomingOrderTotals;

  shippingAddress?: IncomingOrderAddress;
  billingAddress?: IncomingOrderAddress;

  /**
   * ISO timestamps (strings) to keep DTO stable across runtimes.
   */
  createdAt: string;
  updatedAt: string;

  /**
   * Optional metadata for observability/debugging.
   */
  metadata?: Record<string, unknown>;
}

export interface IncomingOrderItem {
  /**
   * Item identifier (adapter-provided).
   */
  id: string;

  /**
   * External-only product reference.
   *
   * Adapters MUST NOT emit internal OpenLinker IDs here.
   * Core resolves this reference to internal IDs (or fails if mapping is missing).
   */
  productRef: IncomingOrderItemRef;

  quantity: number;
  price: number;
  sku?: string;

  /**
   * Source-reported display label (e.g. Allegro `lineItem.offer.name`).
   * Optional because not every adapter has it — PrestaShop's order-source
   * doesn't expose a free per-line product name and would need catalog
   * enrichment to populate this.
   */
  name?: string;

  /**
   * Absolute URL to a representative product image when the source provides
   * one. Optional and forward-compatible: today no order-source endpoint we
   * consume returns this (Allegro's checkout-form does not), so it's reserved
   * for future enrichment.
   */
  imageUrl?: string;
}

/**
 * External-only reference for an incoming order line item.
 *
 * Marketplaces usually reference offers/listings; some sources reference products/variants/SKUs.
 * This union makes the identifier meaning explicit and removes any prefix-based heuristics.
 */
export type IncomingOrderItemRef =
  | { type: 'offer'; externalId: string }
  | { type: 'variant'; externalId: string }
  | { type: 'product'; externalId: string }
  | { type: 'sku'; externalId: string };

export interface IncomingOrderTotals {
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
}

export interface IncomingOrderAddress {
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

