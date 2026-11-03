/**
 * Order Payment Method Types
 *
 * Neutral, source-agnostic answer to "HOW does the buyer pay?" for an ingested
 * order (#3294). Orthogonal to `PaymentStatus` (#928), which answers "may this
 * ship yet?": a prepaid order can be paid by card or by bank transfer, and a
 * cash-on-delivery order is unpaid by definition. Neither axis can be derived
 * from the other, which is why this is a second field rather than a widening of
 * the first.
 *
 * Each source adapter maps its own native field onto this closed union where it
 * can say so WITH EVIDENCE. Anything it cannot state - an absent field, an
 * unrecognised value, a free-text plugin slug - is `unknown`, never a guess.
 * That rule is load-bearing: `unknown` never pre-fills a COD amount and never
 * selects an invoice payment form, so a wrong guess would put a wrong figure
 * on a label or a fiscal document.
 *
 * - `online`           - settled through the channel's own online payment.
 * - `bank_transfer`    - the buyer pays by bank transfer.
 * - `cash_on_delivery` - the buyer pays the courier on delivery.
 * - `unknown`          - the source did not say, or said something this build
 *   cannot map with confidence.
 *
 * @module libs/core/src/orders/domain/types
 */

export const PaymentMethodValues = [
  'online',
  'bank_transfer',
  'cash_on_delivery',
  'unknown',
] as const;

export type PaymentMethod = (typeof PaymentMethodValues)[number];

export const PAYMENT_METHOD = {
  Online: 'online',
  BankTransfer: 'bank_transfer',
  CashOnDelivery: 'cash_on_delivery',
  Unknown: 'unknown',
} as const satisfies Record<'Online' | 'BankTransfer' | 'CashOnDelivery' | 'Unknown', PaymentMethod>;

/** Narrow an untrusted value (a persisted column, a snapshot key) to a `PaymentMethod`. */
export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PaymentMethodValues as readonly string[]).includes(value);
}
