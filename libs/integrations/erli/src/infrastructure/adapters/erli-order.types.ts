/**
 * Erli Order Resource Wire Types
 *
 * Provisional read shapes for Erli's order resource (the JSON the future
 * `ErliOrderSourceAdapter` — #993 — fetches and feeds into the #994 mapper).
 * Models Erli's three-status set (`pending | purchased | cancelled`) plus the
 * line items, totals, addresses, and raw buyer/PII fields the neutral
 * `IncomingOrder` DTO carries.
 *
 * PROVISIONAL (#992): the exact Erli order field names, status vocabulary,
 * money shape, payment-method discriminator, line-item reference type, and
 * timestamp keys are NOT confirmed until the sandbox spike. This file is the
 * SINGLE reconciliation point for the order resource — the mapper imports wire
 * shapes only from here, so #992 updates exactly one place. Intentionally NOT
 * coupled to `erli-product.types.ts` (its own `ErliMoney`) to avoid lock-step
 * `#992` churn across the offers + orders halves; if the spike confirms
 * identical money shapes, a later refactor can unify them.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */

/** Provisional Erli order money shape (#992). */
export interface ErliOrderMoney {
  amount: number;
  currency: string;
}

/**
 * Provisional Erli order status vocabulary (#992). COD orders arrive already
 * `purchased` (committed, paid-on-delivery); the PayU-online flow may sit
 * `pending` until payment settles. Unknown/absent values fall back to
 * `pending` in the mapper.
 */
export type ErliOrderStatus = 'pending' | 'purchased' | 'cancelled';

/**
 * Provisional payment-method discriminator (#992). The mapper keys the
 * COD-arrives-paid encoding off the literal `'cod'` (cash-on-delivery, arrives
 * `purchased` + paid-on-delivery); any other value (e.g. the expected `'payu'`
 * online settlement) is treated as online. Kept as an open `string` because the
 * exact wire vocabulary is unconfirmed until the spike — the known literals are
 * documented here, not encoded as redundant union constituents.
 */
export type ErliOrderPaymentMethod = string;

/** Provisional Erli order line item (#992). */
export interface ErliOrderLineItem {
  /** Line-item identifier (adapter-provided). */
  id: string;
  /** Raw external product/variant id the buyer bought on Erli (#992 / Q5). */
  productExternalId: string;
  quantity: number;
  price: ErliOrderMoney;
  sku?: string;
  name?: string;
}

/** Provisional Erli order address (#992); maps onto `IncomingOrderAddress`. */
export interface ErliOrderAddress {
  firstName?: string;
  lastName?: string;
  company?: string;
  street: string;
  street2?: string;
  city: string;
  region?: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
}

/** Provisional Erli buyer — raw PII (#992); identity resolution deferred to #995. */
export interface ErliOrderBuyer {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

/** Provisional Erli order totals (#992); subtotal/tax/shipping may be absent. */
export interface ErliOrderTotals {
  subtotal?: number;
  tax?: number;
  shipping?: number;
  total: number;
  currency: string;
}

/** Provisional Erli order resource — the shape `getOrder` (#993) reads (#992). */
export interface ErliOrder {
  /** Marketplace-native order id (#992 / Q7). */
  id: string;
  /** Optional human-readable order number. */
  orderNumber?: string;
  status: ErliOrderStatus;
  paymentMethod?: ErliOrderPaymentMethod;
  buyer: ErliOrderBuyer;
  lineItems: ErliOrderLineItem[];
  totals: ErliOrderTotals;
  shippingAddress?: ErliOrderAddress;
  billingAddress?: ErliOrderAddress;
  /** ISO-ish timestamps (#992 / Q6); created/updated fall back to ingestion time. */
  createdAt?: string;
  updatedAt?: string;
  /** When the buyer placed the order on Erli; omitted when absent. */
  placedAt?: string;
}
