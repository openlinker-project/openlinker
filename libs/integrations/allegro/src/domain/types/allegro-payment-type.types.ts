/**
 * Allegro Payment Type Enum (#472)
 *
 * Allegro **does not expose** a live `/payments/payment-providers` or
 * equivalent endpoint — these values are documented in the checkout-form
 * `payment.type` field schema. Captures every payment provider type a
 * checkout-form can land with.
 *
 * **Corrected 2026-10-16** against Allegro's published OpenAPI
 * (`CheckoutFormPaymentType`): exactly CASH_ON_DELIVERY, WIRE_TRANSFER, ONLINE,
 * SPLIT_PAYMENT, EXTENDED_TERM. The earlier list carried BANK_TRANSFER,
 * INSTALLMENTS and WALLET, which Allegro never sends. Update the values below
 * if Allegro ships new payment types.
 *
 * @module libs/integrations/allegro/src/domain/types
 */

import type { MappingOption } from '@openlinker/core/orders';

export const ALLEGRO_PAYMENT_TYPE_OPTIONS: ReadonlyArray<MappingOption> = [
  { value: 'ONLINE', label: 'Online payment (Allegro Pay / card / instant transfer)' },
  { value: 'CASH_ON_DELIVERY', label: 'Cash on delivery' },
  { value: 'WIRE_TRANSFER', label: 'Bank transfer outside Allegro Finance' },
  { value: 'SPLIT_PAYMENT', label: 'Split payment' },
  { value: 'EXTENDED_TERM', label: 'Extended payment term (Allegro Pay Business)' },
];
