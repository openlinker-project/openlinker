/**
 * Allegro Payment Type Enum (#472)
 *
 * Allegro **does not expose** a live `/payments/payment-providers` or
 * equivalent endpoint — these values are documented in the checkout-form
 * `payment.type` field schema. Captures every payment provider type a
 * checkout-form can land with.
 *
 * **Captured 2026-05-01** from Allegro's developer docs (checkout-form
 * payment schema). Update this comment + the values below if Allegro ships
 * new payment types.
 *
 * @module libs/integrations/allegro/src/domain/types
 */

import type { MappingOption } from '@openlinker/core/orders';

export const ALLEGRO_PAYMENT_TYPE_OPTIONS: ReadonlyArray<MappingOption> = [
  { value: 'ONLINE', label: 'Online payment (Allegro Pay / card / instant transfer)' },
  { value: 'CASH_ON_DELIVERY', label: 'Cash on delivery' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'INSTALLMENTS', label: 'Installments' },
  { value: 'WALLET', label: 'Wallet' },
  { value: 'SPLIT_PAYMENT', label: 'Split payment' },
];
