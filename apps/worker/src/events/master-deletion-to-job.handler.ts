/**
 * Master Deletion to Job Handler
 *
 * Consumes `events.master.deletion` from Redis Streams (published by
 * `MasterProductSyncService` / `MasterInventorySyncService` — #1599) and
 * enqueues a `marketplace.offer.pauseStale` job — the event-driven TRIGGER
 * half of the stale-offer pause (#1689). The reconcile SWEEP
 * (`marketplace.offer.pauseStaleSweep`, scheduled hourly) is the guarantee:
 * this event is published at-most-once (fire-after-commit, never re-emitted),
 * so a lost message here is closed by the sweep re-reading the persisted
 * `product_variants.isStale` flag instead of trusting delivery.
 *
 * Structurally mirrors `WebhookToJobHandler` (long-polling consumer-group
 * loop, ACK-after-enqueue, dead-letter on a permanent fault). Runs on a
 * dedicated blocking Redis client — `JobIntakeConsumer` already blocks on the
 * worker's shared client, and two `XREADGROUP` calls cannot share one
 * connection.
 *
 * @module apps/worker/src/events
 */
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisClientType } from 'redis';
import type { EventEnvelope } from '@openlinker/core/events';
import type { MasterDeletionEventPayload } from '@openlinker/core/products';
import { MASTER_DELETION_EVENT_STREAM } from '@openlinker/core/products';
import { JobEnqueuePort, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';
import { MASTER_DELETION_REDIS_CLIENT_BLOCKING_TOKEN } from './events.tokens';

/**
 * Sentinel connection id for jobs whose target connections are resolved
 * downstream, not known at enqueue time — mirrors
 * `InventoryPropagateToMarketplacesHandler` / `InventoryService`'s private
 * `SYSTEM_CONNECTION_ID`. The deletion is detected on the MASTER connection,
 * but the offers to pause live on other (destination) connections.
 */
const SYSTEM_CONNECTION_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class MasterDeletionToJobHandler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MasterDeletionToJobHandler.name);
  private readonly STREAM_NAME = MASTER_DELETION_EVENT_STREAM;
  private readonly DLQ_STREAM_NAME = 'events.master.deletion.dead';
  private readonly CONSUMER_GROUP = 'master-deletion-offer-pause';
  private readonly CONSUMER_NAME = `master-deletion-offer-pause-${process.pid}`;
  private readonly BLOCK_MS = 5000;
  private readonly COUNT = 10;

  private abortController: AbortController | null = null;
  private isRunning = false;

  constructor(
    @Inject(MASTER_DELETION_REDIS_CLIENT_BLOCKING_TOKEN)
    private readonly redisClient: RedisClientType,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    private readonly configService: ConfigService
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled =
      this.configService.get<string>('OL_MASTER_DELETION_CONSUMER_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log(
        'Master-deletion consumer disabled via OL_MASTER_DELETION_CONSUMER_ENABLED=false'
      );
      return;
    }

    await this.initializeConsumerGroup();
    this.startConsumptionLoop();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopConsumptionLoop();
    await this.redisClient.quit();
  }

  private async initializeConsumerGroup(): Promise<void> {
    try {
      await this.redisClient.xGroupCreate(this.STREAM_NAME, this.CONSUMER_GROUP, '$', {
        MKSTREAM: true,
      });
      this.logger.log(
        `Created consumer group ${this.CONSUMER_GROUP} for stream ${this.STREAM_NAME}`
      );
    } catch (error) {
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

  private startConsumptionLoop(): void {
    this.abortController = new AbortController();
    this.isRunning = true;

    this.consumeLoop().catch((error) => {
      this.logger.error(
        'Consumption loop error',
        error instanceof Error ? error.stack : String(error)
      );
      if (this.isRunning) {
        setTimeout(() => this.startConsumptionLoop(), 5000);
      }
    });
  }

  private async stopConsumptionLoop(): Promise<void> {
    this.logger.log('Stopping master-deletion-to-job handler...');
    this.isRunning = false;

    if (this.abortController) {
      this.abortController.abort();
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

    this.logger.log('Master-deletion-to-job handler stopped');
  }

  private async consumeLoop(): Promise<void> {
    while (this.isRunning && !this.abortController?.signal.aborted) {
      try {
        const messages = await this.redisClient.xReadGroup(
          this.CONSUMER_GROUP,
          this.CONSUMER_NAME,
          [{ key: this.STREAM_NAME, id: '>' }],
          { BLOCK: this.BLOCK_MS, COUNT: this.COUNT }
        );

        if (!messages || messages.length === 0) {
          continue;
        }

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
          break;
        }
        this.logger.error(
          'Error reading from stream',
          error instanceof Error ? error.stack : String(error)
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Parse, enqueue, and ACK a single message. ACK happens ONLY after a
   * successful enqueue. A malformed/unparseable payload dead-letters (and
   * ACKs, so it never blocks the stream); any other error rethrows to the
   * outer loop, which does NOT ack — allowing Redis to redeliver.
   */
  private async processMessage(messageId: string, fields: Record<string, string>): Promise<void> {
    let envelope: EventEnvelope;
    let payload: MasterDeletionEventPayload;
    try {
      envelope = this.parseEventEnvelope(fields);
      payload = this.parsePayload(envelope);
    } catch (error) {
      await this.deadLetter(
        messageId,
        fields,
        `unparseable: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    try {
      await this.jobEnqueue.enqueueJob({
        jobType: 'marketplace.offer.pauseStale',
        connectionId: SYSTEM_CONNECTION_ID,
        payload: {
          schemaVersion: 1,
          internalProductId: payload.internalProductId,
          variantIds: payload.variantIds,
          correlationId: payload.correlationId,
        },
        idempotencyKey: `stale-pause:${payload.internalProductId}:${envelope.eventId}`,
      });

      await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);

      this.logger.debug(
        `Enqueued marketplace.offer.pauseStale for product ${payload.internalProductId} (${payload.variantIds.length} variant(s), correlationId=${payload.correlationId})`
      );
    } catch (error) {
      // Transient (Redis/DB) fault — don't ACK, allow redelivery.
      this.logger.error(
        `Failed to enqueue pauseStale job for message ${messageId}`,
        error instanceof Error ? error.stack : String(error)
      );
      throw error;
    }
  }

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
   * Parse the envelope payload, tolerating a v1 message left on the stream
   * from before the schema-version-2 field additions (#1689 Phase 0):
   * `correlationId` falls back to the envelope's own `eventId`, `externalId`
   * falls back to an empty string (advisory/correlation-only field, never
   * used as a lookup key downstream).
   */
  private parsePayload(envelope: EventEnvelope): MasterDeletionEventPayload {
    const raw = JSON.parse(envelope.payloadJson) as Partial<MasterDeletionEventPayload>;
    if (
      !raw ||
      typeof raw.internalProductId !== 'string' ||
      !Array.isArray(raw.variantIds) ||
      raw.variantIds.length === 0 ||
      !raw.variantIds.every((id) => typeof id === 'string')
    ) {
      throw new Error(`invalid master-deletion payload: ${envelope.payloadJson}`);
    }
    return {
      connectionId: raw.connectionId ?? '',
      internalProductId: raw.internalProductId,
      variantIds: raw.variantIds,
      correlationId: raw.correlationId ?? envelope.eventId,
      externalId: raw.externalId ?? '',
    };
  }

  private async deadLetter(
    messageId: string,
    fields: Record<string, string>,
    reason: string
  ): Promise<void> {
    this.logger.warn(`Dead-lettering master-deletion event: messageId=${messageId}, reason=${reason}`);
    try {
      await this.redisClient.xAdd(this.DLQ_STREAM_NAME, '*', {
        ...fields,
        errorReason: reason,
      });
    } catch (dlqError) {
      this.logger.error(
        `Failed to send master-deletion event to DLQ (non-fatal): messageId=${messageId}`,
        dlqError instanceof Error ? dlqError.stack : String(dlqError)
      );
    }
    await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
  }
}
