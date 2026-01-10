/**
 * Job Intake Consumer
 *
 * Consumes job requests from Redis Stream `jobs.sync` and persists them to the
 * database. Implements a long-polling consumer loop using Redis Streams consumer
 * groups with graceful shutdown support.
 *
 * @module apps/worker/src/sync
 */
import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisClientType } from 'redis';
import {
  SyncJobRepositoryPort,
  SYNC_JOB_REPOSITORY_TOKEN,
  SyncJobRequest,
  JobType,
  JobTypeValues,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class JobIntakeConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobIntakeConsumer.name);
  private readonly STREAM_NAME = 'jobs.sync';
  private readonly CONSUMER_GROUP = 'job-intake';
  private readonly CONSUMER_NAME = `job-intake-${process.pid}`;
  private readonly BLOCK_MS = 5000; // 5 seconds
  private readonly COUNT = 10; // Read up to 10 messages at a time

  private abortController: AbortController | null = null;
  private isRunning = false;
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType,
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly jobRepository: SyncJobRepositoryPort,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Check if intake is enabled (default: true, can be disabled for tests)
    const enabled = this.configService.get<string>('WORKER_INTAKE_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Job intake consumer disabled via WORKER_INTAKE_ENABLED=false');
      return;
    }

    await this.initializeConsumerGroup();
    this.startConsumptionLoop();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopConsumptionLoop();
  }

  /**
   * Initialize consumer group
   *
   * Creates the consumer group if it doesn't exist. Ignores BUSYGROUP error
   * if group already exists.
   */
  private async initializeConsumerGroup(): Promise<void> {
    try {
      // XGROUP CREATE stream group $ MKSTREAM
      // $ = start from new messages only
      // MKSTREAM = create stream if it doesn't exist
      await this.redisClient.xGroupCreate(
        this.STREAM_NAME,
        this.CONSUMER_GROUP,
        '$',
        {
          MKSTREAM: true,
        },
      );
      this.logger.log(`Created consumer group ${this.CONSUMER_GROUP} for stream ${this.STREAM_NAME}`);
    } catch (error) {
      // Ignore BUSYGROUP error (group already exists)
      if (error instanceof Error && error.message.includes('BUSYGROUP')) {
        this.logger.debug(`Consumer group ${this.CONSUMER_GROUP} already exists`);
      } else {
        this.logger.error(
          `Failed to create consumer group ${this.CONSUMER_GROUP}`,
          error instanceof Error ? error.stack : String(error),
        );
        throw error;
      }
    }
  }

  /**
   * Start consumption loop
   *
   * Starts a background loop that reads messages from the stream and processes them.
   * Uses AbortController for graceful shutdown.
   */
  private startConsumptionLoop(): void {
    this.abortController = new AbortController();
    this.isRunning = true;

    // Start consumption loop in background (don't await)
    this.consumeLoop().catch((error) => {
      this.logger.error('Consumption loop error', error instanceof Error ? error.stack : String(error));
      // Restart loop after backoff (track timer for cleanup)
      if (this.isRunning) {
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.startConsumptionLoop();
        }, 5000);
        // Don't keep process alive if only this timer is running
        if (this.restartTimer && typeof this.restartTimer.unref === 'function') {
          this.restartTimer.unref();
        }
      }
    });
  }

  /**
   * Stop consumption loop
   *
   * Gracefully stops the consumption loop by setting isRunning to false and
   * aborting the AbortController signal.
   */
  private async stopConsumptionLoop(): Promise<void> {
    this.logger.log('Stopping consumption loop...');
    this.isRunning = false;
    this.abortController?.abort();

    // Clear restart timer if pending
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    // Wait a bit for in-flight messages to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    this.logger.log('Consumption loop stopped');
  }

  /**
   * Main consumption loop
   *
   * Continuously reads messages from the stream using XREADGROUP and processes them.
   * Uses blocking read with timeout to avoid busy-waiting.
   */
  private async consumeLoop(): Promise<void> {
    while (this.isRunning && !this.abortController?.signal.aborted) {
      try {
        // XREADGROUP GROUP group consumer COUNT count BLOCK milliseconds STREAMS stream >
        // > = read pending messages for this consumer, then new messages
        const messages = await this.redisClient.xReadGroup(
          this.CONSUMER_GROUP,
          this.CONSUMER_NAME,
          [
            {
              key: this.STREAM_NAME,
              id: '>', // Read new messages
            },
          ],
          {
            COUNT: this.COUNT,
            BLOCK: this.BLOCK_MS,
          },
        );

        if (!messages || messages.length === 0) {
          // No messages, continue loop
          continue;
        }

        // Process each message
        for (const stream of messages) {
          for (const message of stream.messages) {
            await this.processMessage(message.id, message.message);
          }
        }
      } catch (error) {
        // Handle abort signal (graceful shutdown)
        if (this.abortController?.signal.aborted) {
          this.logger.log('Consumption loop aborted');
          break;
        }

        // Handle Redis connection errors with longer backoff
        if (error instanceof Error && error.message.includes('Connection')) {
          this.logger.error('Redis connection error, will retry after longer backoff...');
          // Wait longer before retry for connection errors
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        // Log error and continue (retry on next iteration)
        this.logger.error(
          'Error in consumption loop',
          error instanceof Error ? error.stack : String(error),
        );

        // Backoff before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Process a single message
   *
   * Parses the job request from stream fields, validates job type, and persists
   * to database. ACKs the message only after successful persist.
   * Unknown jobType results in a `dead` job with error message.
   */
  private async processMessage(messageId: string, fields: Record<string, string>): Promise<void> {
    try {
      // Parse job request from stream fields
      const jobRequest = this.parseJobRequest(fields);

      // Validate job type
      const isValidJobType = this.isValidJobType(jobRequest.jobType);
      if (!isValidJobType) {
        // Unknown job type - persist as dead job
        this.logger.warn(
          `Unknown job type: ${jobRequest.jobType}. Persisting as dead job.`,
        );
        await this.persistDeadJob(jobRequest, `Unknown job type: ${jobRequest.jobType}`);
        // ACK the message (we've handled it, even if it's invalid)
        await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
        return;
      }

      // Persist job to database (idempotent - repository handles duplicates)
      await this.jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: jobRequest.jobType, // Already validated as valid JobType
        connectionId: jobRequest.connectionId,
        payload: jobRequest.payload,
        idempotencyKey: jobRequest.idempotencyKey,
        maxAttempts: 10, // Default max attempts (TODO: make configurable)
      });

      // ACK message only after successful persist
      await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);

      this.logger.debug(
        `Processed job request ${jobRequest.jobType} for ${jobRequest.connectionId} and persisted to database`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process message ${messageId}`,
        error instanceof Error ? error.stack : String(error),
      );

      // Classify errors - some should be ACKed to prevent infinite retry
      if (error instanceof Error) {
        // Invalid payload or malformed message - ACK and log as dead to prevent infinite retry
        if (
          error.message.includes('Invalid JSON') ||
          error.message.includes('Missing required fields')
        ) {
          this.logger.warn(
            `Invalid message format, persisting as dead job to prevent infinite retry: ${messageId}`,
          );
          try {
            // Try to create a minimal dead job from available fields
            // Use a valid JobType as placeholder (repository requires valid JobType)
            const placeholderJobType: JobType = JobTypeValues[0]; // Use first valid job type as placeholder
            const deadJobRequest: SyncJobRequest = {
              jobType: (fields.jobType && this.isValidJobType(fields.jobType))
                ? (fields.jobType)
                : placeholderJobType,
              connectionId: fields.connectionId || 'unknown',
              payload: { rawFields: fields, _parseError: error.message },
              idempotencyKey: fields.idempotencyKey || `invalid-${messageId}`,
            };
            await this.persistDeadJob(
              deadJobRequest,
              `Invalid message format: ${error instanceof Error ? error.message : String(error)}`,
            );
          } catch (parseError) {
            this.logger.error(
              `Failed to persist invalid message as dead job: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            );
          }
          // ACK to prevent infinite retry
          await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
          return;
        }
      }

      // Don't ACK - message will be re-delivered after timeout
      // In production, you might want to implement retry limits and dead-letter queue
      throw error;
    }
  }

  /**
   * Parse job request from stream fields
   *
   * Extracts jobType, connectionId, payloadJson, and idempotencyKey from stream fields.
   */
  private parseJobRequest(fields: Record<string, string>): SyncJobRequest {
    const jobType = fields.jobType;
    const connectionId = fields.connectionId;
    const payloadJson = fields.payloadJson;
    const idempotencyKey = fields.idempotencyKey;

    if (!jobType || !connectionId || !payloadJson || !idempotencyKey) {
      throw new Error(
        `Missing required fields in job request. Required: jobType, connectionId, payloadJson, idempotencyKey. Got: ${JSON.stringify(fields)}`,
      );
    }

    let payload: Record<string, unknown>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      payload = JSON.parse(payloadJson) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Invalid JSON in payloadJson: ${payloadJson}`);
    }

    return {
      jobType: jobType as JobType, // Will be validated by isValidJobType
      connectionId,
      payload,
      idempotencyKey,
    };
  }

  /**
   * Validate job type
   *
   * Checks if the job type string is a valid JobType value.
   */
  private isValidJobType(value: string): value is JobType {
    return (JobTypeValues as readonly string[]).includes(value);
  }

  /**
   * Persist dead job for unknown job type
   *
   * Creates a job with status 'dead' and error message for unknown job types.
   * Uses a placeholder valid job type since the repository requires a valid JobType.
   */
  private async persistDeadJob(
    jobRequest: SyncJobRequest,
    errorMessage: string,
  ): Promise<void> {
    // Use a valid job type as placeholder (repository requires valid JobType)
    // Store the original invalid job type in the payload for debugging
    const placeholderJobType = JobTypeValues[0]; // Use first valid job type as placeholder

    const deadJob = await this.jobRepository.createIfNotExistsByIdempotencyKey({
      jobType: placeholderJobType,
      connectionId: jobRequest.connectionId,
      payload: {
        ...jobRequest.payload,
        _originalJobType: jobRequest.jobType, // Preserve original for debugging
        _invalidJobType: true, // Flag to indicate this was an invalid job type
      },
      idempotencyKey: jobRequest.idempotencyKey,
      maxAttempts: 10,
    });

    // Mark as dead immediately
    await this.jobRepository.markDead(deadJob.id, errorMessage);
  }
}

