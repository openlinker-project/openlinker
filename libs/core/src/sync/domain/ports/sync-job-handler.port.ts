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
import type { SyncJob } from '../entities/sync-job.entity';
import type { SyncJobDeadFailure, SyncJobHandlerResult } from '../types/sync-job.types';

/**
 * Sync Job Handler Port
 *
 * Interface for sync job execution. Implementations handle specific job types
 * and perform the actual synchronization work (pulling from adapters, persisting
 * to canonical storage).
 */
export interface SyncJobHandler {
  /**
   * Execute a sync job.
   *
   * Resolves with a `SyncJobHandlerResult` whose `outcome` describes the
   * business result; the runner persists it via `markSucceeded(id, outcome)`.
   * Throws domain exceptions (e.g. `SyncJobExecutionError`) for errors that
   * should trigger retries. The runner classifies a small set of exception
   * classes as non-retryable (markDead).
   *
   * @param job - The sync job to execute
   * @returns SyncJobHandlerResult with the business outcome of the run
   * @throws SyncJobExecutionError if job execution fails (will trigger retry)
   * @throws Error for unexpected errors (will also trigger retry)
   */
  execute(job: SyncJob): Promise<SyncJobHandlerResult>;

  /**
   * Optional hook the runner calls AFTER it has marked the job `dead`
   * (#3505, G01-2) — on a non-retryable error or once attempts run out, never
   * on a retry or a deferral.
   *
   * For a handler that owns a record outside `sync_jobs` which would
   * otherwise stay "in progress" for ever once nothing will run the job again
   * (an `OfferCreationRecord` left `pending`). Best-effort: the job is already
   * dead and stays dead whatever this does; the runner logs and swallows a
   * throw, so an implementation should not rely on throwing to signal
   * anything.
   */
  onDead?(job: SyncJob, failure: SyncJobDeadFailure): Promise<void>;
}
