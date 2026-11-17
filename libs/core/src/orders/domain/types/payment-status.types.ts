/**
 * Order Payment Status Types
 *
 * Neutral, source-agnostic payment-status axis for an ingested order (#928).
 * Distinct from `OrderStatus` (lifecycle: pending/processing/shipped/…) and
 * from `FulfillmentStatus` (the OMP's dispatch view) — payment status answers
 * the single dispatch-gate question "may this order ship yet?".
 *
 * Source adapters (today: Allegro `OrderSourceAdapter`) map their native
 * payment representation onto this union; sources that don't expose payment
 * leave it `undefined` and the surface degrades gracefully (no chip, no gate).
 *
 * - `paid`      — buyer has paid in advance; dispatch permitted.
 * - `cod`       — cash on delivery; dispatch permitted (paid on receipt).
 * - `awaiting`  — payment not yet completed; dispatch blocked.
 * - `refunded`  — order refunded; dispatch blocked. Forward-compat: no source
 *   emits it in v1 (the Allegro checkout-form carries no refund signal), but a
 *   future refund-event path can set it without a contract change.
 *
 * @module libs/core/src/orders/domain/types
 */

export const PaymentStatusValues = ['paid', 'cod', 'awaiting', 'refunded'] as const;

export type PaymentStatus = (typeof PaymentStatusValues)[number];

export const PAYMENT_STATUS = {
  Paid: 'paid',
  Cod: 'cod',
  Awaiting: 'awaiting',
  Refunded: 'refunded',
} as const satisfies Record<'Paid' | 'Cod' | 'Awaiting' | 'Refunded', PaymentStatus>;

/** Narrow an untyped value (a persisted snapshot field) to a known status. */
export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && (PaymentStatusValues as readonly string[]).includes(value);
}

/**
 * Whether fulfilment routing must wait for the buyer's payment (#4033).
 *
 * A routed order goes on the pack bench and lowers the product master's stock
 * (#3453), so routing an order nobody has paid for lets a packer pack it and
 * keeps stock taken for an order the marketplace may still cancel. Only
 * `awaiting` and `refunded` wait. `cod` is paid on delivery and ships now.
 * `undefined` means the source does not report payment at all, so it routes as
 * before - holding it would stop every order from such a source for good.
 *
 * This only decides whether a NEW routing decision may be made. A refund that
 * arrives after the order was routed is deliberately left alone: the routing
 * commit's `already-routed` guard runs first, so existing work is never
 * withdrawn here. Undoing a routed order is the cancellation path's job.
 */
export function isRoutingAwaitingPayment(status: PaymentStatus | undefined): boolean {
  return status === PAYMENT_STATUS.Awaiting || status === PAYMENT_STATUS.Refunded;
}
