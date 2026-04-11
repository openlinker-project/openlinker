/**
 * Sync Job Not Found Error
 *
 * Domain exception thrown when a sync job cannot be found by its ID.
 *
 * @module libs/core/src/sync/domain/exceptions
 */
export class SyncJobNotFoundError extends Error {
  constructor(public readonly jobId: string) {
    super(`Sync job not found: ${jobId}`);
    this.name = 'SyncJobNotFoundError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SyncJobNotFoundError);
    }
  }
}
