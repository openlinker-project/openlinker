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
import { EventEnvelope, InboundWebhookEvent } from '@openlinker/core/events';
import { SyncJobRequest, JobType, JobTypeValues } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class WebhookToJobHandler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookToJobHandler.name);
  private readonly STREAM_NAME = 'events.inbound.webhooks';
  private readonly DLQ_STREAM_NAME = 'events.inbound.webhooks.dead';
  private readonly CONSUMER_GROUP = 'webhook-handler';
  private readonly CONSUMER_NAME = `webhook-handler-${process.pid}`;
  private readonly BLOCK_MS = 5000; // 5 seconds
  private readonly COUNT = 10; // Read up to 10 messages at a time

  private abortController: AbortController | null = null;
  private isRunning = false;

  constructor(
    @Inject('REDIS_CLIENT_BLOCKING')
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
    await this.redisClient.quit();
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
   * Test events (eventType starting with 'test.') are skipped (no job created).
   * Invalid/unmappable events are ACKed and sent to dead-letter queue.
   */
  private async processMessage(messageId: string, fields: Record<string, string>): Promise<void> {
    try {
      // Parse event envelope from stream fields
      const envelope = this.parseEventEnvelope(fields);

      // Map to inbound webhook event
      const event = this.mapToInboundWebhookEvent(envelope);

      // Skip test events (they're just for verification, no job needed)
      if (event.eventType.startsWith('test.')) {
        this.logger.debug(
          `Skipping test event ${event.eventId} (eventType: ${event.eventType}) - no job created`,
        );
        // ACK test events immediately (they've served their purpose)
        await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
        return;
      }

      // Map to sync job (may throw if unmappable)
      let job: SyncJobRequest;
      try {
        job = this.mapToSyncJob(event);
      } catch (mappingError) {
        // Mapping failed (invalid job type, unmappable objectType, etc.)
        // ACK the webhook message and send to DLQ to prevent infinite retries
        const errorMessage = mappingError instanceof Error ? mappingError.message : String(mappingError);
        this.logger.warn(
          `Failed to map webhook event to job: eventId=${event.eventId}, provider=${event.provider}, objectType=${event.objectType}, error=${errorMessage}`,
        );
        await this.sendToDeadLetterQueue(event, errorMessage, fields);
        await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
        return;
      }

      // Enqueue job (idempotency enforced at JobEnqueuePort level)
      await this.jobEnqueue.enqueueJob(job);

      // ACK message only after successful enqueue
      await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);

      this.logger.debug(
        `Processed webhook event ${event.eventId} and enqueued job ${job.jobType}`,
      );
    } catch (error) {
      // Unexpected error (network, Redis, etc.) - don't ACK, allow retry
      this.logger.error(
        `Failed to process message ${messageId}`,
        error instanceof Error ? error.stack : String(error),
      );
      // Don't ACK - message will be re-delivered after timeout
      // This is for transient errors (network, Redis connection, etc.)
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
   * Acts as a translation layer: provider-specific terminology → canonical job types.
   * Normalizes objectType to PascalCase to match EntityType enum values.
   *
   * @throws Error if job type cannot be constructed or validated
   */
  private mapToSyncJob(event: InboundWebhookEvent): SyncJobRequest {
    // Map provider-specific objectType to canonical objectType for job type construction
    // Example: PrestaShop uses "stock" but OpenLinker uses "inventory" in job types
    const canonicalObjectType = this.mapObjectType(event.provider, event.objectType);

    // Normalize canonical objectType to PascalCase for payload
    // This ensures payload uses canonical terminology (e.g., "inventory" -> "Inventory")
    // rather than provider-specific terminology (e.g., "stock" -> "Stock")
    const normalizedCanonicalObjectType = this.normalizeObjectType(canonicalObjectType);

    // Build job type: master.{canonicalObjectType}.syncByExternalId for master systems (e.g., PrestaShop)
    // (Option B: job taxonomy is integration-agnostic.)
    const normalizedProvider = event.provider.toLowerCase();
    const isMasterProvider = normalizedProvider === 'prestashop';

    if (isMasterProvider) {
      const supported = ['product', 'inventory'];
      if (!supported.includes(canonicalObjectType.toLowerCase())) {
        throw new Error(
          `Unsupported master objectType: ${canonicalObjectType}. Supported: ${supported.join(', ')}`,
        );
      }
    }

    const jobTypeString = isMasterProvider
      ? `master.${canonicalObjectType.toLowerCase()}.syncByExternalId`
      : `${normalizedProvider}.${canonicalObjectType.toLowerCase()}.syncByExternalId`;

    // Validate that the constructed job type is a valid JobType
    // Type assertion is safe here because we validate against JobTypeValues
    const jobType = this.validateJobType(jobTypeString);

    // Build idempotency key: {provider}:{connectionId}:{eventId}
    const idempotencyKey = `${event.provider}:${event.connectionId}:${event.eventId}`;

    return {
      jobType,
      connectionId: event.connectionId,
      payload: {
        schemaVersion: 1,
        externalId: event.externalId,
        objectType: normalizedCanonicalObjectType, // Use normalized canonical objectType (PascalCase) in payload
        eventType: event.eventType,
      },
      idempotencyKey,
    };
  }

  /**
   * Map provider-specific objectType to canonical objectType
   *
   * Acts as a translation layer between provider terminology and OpenLinker's canonical terminology.
   * This allows providers to use their own terminology (e.g., PrestaShop uses "stock") while
   * OpenLinker uses canonical terms in job types (e.g., "inventory").
   *
   * Structure is designed to be extensible: can be extracted to provider-specific mappers later.
   *
   * @param provider - Provider identifier (e.g., 'prestashop', 'shopify')
   * @param objectType - Provider-specific object type (e.g., 'stock', 'product')
   * @returns Canonical object type for job type construction (e.g., 'inventory', 'product')
   */
  private mapObjectType(provider: string, objectType: string): string {
    const p = provider.toLowerCase();
    const o = objectType.toLowerCase();

    // Provider-specific objectType mappings
    // Structure: { provider: { providerObjectType: canonicalObjectType } }
    const mapping: Record<string, Record<string, string>> = {
      prestashop: {
        stock: 'inventory', // PrestaShop uses "stock", OpenLinker uses "inventory"
        // product: 'product', // No mapping needed (pass-through)
        // order: 'order', // No mapping needed (pass-through)
      },
      // Future providers can be added here:
      // shopify: {
      //   inventory_level: 'inventory',
      //   product: 'product',
      // },
    };

    // Return mapped value if exists, otherwise pass through unchanged
    return mapping[p]?.[o] ?? o;
  }

  /**
   * Normalize objectType to PascalCase
   *
   * Converts lowercase/snake_case object types to PascalCase to match EntityType enum.
   * Examples:
   * - "product" -> "Product"
   * - "product_variant" -> "ProductVariant"
   * - "Product" -> "Product" (already normalized)
   * - "PRODUCT" -> "Product"
   *
   * @param objectType - Raw object type from webhook (any case)
   * @returns Normalized object type in PascalCase
   */
  private normalizeObjectType(objectType: string): string {
    if (!objectType) {
      return objectType;
    }

    // Convert to lowercase first, then split by underscore
    const parts = objectType.toLowerCase().split('_');

    // Capitalize first letter of each part and join
    return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  }

  /**
   * Validate and return a JobType
   *
   * Ensures the job type string is a valid JobType value.
   * Throws an error if the job type is not recognized.
   *
   * @throws Error if job type is not in JobTypeValues
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

  /**
   * Send unmappable webhook event to dead-letter queue
   *
   * Publishes the event to a DLQ stream for observability and manual processing.
   * Includes original event data, error reason, and metadata for debugging.
   *
   * @param event - The inbound webhook event that failed mapping
   * @param errorReason - The error message explaining why mapping failed
   * @param originalFields - Original stream fields for full context
   */
  private async sendToDeadLetterQueue(
    event: InboundWebhookEvent,
    errorReason: string,
    originalFields: Record<string, string>,
  ): Promise<void> {
    try {
      const dlqPayload = {
        provider: event.provider,
        connectionId: event.connectionId,
        eventId: event.eventId,
        eventType: event.eventType,
        objectType: event.objectType, // Original provider objectType
        externalId: event.externalId,
        occurredAt: event.occurredAt,
        receivedAt: event.receivedAt,
        errorReason,
        originalPayload: event.payload,
        originalFields, // Full stream fields for debugging
      };

      await this.redisClient.xAdd(this.DLQ_STREAM_NAME, '*', {
        provider: event.provider,
        connectionId: event.connectionId,
        eventId: event.eventId,
        eventType: event.eventType,
        objectType: event.objectType,
        externalId: event.externalId,
        errorReason,
        payloadJson: JSON.stringify(dlqPayload),
        occurredAt: event.occurredAt,
        receivedAt: event.receivedAt,
      });

      this.logger.warn(
        `Sent unmappable webhook event to DLQ: eventId=${event.eventId}, provider=${event.provider}, objectType=${event.objectType}, reason=${errorReason}`,
      );
    } catch (dlqError) {
      // Non-fatal: log but don't fail the ACK
      this.logger.error(
        `Failed to send event to DLQ (non-fatal): eventId=${event.eventId}`,
        dlqError instanceof Error ? dlqError.stack : String(dlqError),
      );
    }
  }
}

