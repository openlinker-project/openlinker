/**
 * Connection Sync Status Service Interface
 *
 * Contract for the per-connection sync-status read (#2615): queue depth,
 * whether that queue is converging, the derived backlog alert, and when the
 * connection's sync state last moved. Implemented by
 * ConnectionSyncStatusService.
 *
 * @module libs/core/src/sync/application/services
 * @see {@link ConnectionSyncStatusService} for the implementation
 */
import type { ConnectionSyncStatus } from '../../domain/types/connection-sync-status.types';

export interface IConnectionSyncStatusService {
  /**
   * Read one connection's sync status.
   *
   * Touches no adapter and makes no outbound call, so it answers for a
   * connection whose shop is unreachable - which is exactly when an operator
   * needs it. Never throws for a connection with no jobs: an unknown or empty
   * connection reads `'idle'` with zero counts.
   */
  getConnectionSyncStatus(connectionId: string): Promise<ConnectionSyncStatus>;
}
