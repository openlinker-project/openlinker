/**
 * Allegro payment-status derivation
 *
 * Maps an Allegro checkout form onto the neutral `PaymentStatus` union (#928).
 * Pure function, co-located with `AllegroOrderSourceAdapter` and unit-tested in
 * isolation (mirrors the `toPrestashopProductAttributeId` helper precedent,
 * #923).
 *
 * Allegro nuance (verified on developer.allegro.pl): `payment.finishedAt` is
 * set even for cash-on-delivery orders (it marks checkout-form submission, not
 * payment receipt), so `finishedAt` alone cannot distinguish COD from prepaid.
 * The discriminator is therefore `payment.type` first:
 *
 * - `type === 'CASH_ON_DELIVERY'`                 → `cod`  (dispatch permitted, paid on receipt)
 * - else a positive `paidAmount`                   → `paid` (prepaid; dispatch permitted)
 * - else form `READY_FOR_PROCESSING` + `finishedAt` → `paid` (settled, nothing left to pay)
 * - else                                           → `awaiting` (payment not completed; blocked)
 *
 * `finishedAt` on its own is NOT proof of payment for a prepaid order: it marks
 * the end of a payment ATTEMPT, so a payment the provider rejected sets it too.
 * Seen live on the sandbox: a PayU "negative authorization" left the form at
 * `FILLED_IN` with `finishedAt` set and no `paidAmount` (E2E-22). Reading that
 * as paid unlocked dispatch and auto-issued a fiscal receipt for an order
 * nobody paid for.
 *
 * The form's own status is what settles the remaining case. Allegro moves a
 * prepaid checkout to `READY_FOR_PROCESSING` only once its payment completed
 * (`ALLEGRO_ORDER_STATUS_OPTIONS` records it as "Ready for processing (paid)"),
 * so a form there with a finished payment is paid even when `paidAmount` is
 * absent or zero - a checkout covered entirely by a voucher or Allegro credit,
 * or an older payload. Requiring `finishedAt` as well keeps the rule from
 * reading a form that reached that status some other way as a completed
 * payment.
 *
 * `refunded` is never derivable from the checkout-form (it carries no refund
 * signal), so it is intentionally not produced here — see the `PaymentStatus`
 * union docs for the forward-compat rationale.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 */
import { PAYMENT_STATUS, type PaymentStatus } from '@openlinker/core/orders';
import type { AllegroCheckoutForm } from '../../domain/types/allegro-api.types';

const ALLEGRO_COD_PAYMENT_TYPE = 'CASH_ON_DELIVERY';
const ALLEGRO_READY_FOR_PROCESSING = 'READY_FOR_PROCESSING';

/** The two parts of a checkout form the payment rule reads. */
export type AllegroCheckoutPaymentFacts = Pick<AllegroCheckoutForm, 'payment' | 'status'>;

export function deriveAllegroPaymentStatus(form: AllegroCheckoutPaymentFacts): PaymentStatus {
  const { payment } = form;
  if (payment.type === ALLEGRO_COD_PAYMENT_TYPE) {
    return PAYMENT_STATUS.Cod;
  }
  if (hasPositivePaidAmount(payment)) {
    return PAYMENT_STATUS.Paid;
  }
  return form.status === ALLEGRO_READY_FOR_PROCESSING && Boolean(payment.finishedAt)
    ? PAYMENT_STATUS.Paid
    : PAYMENT_STATUS.Awaiting;
}

/**
 * Whether the checkout form has moved past "waiting for the buyer": a COD order
 * once its form was submitted, a prepaid one once it is paid.
 */
export function isAllegroCheckoutSettled(form: AllegroCheckoutPaymentFacts): boolean {
  const status = deriveAllegroPaymentStatus(form);
  return (
    status === PAYMENT_STATUS.Paid || (status === PAYMENT_STATUS.Cod && Boolean(form.payment.finishedAt))
  );
}

function hasPositivePaidAmount(payment: AllegroCheckoutForm['payment']): boolean {
  const amount = Number(payment.paidAmount?.amount);
  return Number.isFinite(amount) && amount > 0;
}
