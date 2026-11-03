/**
 * WooCommerce payment-method derivation (#3294)
 *
 * Maps a WooCommerce order's `payment_method` gateway id onto the neutral
 * `PaymentMethod` union. Pure function, co-located with
 * `WooCommerceOrderSourceAdapter`.
 *
 * ## Only WooCommerce's own gateway ids are evidence
 *
 * `payment_method` is a free-text slug the installed gateway plugin chooses.
 * Two ids ship with WooCommerce core and have one fixed meaning:
 *
 * - `cod`  - the core "Cash on delivery" gateway.
 * - `bacs` - the core "Direct bank transfer" gateway.
 *
 * Every other value - `paypal`, `stripe`, `przelewy24`, a store's own plugin -
 * is `unknown`, never `online`. A plugin may name a card gateway, a transfer
 * gateway or a pay-on-pickup gateway, and the word alone cannot say which;
 * `unknown` never pre-fills a COD amount and never selects an invoice payment
 * form, so a wrong label would put a wrong figure on a courier label or a
 * fiscal document. A connection-level gateway map is the follow-up that would
 * let an operator say what their own plugin means.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 */
import { PAYMENT_METHOD, type PaymentMethod } from '@openlinker/core/orders';
import type { WooCommerceOrder } from './order-source/woocommerce-order.types';

export function deriveWooCommercePaymentMethod(
  order: Pick<WooCommerceOrder, 'payment_method'>
): PaymentMethod {
  switch (order.payment_method?.trim().toLowerCase()) {
    case 'cod':
      return PAYMENT_METHOD.CashOnDelivery;
    case 'bacs':
      return PAYMENT_METHOD.BankTransfer;
    default:
      return PAYMENT_METHOD.Unknown;
  }
}
