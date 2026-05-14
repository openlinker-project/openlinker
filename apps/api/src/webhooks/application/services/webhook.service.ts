/**
 * Webhook Service
 *
 * Orchestrates the complete webhook processing flow including signature verification,
 * deduplication, and event publishing. Coordinates between WebhookAuthService,
 * WebhookDedupService, and WebhookEventPublisher to process inbound webhooks.
 *
 * @module apps/api/src/webhooks/application/services
 * @implements {IWebhookService}
 */
import { Inject, Injectable } from '@nestjs/common';
import type { IWebhookService } from '../interfaces/webhook.service.interface';
import { WebhookAuthService } from './webhook-auth.service';
import { WebhookDedupService } from './webhook-dedup.service';
import { WebhookEventPublisher } from './webhook-event-publisher.service';
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type { WebhookRequestDto } from '../../http/dto/webhook-request.dto';
import { Logger } from '@openlinker/shared/logging';
import type { WebhookDeliveryUpsertInput } from '@openlinker/core/webhooks';
import {
  WebhookDeliveryRepositoryPort,
  WEBHOOK_DELIVERY_REPOSITORY_TOKEN,
} from '@openlinker/core/webhooks';

@Injectable()
export class WebhookService implements IWebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly authService: WebhookAuthService,
    private readonly dedupService: WebhookDedupService,
    private readonly eventPublisher: WebhookEventPublisher,
    @Inject(WEBHOOK_DELIVERY_REPOSITORY_TOKEN)
    private readonly deliveryRepository: WebhookDeliveryRepositoryPort
  ) {}

  private async recordDelivery(input: WebhookDeliveryUpsertInput): Promise<void> {
    try {
      await this.deliveryRepository.upsert(input);
    } catch (error) {
      this.logger.warn(
        `Failed to record webhook delivery (non-fatal): provider=${input.provider}, connectionId=${input.connectionId}, eventId=${input.eventId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async processWebhook(
    provider: string,
    connectionId: string,
    request: WebhookRequestDto,
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<void> {
    const correlationId = request.eventId; // Use eventId as correlation ID

    this.logger.log(
      `Processing webhook: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}, eventType=${request.eventType}`
    );

    const timestamp = headers['x-openlinker-timestamp'] || headers['X-OpenLinker-Timestamp'];
    const signature = headers['x-openlinker-signature'] || headers['X-OpenLinker-Signature'];

    // Validation steps below short-circuit BEFORE any row is inserted. Failed
    // validation lives in logs (Logger.warn) — see plan §4.4 for why we don't
    // record `status='rejected'` rows: under the new Postgres-authoritative
    // dedup model (#711), such rows would block legitimate source-side retries
    // of the same eventId via the unique constraint.

    if (!timestamp) {
      this.logger.warn(
        `Missing X-OpenLinker-Timestamp header: provider=${provider}, connectionId=${connectionId}`
      );
      throw new Error('Missing X-OpenLinker-Timestamp header');
    }

    if (!signature) {
      this.logger.warn(
        `Missing X-OpenLinker-Signature header: provider=${provider}, connectionId=${connectionId}`
      );
      throw new Error('Missing X-OpenLinker-Signature header');
    }

    // Step 1: Validate timestamp (replay protection) - fail fast before HMAC.
    // Throws WebhookReplayException which the controller maps to 401.
    this.authService.validateTimestamp(timestamp);

    // Step 2: Verify signature.
    const isValid = await this.authService.verifySignature(
      provider,
      connectionId,
      timestamp,
      rawBody,
      signature
    );

    if (!isValid) {
      this.logger.error(
        `Invalid webhook signature: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`
      );
      throw new Error('Invalid webhook signature');
    }

    this.logger.debug(
      `Signature verified: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`
    );

    // Step 3: Authoritative dedup gate (#711). INSERT ... ON CONFLICT DO
    // NOTHING against `webhook_deliveries`'s unique constraint on
    // `(provider, connectionId, eventId)`. A replay finds the existing row
    // and short-circuits to a 202 idempotent ack — durable, survives Redis
    // outages, the durable counterpart to Redis-only dedup.
    const baseDelivery: WebhookDeliveryUpsertInput = {
      eventId: request.eventId,
      provider,
      connectionId,
      eventType: request.eventType ?? null,
      objectType: request.object?.type ?? null,
      externalId: request.object?.externalId ?? null,
      receivedAt: new Date(),
      payload: request.payload as Record<string, unknown>,
      signatureValid: true,
      status: 'received',
    };
    const insertResult = await this.deliveryRepository.insertIfNew(baseDelivery);

    if (!insertResult.isNew) {
      this.logger.warn(
        `Duplicate webhook event (Postgres gate): provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`
      );
      return; // 202 idempotent ack — no further processing.
    }

    // Step 4: Inner dedup gate via Redis (existing two-phase markProcessing →
    // markDone semantics, kept as a fast-path safety net while the Postgres
    // gate beds in — see plan §4.2 and §7 for the deferred cleanup).
    const isNewInRedis = await this.dedupService.markProcessing(
      provider,
      connectionId,
      request.eventId
    );

    if (!isNewInRedis) {
      // Postgres said new, Redis said duplicate — possible if a prior attempt
      // succeeded in Redis but our Postgres row was just DELETEd via the
      // failure-recovery path. Trust Postgres (the authoritative gate) and
      // proceed; downstream is idempotent on `eventId`.
      this.logger.warn(
        `Postgres/Redis dedup disagreement (proceeding via Postgres): provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`
      );
    }

    try {
      // Step 5: Build and publish the inbound webhook event.
      const event: InboundWebhookEvent = {
        eventId: request.eventId,
        provider,
        connectionId,
        eventType: request.eventType,
        occurredAt: request.occurredAt,
        receivedAt: new Date().toISOString(),
        objectType: request.object.type,
        externalId: request.object.externalId,
        payload: request.payload,
      };

      const messageId = await this.eventPublisher.publishInboundWebhook(event);
      this.logger.log(
        `Published webhook event: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}, messageId=${messageId}`
      );
      await this.recordDelivery({
        ...baseDelivery,
        signatureValid: true,
        dedupResult: 'new',
        status: 'published',
        publishedMessageId: messageId,
      });

      // Step 6: Mark Redis-side dedup as done (non-fatal if it fails — the
      // Postgres row's status='published' is the durable signal).
      try {
        await this.dedupService.markDone(provider, connectionId, request.eventId);
      } catch (markDoneError) {
        this.logger.warn(
          `Failed to mark webhook as done (non-fatal): provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`,
          markDoneError instanceof Error ? markDoneError.message : String(markDoneError)
        );
      }
    } catch (error) {
      // Publish failed — undo BOTH gates so the source-side retry can re-enter
      // (#711). This is the load-bearing failure-recovery semantic that earlier
      // drafts of this PR got wrong: leaving the row in place would block all
      // future retries via the unique constraint.
      try {
        await this.deliveryRepository.deleteByEventKey(provider, connectionId, request.eventId);
      } catch (deleteError) {
        this.logger.error(
          `Failed to delete webhook_deliveries row after publish failure: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`,
          deleteError instanceof Error ? deleteError.stack : String(deleteError)
        );
      }
      try {
        await this.dedupService.clearProcessing(provider, connectionId, request.eventId);
      } catch (clearError) {
        this.logger.error(
          `Failed to clear Redis processing marker: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`,
          clearError instanceof Error ? clearError.stack : String(clearError)
        );
      }

      this.logger.error(
        `Failed to process webhook: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`,
        error instanceof Error ? error.stack : String(error)
      );

      throw error;
    }
  }
}
