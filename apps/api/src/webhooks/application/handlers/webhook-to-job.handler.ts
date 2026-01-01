/**
 * Webhook-to-Job Handler
 *
 * Consumes inbound webhook events from Redis Streams and enqueues sync jobs.
 * Implements a long-polling consumer loop using Redis Streams consumer groups
 * with graceful shutdown support. Runs in the API process for MVP; can be
 * extracted to worker app later.
 *
 * @module apps/api/src/webhooks/application/handlers
 */
import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { RedisClientType } from 'redis';
import { JobEnqueuePort } from '@openlinker/core/sync';
import { JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import { EventEnvelope } from '@openlinker/core/events/domain/types/event.types';
import { InboundWebhookEvent } from '@openlinker/core/events/domain/types/inbound-webhook-event.types';
import { SyncJob, JobType, JobTypeValues } from '@openlinker/core/sync/domain/types/sync-job.types';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class WebhookToJobHandler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookToJobHandler.name);
  private readonly STREAM_NAME = 'events.inbound.webhooks';
  private readonly CONSUMER_GROUP = 'webhook-handler';
  private readonly CONSUMER_NAME = `webhook-handler-${process.pid}`;
  private readonly BLOCK_MS = 5000; // 5 seconds
  private readonly COUNT = 10; // Read up to 10 messages at a time

  private abortController: AbortController | null = null;
  private isRunning = false;

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
  ) {}

  async onModuleInit(): Promise<void> {
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
      // Restart loop after backoff
      if (this.isRunning) {
        setTimeout(() => this.startConsumptionLoop(), 5000);
      }
    });
  }

  /**
   * Stop consumption loop
   *
   * Signals the consumption loop to stop and waits for it to finish.
   */
  private async stopConsumptionLoop(): Promise<void> {
    this.logger.log('Stopping webhook-to-job handler...');
    this.isRunning = false;

    if (this.abortController) {
      this.abortController.abort();
    }

    // Wait a bit for in-flight messages to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    this.logger.log('Webhook-to-job handler stopped');
  }

  /**
   * Consumption loop
   *
   * Main loop that reads messages from Redis Streams and processes them.
   * Uses XREADGROUP to read messages from the consumer group.
   */
  private async consumeLoop(): Promise<void> {
    while (this.isRunning && !this.abortController?.signal.aborted) {
      try {
        // XREADGROUP GROUP group consumer BLOCK ms COUNT n STREAMS stream >
        // > = read new messages only (not pending)
        const messages = await this.redisClient.xReadGroup(
          this.CONSUMER_GROUP,
          this.CONSUMER_NAME,
          [
            {
              key: this.STREAM_NAME,
              id: '>', // Read new messages only
            },
          ],
          {
            BLOCK: this.BLOCK_MS,
            COUNT: this.COUNT,
          },
        );

        if (!messages || messages.length === 0) {
          // No messages, continue loop
          continue;
        }

        // Process messages
        for (const streamMessage of messages) {
          if (streamMessage.name !== this.STREAM_NAME) {
            continue;
          }

          for (const message of streamMessage.messages) {
            await this.processMessage(message.id, message.message);
          }
        }
      } catch (error) {
        if (this.abortController?.signal.aborted) {
          // Shutdown requested, exit loop
          break;
        }

        // Log error and continue with backoff
        this.logger.error(
          'Error reading from stream',
          error instanceof Error ? error.stack : String(error),
        );

        // Backoff before retry
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Process a single message
   *
   * Parses the event envelope, maps it to a sync job, and enqueues the job.
   * ACKs the message only after successful job enqueue.
   */
  private async processMessage(messageId: string, fields: Record<string, string>): Promise<void> {
    try {
      // Parse event envelope from stream fields
      const envelope = this.parseEventEnvelope(fields);

      // Map to inbound webhook event
      const event = this.mapToInboundWebhookEvent(envelope);

      // Map to sync job
      const job = this.mapToSyncJob(event);

      // Enqueue job (idempotency enforced at JobEnqueuePort level)
      await this.jobEnqueue.enqueueJob(job);

      // ACK message only after successful enqueue
      await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);

      this.logger.debug(
        `Processed webhook event ${event.eventId} and enqueued job ${job.jobType}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process message ${messageId}`,
        error instanceof Error ? error.stack : String(error),
      );
      // Don't ACK - message will be re-delivered after timeout
      // In production, you might want to implement retry limits and dead-letter queue
      throw error;
    }
  }

  /**
   * Parse event envelope from stream fields
   */
  private parseEventEnvelope(fields: Record<string, string>): EventEnvelope {
    return {
      eventId: fields.eventId,
      eventType: fields.eventType,
      payloadJson: fields.payloadJson,
      metadataJson: fields.metadataJson,
      occurredAt: fields.occurredAt,
      publishedAt: fields.publishedAt,
    };
  }

  /**
   * Map event envelope to inbound webhook event
   */
  private mapToInboundWebhookEvent(envelope: EventEnvelope): InboundWebhookEvent {
    interface WebhookPayload {
      objectType?: string;
      externalId?: string;
      payload?: Record<string, unknown>;
      [key: string]: unknown;
    }

    interface WebhookMetadata {
      provider?: string;
      connectionId?: string;
      [key: string]: unknown;
    }

    const payload = JSON.parse(envelope.payloadJson) as WebhookPayload;
    const metadata = (envelope.metadataJson ? JSON.parse(envelope.metadataJson) : {}) as WebhookMetadata;

    // Extract event type (remove 'inbound.webhook.' prefix)
    const eventType = envelope.eventType.replace(/^inbound\.webhook\./, '');

    // Extract objectType and externalId from payload
    // These are stored in the InboundWebhookEvent when published
    const objectType = payload.objectType || '';
    const externalId = payload.externalId || '';

    return {
      eventId: envelope.eventId,
      provider: metadata.provider || 'unknown',
      connectionId: metadata.connectionId || '',
      eventType,
      occurredAt: envelope.occurredAt,
      receivedAt: envelope.publishedAt,
      objectType,
      externalId,
      payload: payload.payload || payload, // payload.payload if nested, otherwise payload itself
    };
  }

  /**
   * Map inbound webhook event to sync job
   *
   * Maps webhook events to sync job requests based on event type and provider.
   */
  private mapToSyncJob(event: InboundWebhookEvent): SyncJob {
    // Build job type: {provider}.{objectType}.syncByExternalId
    const jobTypeString = `${event.provider}.${event.objectType}.syncByExternalId`;

    // Validate that the constructed job type is a valid JobType
    // Type assertion is safe here because we validate against JobTypeValues
    const jobType = this.validateJobType(jobTypeString);

    // Build idempotency key: {provider}:{connectionId}:{eventId}
    const idempotencyKey = `${event.provider}:${event.connectionId}:${event.eventId}`;

    return {
      jobType,
      connectionId: event.connectionId,
      payload: {
        externalId: event.externalId,
        objectType: event.objectType,
        eventType: event.eventType,
      },
      idempotencyKey,
    };
  }

  /**
   * Validate and return a JobType
   *
   * Ensures the job type string is a valid JobType value.
   * Throws an error if the job type is not recognized.
   */
  private validateJobType(jobTypeString: string): JobType {
    // Type guard: check if jobTypeString is in the JobTypeValues array
    const isValidJobType = (value: string): value is JobType => {
      return (JobTypeValues as readonly string[]).includes(value);
    };

    if (isValidJobType(jobTypeString)) {
      return jobTypeString;
    }

    const errorMessage = `Invalid job type: ${jobTypeString}. Valid types: ${JobTypeValues.join(', ')}`;
    this.logger.error(errorMessage);
    throw new Error(errorMessage);
  }
}

