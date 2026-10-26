/**
 * Allegro payment-status derivation
 *
 * Maps an Allegro checkout-form `payment` object onto the neutral
 * `PaymentStatus` union (#928). Pure function, co-located with
 * `AllegroOrderSourceAdapter` and unit-tested in isolation (mirrors the
 * `toPrestashopProductAttributeId` helper precedent, #923).
 *
 * Allegro nuance (verified on developer.allegro.pl): `payment.finishedAt` is
 * set even for cash-on-delivery orders (it marks checkout-form submission, not
 * payment receipt), so `finishedAt` alone cannot distinguish COD from prepaid.
 * The discriminator is therefore `payment.type` first:
 *
 * - `type === 'CASH_ON_DELIVERY'` → `cod`   (dispatch permitted, paid on receipt)
 * - else a positive `paidAmount`    → `paid`  (prepaid; dispatch permitted)
 * - else                            → `awaiting` (payment not completed; blocked)
 *
 * `finishedAt` is NOT proof of payment for a prepaid order either: it marks
 * the end of a payment ATTEMPT, so a payment the buyer abandoned or the
 * provider rejected sets it too, with `paidAmount: null` (seen live on the
 * sandbox, E2E-22). Reading it as paid unlocked dispatch and auto-issued a
 * fiscal receipt for an order nobody paid for.
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

export function deriveAllegroPaymentStatus(payment: AllegroCheckoutForm['payment']): PaymentStatus {
  if (payment.type === ALLEGRO_COD_PAYMENT_TYPE) {
    return PAYMENT_STATUS.Cod;
  }
  return hasPositivePaidAmount(payment) ? PAYMENT_STATUS.Paid : PAYMENT_STATUS.Awaiting;
}

/**
 * Whether the checkout form has moved past "waiting for the buyer": a COD order
 * once its form was submitted, a prepaid one once money actually arrived.
 */
export function isAllegroCheckoutSettled(payment: AllegroCheckoutForm['payment']): boolean {
  const status = deriveAllegroPaymentStatus(payment);
  return status === PAYMENT_STATUS.Paid || (status === PAYMENT_STATUS.Cod && Boolean(payment.finishedAt));
}

function hasPositivePaidAmount(payment: AllegroCheckoutForm['payment']): boolean {
  const amount = Number(payment.paidAmount?.amount);
  return Number.isFinite(amount) && amount > 0;
}
