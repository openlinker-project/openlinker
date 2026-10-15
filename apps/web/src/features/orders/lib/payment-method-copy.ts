/**
 * Operator-facing wording for an order's payment method (#3294).
 *
 * One table for every surface that names it - the order header chip and the
 * fulfilment task's Payment card - so the two cannot describe one order in two
 * ways. `unknown` and an absent value have no entry on purpose: a surface that
 * has nothing true to say renders nothing rather than "unknown".
 *
 * @module apps/web/src/features/orders/lib
 */
import type { PaymentMethod, PaymentStatus } from '../api/order-snapshot.schema';

const PAYMENT_METHOD_LABEL: Partial<Record<PaymentMethod, string>> = {
  online: 'Online payment',
  bank_transfer: 'Bank transfer',
  cash_on_delivery: 'Cash on delivery',
};

/** The label for a method the source positively identified, else `null`. */
export function paymentMethodLabel(method: PaymentMethod | undefined): string | null {
  return method === undefined ? null : (PAYMENT_METHOD_LABEL[method] ?? null);
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
