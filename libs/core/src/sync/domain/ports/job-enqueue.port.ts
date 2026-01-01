/**
 * Job Enqueue Port
 *
 * Defines the contract for enqueuing sync job requests. Implemented by
 * infrastructure adapters (e.g., Redis Streams) to provide job enqueue
 * capabilities. This port abstracts the job queue implementation, allowing
 * the core domain to enqueue jobs without depending on specific infrastructure.
 *
 * @module libs/core/src/sync/domain/ports
 * @see {@link RedisStreamsJobEnqueueService} for the Redis Streams implementation
 */
import { SyncJob } from '../types/sync-job.types';

/**
 * Job Enqueue Port
 *
 * Interface for enqueuing sync job requests. Implementations handle
 * the specifics of the underlying job queue technology (Redis Streams, etc.)
 * and enforce idempotency to prevent duplicate job requests.
 */
export interface JobEnqueuePort {
  /**
   * Enqueue a sync job request
   *
   * Publishes a job request to the job queue. The implementation should
   * enforce idempotency using the job's idempotencyKey to prevent duplicate
   * job requests under handler retries, parallel consumers, and pending re-deliveries.
   *
   * @param job - The sync job to enqueue
   * @returns Promise resolving to the job ID assigned by the queue
   * @throws Error if enqueueing fails
   */
  enqueueJob(job: SyncJob): Promise<string>;
}

