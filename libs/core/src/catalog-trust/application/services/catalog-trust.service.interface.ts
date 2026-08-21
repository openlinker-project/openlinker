/**
 * Catalog Trust Service Interface
 *
 * Cross-context contract for the per-connection catalog-trust read (#2258).
 *
 * @module application/services
 * @see {@link CatalogTrustService} for the implementation
 */
import type { ConnectionCatalogTrust } from '../../domain/types/catalog-replication-trust.types';

export interface ICatalogTrustService {
  /**
   * Build the catalog-trust facts for one connection.
   *
   * Returns `null` when the connection does not exist or does not have the
   * `ProductMaster` capability enabled — "not applicable", which the HTTP
   * layer maps to 404. Adapter-resolution failure does NOT return null: it
   * degrades the `rung` to `'unknown'` so a broken master is reported on,
   * never silently dropped.
   *
   * Serve this from the API process only: `deltaPassEnabled` reads the
   * scheduler-task registry, which is populated only where SchedulerService
   * runs (see `ISyncJobsService.findEnabledTaskByJobType`).
   */
  getConnectionCatalogTrust(connectionId: string): Promise<ConnectionCatalogTrust | null>;
}
