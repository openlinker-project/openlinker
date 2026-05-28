/**
 * Orders — public surface
 *
 * Public barrel for the orders feature. Cross-feature / cross-plugin consumers
 * import only from here. Kept narrow — pages may still deep-import feature
 * internals (per `docs/frontend-architecture.md § Feature Public Surface`'s
 * "Out of scope today" note), so this is the seam other features and plugins
 * bind against.
 *
 * Today's only cross-feature consumer is `use-notify-dispatched-mutation`
 * (#769), which needs `ordersQueryKeys.all` to invalidate the orders domain on
 * dispatch-notify success.
 */
export { ordersQueryKeys } from './api/orders.query-keys';
export type {
  OrderRecord,
  OrderFilters,
  OrderPagination,
  PaginatedOrders,
} from './api/orders.types';
