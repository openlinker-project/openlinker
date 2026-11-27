/**
 * Payment method vocabulary (#3294, #3775) - hand-mirrored from the backend
 * `PaymentMethod` union (`libs/core/src/orders/domain/types/payment-method.types.ts`);
 * the web app cannot import `@openlinker/core` (#591). How the buyer pays,
 * independent of the payment status. `unknown` is a first-class value, not an
 * absence.
 *
 * Lives in `shared/` because both `features/orders` and `features/connections`
 * need the runtime array and the two features already depend on each other's
 * barrel one way; a third direction would close a barrel-to-barrel cycle.
 * Kept in sync by `scripts/check-payment-method-mirror.mjs`.
 */
export const PaymentMethodValues = [
  'online',
  'bank_transfer',
  'cash_on_delivery',
  'unknown',
] as const;
export type PaymentMethod = (typeof PaymentMethodValues)[number];
