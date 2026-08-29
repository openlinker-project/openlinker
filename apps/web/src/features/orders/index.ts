/**
 * Orders — public surface
 *
 * Public barrel for the orders feature. Cross-feature / cross-plugin consumers
 * import only from here. Kept narrow — pages may still deep-import feature
 * internals (per `docs/frontend-architecture.md § Feature Public Surface`'s
 * "Out of scope today" note), so this is the seam other features and plugins
 * bind against.
 *
 * Cross-feature consumers today: `use-notify-dispatched-mutation` (#769),
 * which needs `ordersQueryKeys.all` to invalidate the orders domain on
 * dispatch-notify success; and the `shipments` feature's `/shipments` page
 * (#1826), which needs `ConnectionDot` for its Provider column. The
 * per-status shipment-action-eligibility `Set`s live on the `shipments`
 * barrel instead (they're keyed on `ShipmentStatus`, which `shipments` owns)
 * — both this feature's `ShipmentActionButtons` and the `/shipments`
 * accordion import them from there, so neither barrel depends on the other
 * for that policy.
 *
 * `OrderIdentityCell` (#2087) is exported for the same reason `ConnectionDot`
 * is: the Shipments and Invoices lists render an order's identity and orders is
 * the feature that owns what an order identity looks like (#1996).
 */
export { ordersQueryKeys } from './api/orders.query-keys';
// Exported for the #2366 automation dry-run order picker, which needs a
// "last 30 days" list. The hook and its filter type are the whole surface it
// consumes; `features/automation` imports them from this barrel like any other
// cross-feature consumer.
export { useOrdersQuery } from './hooks/use-orders-query';
// #2254 — the invoice panel needs the parsed lines to decide WHICH remedy a
// missing rate calls for; the reason alone cannot say.
export { parseOrderSnapshot } from './api/order-snapshot.schema';
export type { ParsedOrderItem } from './api/order-snapshot.schema';
export type {
  OrderRecord,
  OrderFilters,
  OrderPagination,
  PaginatedOrders,
} from './api/orders.types';
// #2441 review S9 — `OrderRecord.lifecyclePhase` is part of the shape the
// `invoicing` and `shipments` features type-import from this barrel, so the
// union naming its values belongs here too. Structural typing kept them
// compiling without it, but no cross-feature consumer could NAME the type.
// From the types-only module, never the label/tone lib (see S10).
export type { OrderLifecyclePhaseValue } from './lib/order-lifecycle-phase.types';
// #2350 — the SINGLE source for the shortfall sentence. AC1 requires the row
// badge and `W2-19`'s attention-table title to be byte-identical, so #2356
// imports these builders rather than restating the string; a second copy cannot
// exist without deleting this import. `W2-20` (#2357) should ABSORB
// `stock-at-risk-copy.ts` when it lands, not grow its own copy.
export {
  stockAtRiskTitle,
  stockAtRiskBadge,
  stockAtRiskCallout,
  shortfallItemLabel,
  STOCK_AT_RISK_BODY,
} from './lib/stock-at-risk-copy';
export { StockAtRiskBadge } from './components/stock-at-risk-badge';
export { StockAtRiskCallout } from './components/stock-at-risk-callout';
export type { OrderReservationShortfall } from './api/orders.types';
export { ConnectionDot } from './components/connection-dot';
export { OrderIdentityCell, formatOrderRef } from './components/order-identity-cell';
export type { OrderIdentityCellProps } from './components/order-identity-cell';
