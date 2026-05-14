/**
 * Redis Streams Job Enqueue Service
 *
 * Implements JobEnqueuePort using Redis Streams. Publishes job requests to
 * Redis Streams using the XADD command, with idempotency enforcement using
 * Redis SET NX to prevent duplicate job requests.
 *
 * @module libs/core/src/sync/infrastructure/adapters
 * @implements {JobEnqueuePort}
 * @see {@link JobEnqueuePort} for the port interface
 */
import { Injectable, Inject } from '@nestjs/common';
import { RedisClientType } from 'redis';
import type { JobEnqueuePort } from '../../domain/ports/job-enqueue.port';
import type { EnqueueJobResult, SyncJobRequest } from '../../domain/types/sync-job.types';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class RedisStreamsJobEnqueueService implements JobEnqueuePort {
  private readonly logger = new Logger(RedisStreamsJobEnqueueService.name);
  private readonly STREAM_NAME = 'jobs.sync';
  private readonly IDEMPOTENCY_KEY_PREFIX = 'jobdedup:';
  private readonly IDEMPOTENCY_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType
  ) {}

  async enqueueJob(job: SyncJobRequest): Promise<EnqueueJobResult> {
    const idempotencyKey = `${this.IDEMPOTENCY_KEY_PREFIX}${job.idempotencyKey}`;

    try {
      // Check idempotency: SET NX to see if job already exists
      const idempotencyResult = await this.redisClient.set(idempotencyKey, 'enqueued', {
        NX: true,
        EX: this.IDEMPOTENCY_TTL,
      });

      if (idempotencyResult !== 'OK') {
        this.logger.debug(
          `Job already enqueued (idempotent): ${job.jobType} for ${job.connectionId}`
        );
        return { jobId: job.idempotencyKey, isExisting: true };
      }

      // Build field map for XADD command
      // All values must be strings for Redis Streams
      const fields: Record<string, string> = {
        jobType: job.jobType,
        connectionId: job.connectionId,
        payloadJson: JSON.stringify(job.payload),
        idempotencyKey: job.idempotencyKey,
        createdAt: new Date().toISOString(),
      };

      // Publish to Redis Stream using XADD
      let messageId: string | null;
      try {
        messageId = await this.redisClient.xAdd(this.STREAM_NAME, '*', fields);
      } catch (xaddError) {
        // Clean up idempotency key if XADD fails
        await this.redisClient.del(idempotencyKey).catch(() => {
          // Ignore cleanup errors
        });
        throw new Error(`Failed to enqueue job to stream: ${this.STREAM_NAME}`);
      }

      if (!messageId) {
        // Clean up idempotency key if publish failed (returned null)
        await this.redisClient.del(idempotencyKey);
        throw new Error(`Failed to enqueue job to stream: ${this.STREAM_NAME}`);
      }

      // Update idempotency key with job ID for future lookups
      await this.redisClient.set(idempotencyKey, messageId, {
        XX: true, // Only update if exists (should exist from SET NX above)
        EX: this.IDEMPOTENCY_TTL,
      });

      this.logger.debug(
        `Enqueued job ${job.jobType} for ${job.connectionId} with message ID ${messageId}`
      );

      return { jobId: messageId, isExisting: false };
    } catch (error) {
      this.logger.error(
        `Failed to enqueue job ${job.jobType} for ${job.connectionId}`,
        error instanceof Error ? error.stack : String(error)
      );

      // If error is already our custom error (from messageId check), re-throw as-is
      if (
        error instanceof Error &&
        error.message.includes(`Failed to enqueue job to stream: ${this.STREAM_NAME}`)
      ) {
        throw error;
      }

      // Convert Redis errors to domain exceptions
      if (error instanceof Error) {
        throw new Error(`Job enqueue failed: ${error.message}`);
      }

      throw new Error('Job enqueue failed: Unknown error');
    }
  }
}
