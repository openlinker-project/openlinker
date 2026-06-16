/**
 * Erli Order → IncomingOrder Mapper
 *
 * Pure translation from Erli's provisional order wire shape (`ErliOrder`) to the
 * neutral `IncomingOrder` DTO returned by `OrderSourcePort.getOrder`. The future
 * `ErliOrderSourceAdapter` (#993) composes this function, exactly as
 * `PrestashopOrderSourceAdapter` composes `PrestashopOrderMapper`.
 *
 * Encodes Erli's three-status set onto the neutral order status + payment status:
 * COD orders arrive already committed (`purchased` + paid-on-delivery) and map to
 * `processing` + `paymentStatus:'cod'`; settled online orders map to `processing`
 * + `'paid'`; not-yet-settled online orders (`pending`) map to `pending` +
 * `'awaiting'`; `cancelled` maps through faithfully (#993 observes it to trigger
 * Erli's stock-restore PATCH, ADR-025 §4a).
 *
 * Identity resolution is DEFERRED to #995 and happens downstream in core
 * (`OrderIngestionService`) — this mapper carries buyer/PII fields and the
 * line-item product reference through RAW (external-only), never emitting
 * internal `ol_*` ids (same rationale as `allegro-order-source.adapter.ts`
 * lines 59-61, 226-227; contract: `incoming-order.types.ts` lines 38-43,
 * 119-124).
 *
 * Pure + total: no `Logger`, no DI, no I/O. Because it cannot log, raw buyer PII
 * never reaches the logger — buyer data lives only on the returned DTO (its
 * fields + `metadata`). It does not throw for missing optional fields (returns
 * safe defaults); a genuinely malformed wire object is the #993 adapter's concern.
 *
 * PROVISIONAL (#992): all wire field names referenced here come from
 * `erli-order.types.ts`, the single reconciliation point — the spike updates
 * that file (+ re-asserts fixtures), not this mapper.
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
  ErliOrderLineItem,
  ErliOrderPaymentMethod,
  ErliOrderStatus,
  ErliOrderTotals,
} from './erli-order.types';

/**
 * Maps an Erli order resource onto the neutral `IncomingOrder` DTO.
 *
 * Raw passthrough only — no identifier mapping (#995). Pure + total.
 */
export function mapErliOrderToIncomingOrder(order: ErliOrder): IncomingOrder {
  const items = order.lineItems.map(mapLineItem);
  const nowIso = new Date().toISOString();

  return {
    externalOrderId: order.id,
    orderNumber: order.orderNumber,
    status: mapStatus(order.status),
    customerExternalId: order.buyer.id,
    customerEmail: order.buyer.email,
    items,
    totals: mapTotals(order.totals, items),
    shippingAddress: mapAddress(order.shippingAddress),
    billingAddress: mapAddress(order.billingAddress),
    paymentStatus: derivePaymentStatus(order.status, order.paymentMethod),
    placedAt: order.placedAt,
    createdAt: order.createdAt ?? nowIso,
    updatedAt: order.updatedAt ?? nowIso,
    // Buyer/PII placed on the DTO's metadata for observability — NEVER logged
    // (the mapper has no Logger). Identity resolution is #995, downstream in core.
    metadata: {
      buyer: {
        id: order.buyer.id,
        email: order.buyer.email,
      },
    },
  };
}

/**
 * Maps Erli's wire status onto the neutral closed `OrderStatus` set. `purchased`
 * → `processing` (no neutral `purchased`/`paid` status exists; the COD-vs-PayU
 * distinction is carried on `paymentStatus`). Unknown/absent → `pending`
 * (conservative; mirrors `prestashop-order.mapper.ts:109`).
 */
function mapStatus(status: ErliOrderStatus): OrderStatus {
  switch (status) {
    case 'purchased':
      return 'processing';
    case 'cancelled':
      return 'cancelled';
    case 'pending':
      return 'pending';
    default:
      return 'pending';
  }
}

/**
 * Derives the neutral payment status from `(status, paymentMethod)` — the
 * COD-arrives-paid encoding (#992 / Q3). Isolated here so a wrong COD
 * discriminator assumption is a one-helper fix:
 *   - `purchased` + COD-method → `cod`   (committed, paid-on-delivery)
 *   - `purchased` + online     → `paid`  (settled at purchase)
 *   - `purchased` + absent     → `paid`  (no COD discriminator → treated as settled)
 *   - `pending`                → `awaiting` (online not yet settled)
 *   - `cancelled` / unknown    → undefined (no refund signal in v1)
 */
function derivePaymentStatus(
  status: ErliOrderStatus,
  paymentMethod?: ErliOrderPaymentMethod
): PaymentStatus | undefined {
  if (status === 'purchased') {
    return paymentMethod === 'cod' ? 'cod' : 'paid';
  }
  if (status === 'pending') {
    return 'awaiting';
  }
  // cancelled / unknown — no refund signal in v1.
  return undefined;
}

/**
 * Maps an Erli line item onto the neutral `IncomingOrderItem`. Emits a RAW
 * external product reference (`{ type: 'variant', externalId }`, #992 / Q5) —
 * core resolves it to internal ids (#995). `price` unwraps the money object to
 * its numeric `amount` (the DTO's `price` is a `number`, not a money object).
 */
function mapLineItem(li: ErliOrderLineItem): IncomingOrderItem {
  return {
    id: li.id,
    productRef: { type: 'variant', externalId: li.productExternalId },
    quantity: li.quantity,
    price: li.price.amount,
    sku: li.sku,
    name: li.name,
  };
}

/**
 * Maps Erli order totals onto the neutral `IncomingOrderTotals`, deriving missing
 * components (#992 / Q4; mirrors `allegro-order-source.adapter.ts:254-290`):
 *   - `subtotal ?? Σ(price × qty)`
 *   - `tax ?? 0`
 *   - `shipping ?? max(0, total − subtotal)`
 * `taxTreatment` left undefined until #992 confirms gross vs net.
 */
function mapTotals(totals: ErliOrderTotals, items: IncomingOrderItem[]): IncomingOrderTotals {
  const subtotal =
    totals.subtotal ?? items.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const tax = totals.tax ?? 0;
  const shipping = totals.shipping ?? Math.max(0, totals.total - subtotal);

  return {
    subtotal,
    tax,
    shipping,
    total: totals.total,
    currency: totals.currency,
  };
}

/**
 * Maps an Erli address onto the neutral `IncomingOrderAddress` field-for-field
 * (`street→address1`, `street2→address2`, `region→state`,
 * `countryCode→country`). Returns `undefined` when the source address is absent.
 */
function mapAddress(address?: ErliOrderAddress): IncomingOrderAddress | undefined {
  if (!address) {
    return undefined;
  }

  return {
    firstName: address.firstName,
    lastName: address.lastName,
    company: address.company,
    address1: address.street,
    address2: address.street2,
    city: address.city,
    state: address.region,
    postalCode: address.postalCode,
    country: address.countryCode,
    phone: address.phone,
  };
}
