/**
 * Invalid Sync Job State Error
 *
 * Domain exception thrown when a sync job record in the database contains a
 * value that does not match the known JobType or JobStatus sets. This indicates
 * a data-integrity issue (e.g. a stale record from a schema migration or a
 * manual database edit).
 *
 * @module libs/core/src/sync/domain/exceptions
 */
export class InvalidSyncJobStateError extends Error {
  constructor(
    public readonly field: 'jobType' | 'status',
    public readonly value: string,
    public readonly jobId?: string,
  ) {
    super(
      `Invalid sync job ${field} "${value}"${jobId ? ` for job ${jobId}` : ''}`,
    );
    this.name = 'InvalidSyncJobStateError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvalidSyncJobStateError);
    }
  }
}
