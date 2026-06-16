/**
 * Erli Order → IncomingOrder Mapper
 *
 * Pure translation from Erli's order wire shape (`ErliOrder`) to the neutral
 * `IncomingOrder` DTO returned by `OrderSourcePort.getOrder`. The
 * `ErliOrderSourceAdapter` (#993) composes this function, exactly as
 * `PrestashopOrderSourceAdapter` composes `PrestashopOrderMapper`.
 *
 * Verified against the live Erli API (#992 spike):
 *  - Money is INTEGER minor units (grosze); the neutral DTO is decimal-major, so
 *    every amount is divided by 100 at this boundary.
 *  - The buyer is `user` (NO buyer id); `user.email` rides `customerEmail` for
 *    email-fallback identity (#995). `customerExternalId` is intentionally
 *    omitted — Erli has no buyer id.
 *  - COD is the `delivery.cod` boolean (not a payment-method string).
 *  - Status enum is `pending | purchased | cancelled | returned`.
 *  - Erli reports buyer-paid GROSS prices → `taxTreatment: 'inclusive'`.
 *
 * Identity resolution is DEFERRED to #995 and happens downstream in core
 * (`OrderIngestionService`) — this mapper carries buyer email + the line-item
 * product reference through RAW (external-only), never emitting internal `ol_*`
 * ids.
 *
 * Pure + total: no `Logger`, no DI, no I/O. Because it cannot log, raw buyer PII
 * never reaches the logger. It does not throw for missing optional fields
 * (returns safe defaults); a genuinely malformed wire object is the #993
 * adapter's concern (`assertErliOrder`).
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */

import type {
  IncomingOrder,
  IncomingOrderAddress,
  IncomingOrderItem,
  IncomingOrderTotals,
  OrderStatus,
  PaymentStatus,
} from '@openlinker/core/orders';

import type {
  ErliOrder,
  ErliOrderAddress,
  ErliOrderItem,
  ErliOrderStatus,
} from './erli-order.types';

/** Erli prices are integer minor units (grosze); the neutral DTO is decimal PLN. */
function toMajorUnits(minor: number | undefined): number {
  return Math.round(minor ?? 0) / 100;
}

/**
 * Maps an Erli order resource onto the neutral `IncomingOrder` DTO.
 *
 * Raw passthrough only — no identifier mapping (#995). Pure + total.
 */
export function mapErliOrderToIncomingOrder(order: ErliOrder): IncomingOrder {
  const items = order.items.map(mapItem);
  const nowIso = new Date().toISOString();

  return {
    externalOrderId: order.id,
    status: mapStatus(order.status),
    // No customerExternalId: Erli carries no buyer id — identity keys on email
    // (#995, email_fallback). The email rides the typed field, never metadata.
    customerEmail: order.user.email,
    items,
    totals: mapTotals(order, items),
    shippingAddress: mapAddress(order.user.deliveryAddress),
    billingAddress: mapAddress(order.user.invoiceAddress),
    paymentStatus: derivePaymentStatus(order.status, order.delivery.cod),
    placedAt: order.purchasedAt,
    createdAt: order.created ?? nowIso,
    updatedAt: order.updated ?? nowIso,
    // Non-PII breadcrumb only — the seller-side status. Buyer email is kept OFF
    // the untyped metadata bag so no consumer logging `metadata` leaks PII.
    metadata: order.sellerStatus ? { sellerStatus: order.sellerStatus } : undefined,
  };
}

/**
 * Maps Erli's wire status onto the neutral closed `OrderStatus` set:
 *  - `purchased` → `processing` (committed; COD-vs-online rides `paymentStatus`)
 *  - `cancelled` → `cancelled`
 *  - `returned`  → `refunded` (closest neutral terminal "goods back" state)
 *  - `pending` / unknown → `pending` (conservative)
 */
function mapStatus(status: ErliOrderStatus): OrderStatus {
  switch (status) {
    case 'purchased':
      return 'processing';
    case 'cancelled':
      return 'cancelled';
    case 'returned':
      return 'refunded';
    case 'pending':
      return 'pending';
    default:
      return 'pending';
  }
}

/**
 * Derives the neutral payment status from `(status, delivery.cod)`:
 *  - `purchased` + COD  → `cod`      (committed, paid-on-delivery)
 *  - `purchased` + !COD → `paid`     (settled online at purchase)
 *  - `pending`          → `awaiting` (online not yet settled)
 *  - `returned`         → `refunded`
 *  - `cancelled` / unknown → undefined (no payment signal in v1)
 */
function derivePaymentStatus(status: ErliOrderStatus, cod: boolean): PaymentStatus | undefined {
  switch (status) {
    case 'purchased':
      return cod ? 'cod' : 'paid';
    case 'pending':
      return 'awaiting';
    case 'returned':
      return 'refunded';
    default:
      return undefined;
  }
}

/**
 * Maps an Erli line item onto the neutral `IncomingOrderItem`. Emits a RAW
 * external product reference (`{ type: 'variant', externalId }`) — core resolves
 * it to internal ids (#995). `price` is the per-unit amount in decimal PLN.
 */
function mapItem(item: ErliOrderItem): IncomingOrderItem {
  return {
    id: String(item.id),
    productRef: { type: 'variant', externalId: item.externalId },
    quantity: item.quantity,
    price: toMajorUnits(item.unitPrice),
    sku: item.sku,
    name: item.name,
  };
}

/**
 * Maps Erli order totals onto the neutral `IncomingOrderTotals`. Erli reports a
 * gross grand total (`totalPrice`) and a gross delivery price; prices are
 * tax-inclusive (`taxTreatment: 'inclusive'`), so there is no separately broken-
 * out tax. `subtotal` is derived as `total − shipping` so the components
 * reconcile exactly against the source-authoritative `total` (the destination's
 * total-reconciliation gate compares `subtotal + tax + shipping`).
 */
function mapTotals(order: ErliOrder, _items: IncomingOrderItem[]): IncomingOrderTotals {
  const total = toMajorUnits(order.totalPrice);
  const shipping = toMajorUnits(order.delivery.price);
  const subtotal = round2(Math.max(0, total - shipping));

  return {
    subtotal,
    tax: 0,
    shipping,
    total,
    currency: 'PLN',
    taxTreatment: 'inclusive',
  };
}

/** Round a monetary amount to 2 decimals (guards IEEE-754 residue). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Maps an Erli address onto the neutral `IncomingOrderAddress`. `address1` uses
 * Erli's full formatted street line when present, else composes
 * `street buildingNumber`; `flatNumber` (when not already folded into the full
 * line) rides `address2`. Field remap: `zip → postalCode`, `country → country`,
 * `companyName → company`. Returns `undefined` when the source address is absent.
 */
function mapAddress(address?: ErliOrderAddress): IncomingOrderAddress | undefined {
  if (!address) {
    return undefined;
  }

  const composed = [address.street, address.buildingNumber].filter(Boolean).join(' ').trim();
  const address1 = address.address ?? composed;
  // Only surface flatNumber separately when address1 came from the structured
  // parts (the full formatted line already includes it).
  const address2 =
    address.address === undefined && address.flatNumber ? `m. ${address.flatNumber}` : undefined;

  return {
    firstName: address.firstName,
    lastName: address.lastName,
    company: address.companyName,
    address1,
    address2,
    city: address.city ?? '',
    postalCode: address.zip ?? '',
    country: address.country ?? '',
    phone: address.phone,
  };
}
