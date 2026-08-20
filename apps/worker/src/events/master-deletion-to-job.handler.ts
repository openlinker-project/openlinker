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
import {
  ackTrimmed,
  MAX_DRAIN_PAGES,
  MIN_RECLAIM_IDLE_MS,
  nextPendingCursor,
  readOwnPending,
  RECOVERY_PAGES_PER_TICK,
  RECLAIM_INTERVAL_MS,
  reclaimOrphans,
  RecoveryAttemptTracker,
  REDIS_STREAM_NAMES,
  resolveConsumerName,
  type RecoveryOutcome,
  xAddBounded,
  type StreamConsumerClient,
  type StreamEntry,
} from '@openlinker/shared/redis';
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
  private readonly DLQ_STREAM_NAME = REDIS_STREAM_NAMES.masterDeletionDead;
  private readonly CONSUMER_GROUP = 'master-deletion-offer-pause';
  // Stable across restarts of the same logical worker and distinct across
  // replicas, so this process can reach its own pending history (#2164).
  private readonly CONSUMER_NAME = resolveConsumerName('master-deletion-offer-pause');
  private readonly RECLAIM_IDLE_MS = MIN_RECLAIM_IDLE_MS;

  private lastReclaimAt = 0;
  private readonly recoveryAttempts = new RecoveryAttemptTracker();
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

    // Created BEFORE the drain, not inside `startConsumptionLoop`. The drain is
    // awaited here and can run for many pages, so without this its own abort
    // check and `recoverEntrySafely`'s shutdown rethrow are both reading an
    // undefined controller — two guards documented as live that never fire, and
    // a shutdown mid-drain would keep issuing commands against a quitting client.
    this.abortController = new AbortController();

    await this.drainOwnPending();
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
    // Reuse the controller created in `onModuleInit`; replace it only when a
    // previous run aborted, which is the restart-after-backoff path.
    if (!this.abortController || this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }
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

        // Before the empty-batch check: an idle stream is exactly when stranded
        // entries need recovering, and this is a low-traffic stream that can sit
        // empty for days. Throttled internally.
        await this.maybeReclaimOrphans();

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

  /**
   * Drain this consumer's own pending history before reading new messages.
   *
   * The steady-state loop reads `'>'`, which returns only never-delivered
   * entries, so without this a message held when a previous incarnation died
   * would stay in the PEL forever (#2164).
   */
  private async drainOwnPending(): Promise<void> {
    let drained = 0;
    let discarded = 0;
    let cursor: string | undefined;

    try {
      for (let page = 0; ; page += 1) {
        if (page >= MAX_DRAIN_PAGES) {
          this.logger.warn(
            `Stopping startup drain after ${MAX_DRAIN_PAGES} pages; entries remain pending for ${this.CONSUMER_NAME}`
          );
          break;
        }
        if (this.abortController?.signal.aborted) {
          break;
        }

        const entries = await readOwnPending(
          this.redisClient as unknown as StreamConsumerClient,
          this.STREAM_NAME,
          this.CONSUMER_GROUP,
          this.CONSUMER_NAME,
          this.COUNT,
          cursor
        );

        if (entries.length === 0) {
          break;
        }

        // Counted by outcome. A failed entry is not recovered, and a trimmed
        // entry is not either — its payload is gone. The operator reading this
        // line is reading it during the incident it describes.
        for (const entry of entries) {
          const outcome = await this.recoverEntrySafely(entry, 'startup-drain');
          if (outcome === 'recovered') {
            drained += 1;
          } else if (outcome === 'discarded') {
            discarded += 1;
          }
        }

        // Advance past this page rather than re-reading from the oldest id. An
        // entry whose handler threw is still pending, so without this the same
        // page returns forever and the drain — which onModuleInit awaits —
        // stalls boot until the page cap. A failed entry is retried by the next
        // recovery pass, not by spinning inside this one.
        cursor = nextPendingCursor(entries) ?? cursor;
      }
    } catch (error) {
      this.logger.error(
        'Failed to drain pending history; continuing to new messages',
        error instanceof Error ? error.stack : String(error)
      );
      return;
    }

    if (drained > 0) {
      this.logger.log(`Recovered ${drained} pending event(s) as ${this.CONSUMER_NAME}`);
    }

    // Reported separately and at warn: these were not recovered, they were lost
    // to retention before anything could process them.
    if (discarded > 0) {
      this.logger.warn(
        `Discarded ${discarded} pending event(s) as ${this.CONSUMER_NAME}: retention removed the payload before processing`
      );
    }
  }

  /**
   * Periodically recover stranded work: this consumer's own failed messages
   * first, then entries orphaned by a consumer that never came back.
   *
   * Re-draining own pending matters because a handler that throws leaves its
   * entry un-ACKed in this consumer's PEL, and the orphan pass deliberately
   * skips self-owned rows. Without this, one transient failure would strand a
   * message until the process restarted — indefinitely, for a long-lived pod.
   */
  private async maybeReclaimOrphans(): Promise<void> {
    const now = Date.now();
    if (now - this.lastReclaimAt < RECLAIM_INTERVAL_MS) {
      return;
    }
    this.lastReclaimAt = now;

    try {
      // Own failed messages first — the orphan pass below skips self-owned rows.
      //
      // Paged with the same exclusive cursor the startup drain uses. Without it
      // this re-reads the oldest COUNT ids from '-' on every tick, so a poison
      // entry at the head starves every later own-pending entry for the life of
      // the process — the drain only runs at boot. Capped per tick so recovery
      // cannot monopolise the consume loop.
      let retryCursor: string | undefined;
      for (let page = 0; page < RECOVERY_PAGES_PER_TICK; page += 1) {
        if (this.abortController?.signal.aborted) {
          break;
        }

        const ownRetries = await readOwnPending(
          this.redisClient as unknown as StreamConsumerClient,
          this.STREAM_NAME,
          this.CONSUMER_GROUP,
          this.CONSUMER_NAME,
          this.COUNT,
          retryCursor
        );

        if (ownRetries.length === 0) {
          break;
        }

        for (const entry of ownRetries) {
          await this.recoverEntrySafely(entry, 'pending-retry');
        }

        retryCursor = nextPendingCursor(ownRetries) ?? retryCursor;
      }

      const entries = await reclaimOrphans(
        this.redisClient as unknown as StreamConsumerClient,
        this.STREAM_NAME,
        this.CONSUMER_GROUP,
        this.CONSUMER_NAME,
        this.RECLAIM_IDLE_MS,
        this.COUNT
      );

      for (const entry of entries) {
        await this.recoverEntrySafely(entry, 'orphan-reclaim');
      }
      // Only entries whose XCLAIM actually transferred. `reclaimOrphans` also
      // returns a `trimmed` entry on the path where the claim did NOT transfer
      // and the data was gone — nothing was reclaimed there, so counting it
      // would overstate what this pass took ownership of.
      const reclaimed = entries.filter((entry) => entry.kind === 'entry').length;

      if (reclaimed > 0) {
        this.logger.warn(
          `Reclaimed ${reclaimed} orphaned event(s) idle > ${this.RECLAIM_IDLE_MS}ms into ${this.CONSUMER_NAME}`
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to reclaim orphaned events',
        error instanceof Error ? error.stack : String(error)
      );
    }
  }

  /**
   * Run one recovered entry, isolating a handler failure to that entry.
   *
   * Without this the enclosing try/catch spans the whole page loop, so a single
   * entry whose handler throws aborts the entire pass — and because the PEL is
   * always paged from the oldest id, that same entry leads every later drain and
   * reclaim. One poison message would permanently block recovery of every other
   * stranded message, which is the precise failure this recovery path exists to
   * prevent. The entry stays un-ACKed and is retried on the next pass; what does
   * not happen is its siblings being starved behind it.
   */
  private async recoverEntrySafely(entry: StreamEntry, source: string): Promise<RecoveryOutcome> {
    try {
      await this.handleRecoveredEntry(entry, source);
      this.recoveryAttempts.succeeded(entry.id);
      // A trimmed entry was ACKed, but nothing was recovered — retention
      // destroyed its payload. Reporting that as recovered would tell an
      // operator the opposite of what happened.
      return entry.kind === 'trimmed' ? 'discarded' : 'recovered';
    } catch (error) {
      // A shutdown-time failure is not a handler failure: the client is quitting
      // and every later command would fail too. Rethrow so the enclosing pass
      // ends instead of grinding through the rest of the page against a dead
      // connection.
      if (this.abortController?.signal.aborted) {
        throw error;
      }

      const attempts = this.recoveryAttempts.recordFailure(entry.id);

      this.logger.error(
        `Failed to recover stream entry ${entry.id} (${source}, attempt ${attempts}, redis deliveries ${entry.kind === 'entry' ? entry.deliveryCount : 'n/a'}); leaving it pending and continuing`,
        error instanceof Error ? error.stack : String(error)
      );

      // Once, on the crossing — a poison entry recurs by definition, so an
      // unguarded alarm per pass is alert fatigue. Auto-dead-lettering is
      // deliberately NOT done: two of the three consumers cannot build their
      // dead-letter payload from a raw pending entry (one needs a decoded
      // webhook event, one a parsed job request), and discarding it would be
      // unrecoverable loss. See ADR-049.
      if (this.recoveryAttempts.justCrossedThreshold(attempts)) {
        this.logger.error(
          `Stream entry ${entry.id} has now failed recovery ${attempts} times (${source}); it is stuck and needs manual intervention`
        );
      }

      return 'failed';
    }
  }

  /**
   * Route one recovered entry, separating a trimmed id from real work.
   *
   * A trimmed entry has no body, so routing it into `processMessage` would fail
   * validation and write a dead-letter entry describing an event that was never
   * actually dropped. It is ACKed to clear the dangling PEL id instead.
   */
  private async handleRecoveredEntry(entry: StreamEntry, source: string): Promise<void> {
    if (entry.kind === 'trimmed') {
      this.logger.warn(
        `Discarding trimmed stream entry ${entry.id} (${source}): retention removed its data before it was processed`
      );
      await ackTrimmed(
        this.redisClient as unknown as StreamConsumerClient,
        this.STREAM_NAME,
        this.CONSUMER_GROUP,
        entry.id
      );
      return;
    }

    await this.processMessage(entry.id, entry.fields);
  }

  private async deadLetter(
    messageId: string,
    fields: Record<string, string>,
    reason: string
  ): Promise<void> {
    this.logger.warn(
      `Dead-lettering master-deletion event: messageId=${messageId}, reason=${reason}`
    );
    try {
      // Age-bounded rather than count-bounded: this stream is the SOLE record
      // that a deletion event was discarded (no Postgres counterpart), so
      // FIFO-drop would discard exactly the first entries of an incident (#2163).
      await xAddBounded(this.redisClient, this.DLQ_STREAM_NAME, {
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
