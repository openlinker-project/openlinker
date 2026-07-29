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
import { DefaultWebhookDecoder } from '../decoders/default-webhook-decoder';
import { WebhookAuthenticationException } from '../errors/webhook-authentication.exception';
import { WebhookDecodeException } from '../errors/webhook-decode.exception';
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type { InboundWebhookDecoderPort } from '@openlinker/core/integrations';
import {
  InboundWebhookDecoderRegistryService,
  INBOUND_WEBHOOK_DECODER_REGISTRY_TOKEN,
} from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';
import type { WebhookDeliveryUpsertInput } from '@openlinker/core/webhooks';
import {
  WebhookDeliveryRepositoryPort,
  WEBHOOK_DELIVERY_REPOSITORY_TOKEN,
  WebhookAuthRejectionRepositoryPort,
  WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN,
} from '@openlinker/core/webhooks';

@Injectable()
export class WebhookService implements IWebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly authService: WebhookAuthService,
    private readonly dedupService: WebhookDedupService,
    private readonly eventPublisher: WebhookEventPublisher,
    private readonly defaultDecoder: DefaultWebhookDecoder,
    @Inject(INBOUND_WEBHOOK_DECODER_REGISTRY_TOKEN)
    private readonly decoderRegistry: InboundWebhookDecoderRegistryService,
    @Inject(WEBHOOK_DELIVERY_REPOSITORY_TOKEN)
    private readonly deliveryRepository: WebhookDeliveryRepositoryPort,
    @Inject(WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN)
    private readonly authRejectionRepository: WebhookAuthRejectionRepositoryPort
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

  /**
   * Record a signature-rejected delivery attempt (#1814). Deliberately non-fatal
   * — a failure here must never change the 401 the caller is about to receive.
   * Written to `webhook_auth_rejections`, NOT `webhook_deliveries` (which stays
   * reserved for verified deliveries, ADR-005), so the status projection can
   * tell an actively-failing connection apart from one that never registered.
   */
  private async recordAuthRejection(
    provider: string,
    connectionId: string,
    reason: string
  ): Promise<void> {
    try {
      await this.authRejectionRepository.recordRejection({ provider, connectionId, reason });
    } catch (error) {
      this.logger.warn(
        `Failed to record webhook auth rejection (non-fatal): provider=${provider}, connectionId=${connectionId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async processWebhook(
    provider: string,
    connectionId: string,
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<Record<string, unknown> | void> {
    // Resolve the provider's decoder (ADR-021); fall back to the host's
    // OL-HMAC + WebhookRequestDto default for OL-module providers.
    const decoder: InboundWebhookDecoderPort =
      this.decoderRegistry.get(provider) ?? this.defaultDecoder;

    // Connection gate (provider-agnostic): exists, active, platformType matches.
    await this.authService.assertConnectionUsable(provider, connectionId);

    // Subscription-verification handshake (e.g. Infakt's `verification_code`
    // echo) — runs BEFORE signature verification: the ping precedes any
    // signed traffic. Short-circuits with the exact body to echo; no
    // verify/dedup/publish for a handshake request.
    const handshakeBody = decoder.detectHandshake?.(rawBody, headers);
    if (handshakeBody) {
      this.logger.log(`Webhook handshake detected: provider=${provider}, connectionId=${connectionId}`);
      return handshakeBody;
    }

    // Verify the signature via the decoder (host supplies the per-connection
    // secret). Then replay-check the decoder-normalized timestamp. Order is
    // verify → replay because a third-party timestamp is only trusted once the
    // signature over it is verified. Both failures short-circuit BEFORE any row
    // is inserted (a `status='rejected'` row would block legitimate retries via
    // the unique constraint, #711).
    const secret = await this.authService.getSecret(provider, connectionId);
    const verifyResult = decoder.verify({ rawBody, headers, secret });
    if (!verifyResult.ok) {
      this.logger.warn(
        `Invalid webhook signature: provider=${provider}, connectionId=${connectionId}`
      );
      // Durable auth-rejection signal (#1814) — recorded here, before the throw,
      // because the delivery never reaches `webhook_deliveries` (nothing verified).
      await this.recordAuthRejection(provider, connectionId, 'invalid_signature');
      throw new WebhookAuthenticationException('Invalid webhook signature', provider, connectionId);
    }
    if (verifyResult.timestampMs !== undefined) {
      // Throws WebhookReplayException which the controller maps to 401.
      this.authService.validateTimestampMs(verifyResult.timestampMs);
    }

    // Decode the (verified) body into the neutral envelope.
    const decoded = decoder.extractEnvelope(rawBody, headers);
    if (decoded.action === 'reject') {
      this.logger.warn(
        `Webhook body rejected: provider=${provider}, connectionId=${connectionId}: ${decoded.reason}`
      );
      throw new WebhookDecodeException(decoded.reason, provider, connectionId);
    }
    if (decoded.action === 'ignore') {
      // Well-formed but not ours (unhandled topic / setup ping) — 202, no
      // publish. Distinct from reject so benign third-party noise doesn't
      // trigger source-side retry storms (ADR-021).
      this.logger.debug(
        `Webhook ignored (no publish): provider=${provider}, connectionId=${connectionId}: ${decoded.reason}`
      );
      return;
    }

    const envelope = decoded.envelope;
    const correlationId = envelope.eventId;

    this.logger.log(
      `Processing webhook: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}, eventType=${envelope.eventType}`
    );

    // Authoritative dedup gate (#711). INSERT ... ON CONFLICT DO NOTHING against
    // `webhook_deliveries`'s unique constraint on `(provider, connectionId,
    // eventId)`. A replay finds the existing row and short-circuits to a 202
    // idempotent ack — durable, survives Redis outages.
    const baseDelivery: WebhookDeliveryUpsertInput = {
      eventId: envelope.eventId,
      provider,
      connectionId,
      eventType: envelope.eventType ?? null,
      objectType: envelope.objectType ?? null,
      externalId: envelope.externalId ?? null,
      receivedAt: new Date(),
      payload: envelope.payload as Record<string, unknown>,
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
      envelope.eventId
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
      // Build and publish the inbound webhook event from the neutral envelope;
      // the host owns provider / connectionId / receivedAt.
      const event: InboundWebhookEvent = {
        eventId: envelope.eventId,
        provider,
        connectionId,
        eventType: envelope.eventType,
        occurredAt: envelope.occurredAt,
        receivedAt: new Date().toISOString(),
        objectType: envelope.objectType,
        externalId: envelope.externalId,
        payload: envelope.payload,
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
        await this.dedupService.markDone(provider, connectionId, envelope.eventId);
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
        await this.deliveryRepository.deleteByEventKey(provider, connectionId, envelope.eventId);
      } catch (deleteError) {
        this.logger.error(
          `Failed to delete webhook_deliveries row after publish failure: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`,
          deleteError instanceof Error ? deleteError.stack : String(deleteError)
        );
      }
      try {
        await this.dedupService.clearProcessing(provider, connectionId, envelope.eventId);
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
