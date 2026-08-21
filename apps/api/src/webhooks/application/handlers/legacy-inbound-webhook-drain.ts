/**
 * Legacy Inbound Webhook Drain
 *
 * ONE-SHOT startup drain of `events.inbound.webhooks` (#2280). The durable
 * spine (ADR-049 decision 1) routes webhooks at ingress and writes the work
 * row in the gate transaction, so the always-on stream consumer this file
 * replaces (`WebhookToJobHandler`, "runs in the API process for MVP") is
 * retired — but entries already in the stream at upgrade time would otherwise
 * be stranded, and the source's redelivery would bounce off the Postgres gate
 * (`published` row exists) WITHOUT ever creating a job: silent order loss.
 *
 * This drain consumes the group's full backlog once at boot — the whole PEL
 * (any consumer's) plus unread entries — through the new resolve→gate path,
 * then exits. No infinite loop, no dedicated blocking client (pure
 * non-blocking reads: `XPENDING`/`XRANGE`/non-blocking `XREADGROUP`).
 *
 * Ownership contention is deliberately NOT modelled: after this release no
 * live consumer of the group exists, and every step is idempotent (job insert
 * `ON CONFLICT DO NOTHING`; delivery upsert #1916-rank-guarded), so two api
 * replicas draining concurrently — or racing a mid-rolling old-version
 * consumer — converge on one job row per event. A transiently-failing entry is
 * left un-ACKed for the next boot's drain (per-entry isolation).
 *
 * Removal of this drain (and the stream names it reads) is a follow-up
 * release — see docs/operations/redis-stream-retention.md.
 *
 * @module apps/api/src/webhooks/application/handlers
 */
import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Inject } from '@nestjs/common';
import { RedisClientType } from 'redis';
import type { EventEnvelope, InboundWebhookEvent } from '@openlinker/core/events';
import { Logger } from '@openlinker/shared/logging';
import {
  ackTrimmed,
  MAX_DRAIN_PAGES,
  REDIS_STREAM_NAMES,
  resolveConsumerName,
  toPendingRows,
  type StreamConsumerClient,
} from '@openlinker/shared/redis';
import type { WebhookDeliveryUpsertInput } from '@openlinker/core/webhooks';
import {
  WebhookDeliveryRepositoryPort,
  WEBHOOK_DELIVERY_REPOSITORY_TOKEN,
} from '@openlinker/core/webhooks';
import {
  INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN,
  IInboundWebhookRoutingService,
} from '../interfaces/inbound-webhook-routing.service.interface';
import {
  WEBHOOK_JOB_GATE_SERVICE_TOKEN,
  IWebhookJobGateService,
} from '../interfaces/webhook-job-gate.service.interface';
import type { WebhookPayload, WebhookMetadata } from './webhook-handler.types';

const PENDING_PAGE_SIZE = 50;
const UNREAD_PAGE_SIZE = 50;

@Injectable()
export class LegacyInboundWebhookDrain implements OnModuleInit {
  private readonly logger = new Logger(LegacyInboundWebhookDrain.name);
  private readonly STREAM_NAME = REDIS_STREAM_NAMES.inboundWebhooks;
  /** The retired consumer's group — its PEL is exactly the backlog to drain. */
  private readonly CONSUMER_GROUP = 'webhook-handler';
  private readonly CONSUMER_NAME = resolveConsumerName('webhook-drain');

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType,
    @Inject(INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN)
    private readonly inboundRouting: IInboundWebhookRoutingService,
    @Inject(WEBHOOK_JOB_GATE_SERVICE_TOKEN)
    private readonly jobGate: IWebhookJobGateService,
    @Inject(WEBHOOK_DELIVERY_REPOSITORY_TOKEN)
    private readonly deliveryRepository: WebhookDeliveryRepositoryPort
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.drainOnce();
    } catch (error) {
      // The drain is recovery, not the request path — a failure here must not
      // block api boot; un-ACKed entries are retried on the next boot.
      this.logger.error(
        `Legacy inbound-webhook drain failed (will retry next boot)`,
        error instanceof Error ? error.stack : String(error)
      );
    }
  }

  private async drainOnce(): Promise<void> {
    const groupReady = await this.ensureGroup();
    if (!groupReady) {
      return;
    }

    let drained = 0;
    let deadRows = 0;
    let trimmed = 0;
    let failed = 0;

    // Pass 1 — the group's full Pending Entries List, any consumer's. No idle
    // threshold: post-deploy no live consumer owns these, and every step is
    // idempotent, so re-processing a racing replica's entry is harmless (file
    // header). Exclusive cursor so a failing entry cannot re-present its page.
    const client = this.redisClient as unknown as StreamConsumerClient;
    let cursor = '-';
    for (let page = 0; page < MAX_DRAIN_PAGES; page += 1) {
      const pending = toPendingRows(
        await client.xPendingRange(this.STREAM_NAME, this.CONSUMER_GROUP, cursor, '+', PENDING_PAGE_SIZE)
      );
      if (pending.length === 0) {
        break;
      }
      for (const row of pending) {
        const body = (await client.xRange(this.STREAM_NAME, row.id, row.id, {
          COUNT: 1,
        })) as Array<{ id: string; message: Record<string, string> }>;
        if (!Array.isArray(body) || body.length === 0) {
          await ackTrimmed(client, this.STREAM_NAME, this.CONSUMER_GROUP, row.id);
          trimmed += 1;
          continue;
        }
        const outcome = await this.processEntry(row.id, body[0].message);
        if (outcome === 'drained') drained += 1;
        else if (outcome === 'deadlettered') deadRows += 1;
        else failed += 1;
      }
      // Exclusive resume cursor (Redis 6.2 `(`-prefixed id), so a failing
      // entry cannot re-present its own page within this drain run.
      cursor = `(${pending[pending.length - 1].id}`;
    }

    // Pass 2 — unread entries (never delivered to any consumer). Non-blocking
    // XREADGROUP against our own drain consumer, looped until empty.
    for (let page = 0; page < MAX_DRAIN_PAGES; page += 1) {
      const response = await this.redisClient.xReadGroup(
        this.CONSUMER_GROUP,
        this.CONSUMER_NAME,
        [{ key: this.STREAM_NAME, id: '>' }],
        { COUNT: UNREAD_PAGE_SIZE }
      );
      const messages = response?.[0]?.messages ?? [];
      if (messages.length === 0) {
        break;
      }
      for (const message of messages) {
        const outcome = await this.processEntry(
          message.id,
          message.message as Record<string, string>
        );
        if (outcome === 'drained') drained += 1;
        else if (outcome === 'deadlettered') deadRows += 1;
        else failed += 1;
      }
    }

    if (drained + deadRows + trimmed + failed > 0) {
      this.logger.log(
        `Legacy inbound-webhook drain: ${drained} routed, ${deadRows} deadlettered, ${trimmed} trimmed, ${failed} failed (retried next boot)`
      );
    } else {
      this.logger.debug('Legacy inbound-webhook drain: nothing to drain');
    }
  }

  /** Returns false when the group cannot be ensured (drain skipped). */
  private async ensureGroup(): Promise<boolean> {
    try {
      // '$' — a group created NOW has no legacy backlog by definition; the
      // interesting case is the pre-existing group, where this BUSYGROUPs.
      await this.redisClient.xGroupCreate(this.STREAM_NAME, this.CONSUMER_GROUP, '$', {
        MKSTREAM: true,
      });
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('BUSYGROUP')) {
        return true;
      }
      this.logger.warn(
        `Legacy drain could not ensure consumer group (skipping): ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Route one legacy entry through the NEW path. The drain composition is
   * deliberately different from the primary ingress gate (tech-review): a
   * legacy row stuck at `published` makes the gate's delivery insert conflict
   * (`isNew: false`) while its job-first order still self-heals the job — so
   * the status advance happens via the existing #1916 rank-guarded upsert, a
   * non-transactional second step that is safe HERE because the delivery row
   * is already durable and both steps are idempotent.
   */
  private async processEntry(
    messageId: string,
    fields: Record<string, string>
  ): Promise<'drained' | 'deadlettered' | 'failed'> {
    try {
      const event = this.mapToInboundWebhookEvent(this.parseEventEnvelope(fields));
      if (!event.eventId || !event.connectionId) {
        // Malformed beyond recording — ACK so it stops re-presenting.
        this.logger.warn(`Legacy drain: unparseable entry ${messageId}, acking without a row`);
        await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
        return 'deadlettered';
      }

      if (event.eventType.startsWith('test.')) {
        await this.upsertDelivery({
          eventId: event.eventId,
          provider: event.provider,
          connectionId: event.connectionId,
          eventType: event.eventType,
          status: 'received',
        });
        await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
        return 'drained';
      }

      const routing = await this.inboundRouting.resolveEvent(event);
      if (routing.kind === 'unroutable') {
        await this.upsertDelivery({
          eventId: event.eventId,
          provider: event.provider,
          connectionId: event.connectionId,
          status: 'deadlettered',
          dlqReason: routing.reason.slice(0, 500),
        });
        await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
        return 'deadlettered';
      }
      if (routing.kind === 'ping') {
        await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
        return 'drained';
      }

      const gateResult = await this.jobGate.insertDeliveryWithJob(
        {
          eventId: event.eventId,
          provider: event.provider,
          connectionId: event.connectionId,
          eventType: event.eventType || null,
          objectType: event.objectType || null,
          externalId: event.externalId || null,
          receivedAt: new Date(),
          signatureValid: true,
          dedupResult: 'new',
          status: 'job_enqueued',
        },
        routing.job
      );
      if (!gateResult.isNew) {
        // Legacy row survived at 'published' — advance it (rank-guarded).
        await this.upsertDelivery({
          eventId: event.eventId,
          provider: event.provider,
          connectionId: event.connectionId,
          status: 'job_enqueued',
          downstreamJobId: gateResult.jobId,
          downstreamJobType: routing.job.jobType,
        });
      }
      await this.redisClient.xAck(this.STREAM_NAME, this.CONSUMER_GROUP, messageId);
      return 'drained';
    } catch (error) {
      // Transient — leave un-ACKed for the next boot's drain.
      this.logger.warn(
        `Legacy drain: entry ${messageId} failed (left pending): ${error instanceof Error ? error.message : String(error)}`
      );
      return 'failed';
    }
  }

  private async upsertDelivery(input: WebhookDeliveryUpsertInput): Promise<void> {
    try {
      await this.deliveryRepository.upsert(input);
    } catch (error) {
      this.logger.warn(
        `Legacy drain: failed to upsert delivery ${input.eventId} (non-fatal): ${error instanceof Error ? error.message : String(error)}`
      );
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

  private mapToInboundWebhookEvent(envelope: EventEnvelope): InboundWebhookEvent {
    const payload = JSON.parse(envelope.payloadJson) as WebhookPayload;
    const metadata = (
      envelope.metadataJson ? JSON.parse(envelope.metadataJson) : {}
    ) as WebhookMetadata;

    const eventType = envelope.eventType.replace(/^inbound\.webhook\./, '');
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
      payload: payload.payload || payload,
    };
  }
}
