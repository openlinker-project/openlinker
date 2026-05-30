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
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Inject } from '@nestjs/common';
import { RedisClientType } from 'redis';
import type { EventEnvelope, InboundWebhookEvent } from '@openlinker/core/events';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN,
  WebhookEventTranslatorRegistryService,
 IIntegrationsService} from '@openlinker/core/integrations';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import { INBOUND_ROUTING_POLICY_TOKEN } from '@openlinker/core/sync';
import { IInboundRoutingPolicyService } from '@openlinker/core/sync';
import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  ConnectionNotFoundException,
  ConnectionDisabledException,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import type { WebhookDeliveryUpsertInput } from '@openlinker/core/webhooks';
import {
  WebhookDeliveryRepositoryPort,
  WEBHOOK_DELIVERY_REPOSITORY_TOKEN,
} from '@openlinker/core/webhooks';
import { REDIS_CLIENT_BLOCKING_TOKEN } from '../../webhooks.tokens';
import type { WebhookPayload, WebhookMetadata } from './webhook-handler.types';

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
    @Inject(REDIS_CLIENT_BLOCKING_TOKEN)
    private readonly redisClient: RedisClientType,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN)
    private readonly translatorRegistry: WebhookEventTranslatorRegistryService,
    @Inject(INBOUND_ROUTING_POLICY_TOKEN)
    private readonly routingPolicy: IInboundRoutingPolicyService,
    @Inject(WEBHOOK_DELIVERY_REPOSITORY_TOKEN)
    private readonly deliveryRepository: WebhookDeliveryRepositoryPort
  ) {}

  private async recordDelivery(input: WebhookDeliveryUpsertInput): Promise<void> {
    try {
      await this.deliveryRepository.upsert(input);
    } catch (error) {
      this.logger.warn(
        `Failed to record webhook delivery from handler (non-fatal): eventId=${input.eventId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

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
      await this.redisClient.xGroupCreate(this.STREAM_NAME, this.CONSUMER_GROUP, '$', {
        MKSTREAM: true,
      });
      this.logger.log(
        `Created consumer group ${this.CONSUMER_GROUP} for stream ${this.STREAM_NAME}`
      );
    } catch (error) {
      // Ignore BUSYGROUP error (group already exists)
      if (error instanceof Error && error.message.includes('BUSYGROUP')) {
        this.logger.debug(`Consumer group ${this.CONSUMER_GROUP} already exists`);
      } else {
        this.logger.error(
          `Failed to create consumer group ${this.CONSUMER_GROUP}`,
          error instanceof Error ? error.stack : String(error)
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
      this.logger.error(
        'Consumption loop error',
        error instanceof Error ? error.stack : String(error)
      );
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
          }
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
          error instanceof Error ? error.stack : String(error)
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

      // Skip test events (they're just for verification, no job needed) but
      // still record the delivery so the FE can surface "last test.ping at" —
      // the connection-detail page (#168) reads this to confirm the install
      // round-trip succeeded.
      if (event.eventType.startsWith('test.')) {
        this.logger.debug(
          `Skipping test event ${event.eventId} (eventType: ${event.eventType}) - no job created`
        );
        await this.recordDelivery({
          eventId: event.eventId,
          provider: event.provider,
          connectionId: event.connectionId,
          eventType: event.eventType,
          status: 'received',
        });
        // ACK test events immediately (they've served their purpose)
        await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
        return;
      }

      // Resolve the connection + its adapter metadata. A *permanent* config
      // fault (connection not found / disabled) dead-letters; any other
      // (transient) error rethrows to the outer catch (no ACK → redelivery), so
      // a brief DB/infra blip never silently drops a webhook (ADR-015 invariant 3).
      let connection: Connection;
      let metadata: AdapterMetadata;
      try {
        ({ connection, metadata } = await this.integrationsService.getAdapter(event.connectionId));
      } catch (resolveError) {
        if (
          resolveError instanceof ConnectionNotFoundException ||
          resolveError instanceof ConnectionDisabledException
        ) {
          await this.deadLetter(
            messageId,
            event,
            fields,
            `connection-unavailable: ${resolveError.message}`
          );
          return;
        }
        throw resolveError;
      }

      // Resolve the plugin's webhook-event translator by adapterKey. No
      // translator → this plugin doesn't decode webhooks (poll-only) → DLQ.
      const translator = this.translatorRegistry.get(metadata.adapterKey);
      if (!translator) {
        await this.deadLetter(messageId, event, fields, `no-translator: ${metadata.adapterKey}`);
        return;
      }

      // Decode the native event into a neutral canonical event (null = undecodable).
      const canonical = translator.translate(event);
      if (!canonical) {
        await this.deadLetter(
          messageId,
          event,
          fields,
          `undecodable: objectType=${event.objectType}, eventType=${event.eventType}`
        );
        return;
      }

      // Route via the core policy (capability-gated; enqueues on a passed gate).
      // Pass the already-resolved supportedCapabilities so the policy stays a
      // pure function (no second metadata resolve).
      const outcome = await this.routingPolicy.route(
        canonical,
        connection,
        metadata.supportedCapabilities,
        event.eventId
      );
      if (outcome.status === 'ungated') {
        await this.deadLetter(
          messageId,
          event,
          fields,
          `ungated: ${canonical.domain} requires ${outcome.requiredCapability}`
        );
        return;
      }

      await this.recordDelivery({
        eventId: event.eventId,
        provider: event.provider,
        connectionId: event.connectionId,
        status: 'job_enqueued',
        downstreamJobId: outcome.jobId,
        downstreamJobType: outcome.jobType,
      });

      // ACK message only after successful enqueue
      await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);

      this.logger.debug(
        `Processed webhook event ${event.eventId} and enqueued job ${outcome.jobType}`
      );
    } catch (error) {
      // Unexpected error (network, Redis, etc.) - don't ACK, allow retry
      this.logger.error(
        `Failed to process message ${messageId}`,
        error instanceof Error ? error.stack : String(error)
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
    const payload = JSON.parse(envelope.payloadJson) as WebhookPayload;
    const metadata = (
      envelope.metadataJson ? JSON.parse(envelope.metadataJson) : {}
    ) as WebhookMetadata;

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
   * Dead-letter an unroutable webhook event: publish to the DLQ stream, record
   * the delivery as `deadlettered`, and ACK so it isn't redelivered. Reasons
   * are tagged (`connection-unavailable` / `no-translator` / `undecodable` /
   * `ungated`) to distinguish expected poll-only noise from misconfiguration.
   */
  private async deadLetter(
    messageId: string,
    event: InboundWebhookEvent,
    fields: Record<string, string>,
    reason: string
  ): Promise<void> {
    this.logger.warn(
      `Dead-lettering webhook event: eventId=${event.eventId}, provider=${event.provider}, objectType=${event.objectType}, reason=${reason}`
    );
    await this.sendToDeadLetterQueue(event, reason, fields);
    await this.recordDelivery({
      eventId: event.eventId,
      provider: event.provider,
      connectionId: event.connectionId,
      status: 'deadlettered',
      dlqReason: reason.slice(0, 500),
    });
    await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
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
    originalFields: Record<string, string>
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
        `Sent unmappable webhook event to DLQ: eventId=${event.eventId}, provider=${event.provider}, objectType=${event.objectType}, reason=${errorReason}`
      );
    } catch (dlqError) {
      // Non-fatal: log but don't fail the ACK
      this.logger.error(
        `Failed to send event to DLQ (non-fatal): eventId=${event.eventId}`,
        dlqError instanceof Error ? dlqError.stack : String(dlqError)
      );
    }
  }
}
