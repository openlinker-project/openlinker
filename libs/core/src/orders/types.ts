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
 * `Order` (#2155, ADR-041 decision 2) is exported TYPE-ONLY: the router
 * (`@openlinker/core/sales-documents`) takes an `Order` as a caller-supplied
 * VALUE PARAMETER, typed via `import type`, so it depends on `orders` for
 * types alone — never an injected `OrdersModule` token. That is what keeps
 * the candidate `orders -> invoicing -> sales-documents -> orders`
 * three-node cycle from ever existing. `Order`'s own domain-types file
 * (`order.types.ts`) carries one further `import type` from
 * `@openlinker/core/shipping`; both erase at build time, so re-exporting
 * `Order` here adds NO runtime edge beyond `PAYMENT_STATUS`'s existing one.
 *
 * @module libs/core/src/orders/types
 */
export {
  PaymentStatusValues,
  PAYMENT_STATUS,
} from './domain/types/payment-status.types';
export type { PaymentStatus } from './domain/types/payment-status.types';
export type { Order } from './domain/types/order.types';
export type { BuyerTaxId } from './domain/types/buyer-tax-id.types';
export { readBuyerTaxId, buyerHasTaxId } from './domain/types/buyer-tax-id.types';

/**
 * `CoverageResolutionStatus` (epic #2452) — the `analytics_remediation_runs`
 * ledger's lifecycle reuses this union rather than minting a parallel one, so
 * the ledger and the orders-side detector it reports on cannot drift (see
 * `AnalyticsRemediationRunRepository`). `analytics` has zero outbound edges
 * to sibling core contexts otherwise, and this sub-barrel is what keeps that
 * edge from pulling in `OrdersModule` — the value export is still a real
 * `require()` (the runtime `isCoverageResolutionStatus` guard needs the
 * array), so the `analytics --> orders` edge is narrower than type-only, not
 * absent.
 */
export { CoverageResolutionStatusValues } from './domain/types/coverage-detection.types';
export type { CoverageResolutionStatus } from './domain/types/coverage-detection.types';
