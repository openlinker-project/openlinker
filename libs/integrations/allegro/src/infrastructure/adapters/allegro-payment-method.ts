/**
 * Allegro payment-method derivation (#3294)
 *
 * Maps an Allegro checkout-form `payment.type` onto the neutral `PaymentMethod`
 * union. Pure function, co-located with `AllegroOrderSourceAdapter` beside
 * `allegro-payment-status.ts`, which answers the other question (may it ship).
 *
 * Only the three types that name a method with no ambiguity are mapped. Allegro's
 * `CheckoutFormPaymentType` enum is exactly `ONLINE`, `CASH_ON_DELIVERY`,
 * `WIRE_TRANSFER`, `SPLIT_PAYMENT` and `EXTENDED_TERM` (developer.allegro.pl
 * swagger); `WIRE_TRANSFER` is a transfer outside Allegro Finance, historical
 * but still declared. The rest (`SPLIT_PAYMENT`, `EXTENDED_TERM`) and any type
 * Allegro adds later are `unknown` rather than a guess: `unknown`
 * never pre-fills a COD amount and never selects an invoice payment form, so
 * wrongly labelling a wallet or split payment as `online` could put a wrong
 * payment form on a fiscal document. Widening the map is a one-line change once
 * someone has decided what each of those means for an invoice.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 */
import { PAYMENT_METHOD, type PaymentMethod } from '@openlinker/core/orders';
import type { AllegroCheckoutForm } from '../../domain/types/allegro-api.types';

export function deriveAllegroPaymentMethod(payment: AllegroCheckoutForm['payment']): PaymentMethod {
  switch (payment.type) {
    case 'ONLINE':
      return PAYMENT_METHOD.Online;
    case 'CASH_ON_DELIVERY':
      return PAYMENT_METHOD.CashOnDelivery;
    case 'WIRE_TRANSFER':
      return PAYMENT_METHOD.BankTransfer;
    default:
      return PAYMENT_METHOD.Unknown;
  }
}
