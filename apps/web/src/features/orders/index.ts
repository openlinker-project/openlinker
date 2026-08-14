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
export type {
  OrderRecord,
  OrderFilters,
  OrderPagination,
  PaginatedOrders,
} from './api/orders.types';
export { ConnectionDot } from './components/connection-dot';
export { OrderIdentityCell } from './components/order-identity-cell';
export type { OrderIdentityCellProps } from './components/order-identity-cell';
