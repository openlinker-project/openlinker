/**
 * Sync Job Handler Port
 *
 * Defines the contract for sync job execution. Handlers implement this port
 * to process specific job types. Each handler is responsible for:
 * - Validating job payload
 * - Resolving adapters via IntegrationsService
 * - Performing IdentifierMapping (external → internal IDs)
 * - Calling application services to persist canonical data
 * - Error handling and domain exception conversion
 *
 * @module libs/core/src/sync/domain/ports
 * @see {@link PrestashopProductSyncHandler} for an example implementation
 */
import { SyncJob } from '../entities/sync-job.entity';

/**
 * Sync Job Handler Port
 *
 * Interface for sync job execution. Implementations handle specific job types
 * and perform the actual synchronization work (pulling from adapters, persisting
 * to canonical storage).
 */
export interface SyncJobHandler {
  /**
   * Execute a sync job
   *
   * Processes the job by pulling data from adapters and persisting to canonical storage.
   * Throws domain exceptions (e.g., SyncJobExecutionError) for errors that should
   * trigger retries. The runner will handle retry logic and backoff.
   *
   * @param job - The sync job to execute
   * @throws SyncJobExecutionError if job execution fails (will trigger retry)
   * @throws Error for unexpected errors (will also trigger retry)
   */
  execute(job: SyncJob): Promise<void>;
}

