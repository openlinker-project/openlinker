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
 * `OrderStatus` / `OrderStatusValues` (#2305, ADR-059) are exported for the
 * `order-lifecycle` vocabulary leaf, which projects its derived phase one-way
 * onto the transport vocabulary via `phaseToOrderStatus`. The leaf satisfies
 * both gate conditions above: `OrderStatusValues` is a dependency-free `as
 * const` leaf, and the leaf cannot use the main `@openlinker/core/orders`
 * barrel without acquiring the very sibling-context value edge ADR-053 forbids
 * it. `phaseToOrderStatus` imports the TYPE only (erasing at build time, so no
 * runtime edge is added); the runtime `OrderStatusValues` array is exported for
 * the leaf's totality spec, which iterates it — specs are walker-exempt.
 *
 * `FulfillmentRollupState` / `FulfillmentRollupStateOrNull` /
 * `OrderRecordStatus` (#2307, ADR-059) are exported TYPE-ONLY for the same
 * leaf, whose pure `deriveOrderLifecyclePhase` takes both as caller-supplied
 * VALUE PARAMETERS and switches exhaustively over them. Both satisfy the gate
 * conditions: each is an `as const`-derived union in a dependency-free
 * domain-types file, and the leaf cannot reach the main `@openlinker/core/orders`
 * barrel without acquiring the sibling-context value edge ADR-053 forbids it.
 * `import type` erases at build time, so no runtime edge is added. Restating
 * the four rollup values and three record statuses inside the leaf was
 * considered and rejected: the SQL `CASE` twin (#2309) must match these
 * vocabularies exactly, and a local copy would make the derivation's
 * `never`-typed default arms — the whole point of which is to fail the build
 * when a value is added here — vacuous.
 *
 * @module libs/core/src/orders/types
 */
export {
  PaymentStatusValues,
  PAYMENT_STATUS,
} from './domain/types/payment-status.types';
export type { PaymentStatus } from './domain/types/payment-status.types';
export type { Order } from './domain/types/order.types';
export { OrderStatusValues } from './domain/types/order.types';
export type { OrderStatus } from './domain/types/order.types';
export type {
  FulfillmentRollupState,
  FulfillmentRollupStateOrNull,
} from './domain/types/order-fulfillment.types';
export type { OrderRecordStatus } from './domain/types/order-record.types';
