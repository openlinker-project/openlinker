/**
 * PrestaShop payment-method derivation (#3294)
 *
 * Maps the payment module a PrestaShop order was placed through - the `module`
 * column of `ps_orders`, which the Webservice returns on the order resource -
 * onto the neutral `PaymentMethod` union. Pure function.
 *
 * ## Only PrestaShop's own payment modules are evidence
 *
 * `ps_orders.module` is the technical name of whichever module handled the
 * payment. Two modules ship with PrestaShop and have one fixed meaning:
 *
 * - `ps_cashondelivery` - "Cash on delivery (COD)".
 * - `ps_wirepayment`    - "Bank wire".
 *
 * Every other value is `unknown`, never `online`: `ps_checkpayment` is a
 * cheque, and a third-party module (PayU, Przelewy24, Stripe, a store's own) may
 * be a card gateway, a transfer, or pay-on-pickup, and the name alone cannot
 * say which. `unknown` never pre-fills a COD amount and never selects an
 * invoice payment form, so a wrong label would put a wrong figure on a courier
 * label or a fiscal document. A connection-level module map is the follow-up
 * that would let an operator say what their own module means.
 *
 * The order's `payment` column is a human label an operator can edit and a
 * module localises, so it is deliberately NOT read here.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */
import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@openlinker/core/orders';

export function derivePrestashopPaymentMethod(order: Readonly<Record<string, unknown>>): PaymentMethod {
  const module = typeof order.module === 'string' ? order.module.trim().toLowerCase() : '';

  switch (module) {
    case 'ps_cashondelivery':
      return PAYMENT_METHOD.CashOnDelivery;
    case 'ps_wirepayment':
      return PAYMENT_METHOD.BankTransfer;
    default:
      return PAYMENT_METHOD.Unknown;
  }
}

/**
 * The payment status once the payment MODULE is taken into account (#3294).
 *
 * The state row can say an order is paid (`derivePaymentStatusFromState`) and
 * is silent otherwise: a shop in the stock "Awaiting cash on delivery
 * validation" state reports nothing about money. For a core cash-on-delivery
 * order that silence is wrong in the one way that matters - the shipment gate
 * then treats the order as having no payment signal, so the courier label has
 * no COD amount to pre-fill and the operator types one by hand.
 *
 * So this fills ONLY the silence, and only for a core COD module:
 *
 * - a state that already says `paid` stays `paid` - the courier has collected,
 *   and the state is the shop's own statement;
 * - a dead order (cancelled, refunded) makes no payment claim, as before;
 * - any other module keeps reporting nothing, exactly as before.
 *
 * It never reports `awaiting`, which would refuse a label.
 */
export function withCashOnDeliveryPaymentStatus(
  stateStatus: PaymentStatus | undefined,
  method: PaymentMethod,
  orderStatus: OrderStatus
): PaymentStatus | undefined {
  if (stateStatus !== undefined) {
    return stateStatus;
  }
  if (method !== PAYMENT_METHOD.CashOnDelivery) {
    return undefined;
  }
  if (orderStatus === 'cancelled' || orderStatus === 'refunded') {
    return undefined;
  }
  return PAYMENT_STATUS.Cod;
}
