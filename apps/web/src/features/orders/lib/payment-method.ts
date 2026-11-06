/**
 * Operator-facing wording for an order's payment method (#3294).
 *
 * One table for every surface that names it - the order header chip and the
 * fulfilment task's Payment card - so the two cannot describe one order in two
 * ways. `unknown` and an absent value have no entry on purpose: a surface that
 * has nothing true to say renders nothing rather than "unknown".
 *
 * The words come from the `orders` namespace, read when called so they follow
 * the active language.
 *
 * @module apps/web/src/features/orders/lib
 */
import { getMessages } from '../../../shared/i18n';
import type { PaymentMethod, PaymentStatus } from '../api/order-snapshot.schema';

/** The label for a method the source positively identified, else `null`. */
export function paymentMethodLabel(method: PaymentMethod | undefined): string | null {
  const copy = getMessages('orders').paymentMethod;
  switch (method) {
    case 'online':
      return copy.online;
    case 'bank_transfer':
      return copy.bankTransfer;
    case 'cash_on_delivery':
      return copy.cashOnDelivery;
    default:
      return null;
  }
}

/**
 * The header chip's label. Hidden when the payment-status chip beside it
 * already says the same thing (a `cod` status next to a cash-on-delivery
 * method), so the header never repeats itself.
 */
export function paymentMethodChipLabel(
  method: PaymentMethod | undefined,
  status: PaymentStatus | undefined,
): string | null {
  if (method === 'cash_on_delivery' && status === 'cod') {
    return null;
  }
  return paymentMethodLabel(method);
}
