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

import type {
  OrderShipping,
  OrderPickupPoint,
  OrderDispatchWindow,
  PriceTaxTreatment,
} from './order.types';
import type { PaymentStatus } from './payment-status.types';
import type { CodToCollect } from './cod-to-collect.types';

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
   * Source-side shipping reference (e.g. Allegro `delivery.method`). Optional —
   * order sources that don't expose a delivery-method id leave it undefined.
   * Carrier resolution at the destination adapter consumes `methodId`.
   */
  shipping?: OrderShipping;

  /**
   * Pickup-point reference (Allegro `delivery.pickupPoint`, InPost-style locker).
   * Present only for pickup-point orders; locker geography lives on `shippingAddress`,
   * the structured id+labels live here.
   */
  pickupPoint?: OrderPickupPoint;

  /**
   * Allegro Smart! free-delivery flag (`delivery.smart` on the checkout-form
   * response). Informational only — no business logic depends on it in v1;
   * future surfaces (filtering, analytics, badges) read this signal. Absent
   * (`undefined`) for non-Allegro sources and for Allegro orders predating
   * the Smart! program.
   */
  deliverySmart?: boolean;
  /** Source-reported payment status (#928); absent when the source did not report it. */
  paymentStatus?: PaymentStatus;

  /**
   * Marketplace-sourced cash-on-delivery collect amount (#1435). Set by the
   * source adapter only for a cash-on-delivery order (Allegro maps
   * `summary.totalToPay` — the buyer pays the full order total on delivery).
   * Absent for prepaid orders and for sources that don't expose it.
   */
  codToCollect?: CodToCollect;

  /**
   * Marketplace dispatch (ship-by) commitment window (#927). The SLA deadline
   * is `dispatchTime.to`. Neutral concept — the Allegro adapter maps
   * `delivery.time.dispatch` here; absent for sources without a dispatch SLA.
   */
  dispatchTime?: OrderDispatchWindow;

  /**
   * When the buyer placed the order on the source marketplace, as an ISO string
   * (#926). For Allegro this is the earliest `lineItems[].boughtAt`; for
   * PrestaShop it is `date_add`. Distinct from `createdAt`/`updatedAt` (OL
   * ingestion clocks). Optional — adapters omit it when the source has no
   * placed time. Adapters MUST only emit a valid ISO date string here.
   */
  placedAt?: string;

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

  /**
   * How the source expresses tax on its amounts (gross vs net). See
   * {@link OrderTotals.taxTreatment}. Optional — absent when the source does
   * not assert it.
   */
  taxTreatment?: PriceTaxTreatment;
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

