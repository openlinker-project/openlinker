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
