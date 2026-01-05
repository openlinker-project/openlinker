/**
 * Sync Job Execution Error
 *
 * Domain exception for sync job execution failures. Used by handlers to indicate
 * that a job failed and should be retried (if attempts < maxAttempts) or marked
 * as dead (if attempts >= maxAttempts).
 *
 * @module libs/core/src/sync/domain/exceptions
 */
export class SyncJobExecutionError extends Error {
  constructor(
    message: string,
    public readonly jobId: string,
    public readonly jobType: string,
    public readonly connectionId: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'SyncJobExecutionError';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SyncJobExecutionError);
    }
  }
}

