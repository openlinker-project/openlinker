/**
 * Orders — types sub-barrel (cycle-breaker seam).
 *
 * Exports pure, dependency-free constants and types from the orders context
 * WITHOUT pulling in `OrdersModule`. This sub-barrel exists because the main
 * `@openlinker/core/orders` barrel re-exports `OrdersModule`, which imports
 * `InvoicingModule` — so any value-import from the main barrel inside
 * `InvoicingModule` would close a CJS module-load cycle. This seam lets
 * `InvoicingModule` import `PAYMENT_STATUS` safely.
 *
 * Only add exports here when: (a) they are dependency-free leaves (no
 * `@nestjs/common`, no other context imports, no ORM entities), AND (b) there
 * is a concrete consumer inside a context that cannot use the main barrel
 * due to the cycle described above.
 *
 * @module libs/core/src/orders/types
 */
export {
  PaymentStatusValues,
  PAYMENT_STATUS,
} from './domain/types/payment-status.types';
export type { PaymentStatus } from './domain/types/payment-status.types';
