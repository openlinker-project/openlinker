/**
 * Connection Infra Health Service Interface
 *
 * Defines the contract for rolling up health of infrastructure-bearing
 * connections (connections that back a real shop/warehouse system, e.g.
 * WooCommerce) into the dashboard's Infrastructure panel (#1619).
 *
 * @module apps/api/src/health
 * @see {@link ConnectionInfraHealthService} for the implementation
 */
import type { ConnectionHealthEntry } from './dev-stack-health.types';

export interface IConnectionInfraHealthService {
  /**
   * Discover active connections whose adapter capabilities mark them as
   * infrastructure-bearing (`ProductMaster` and/or `InventoryMaster`), probe
   * each via its registered `ConnectionTesterPort`, and return one health
   * entry per connection.
   */
  checkInfraConnections(): Promise<ConnectionHealthEntry[]>;
}
