/**
 * Webhook Service
 *
 * Orchestrates the complete webhook processing flow: signature verification,
 * synchronous translate→route at ingress (#2280), and the durable-spine gate
 * write — the `sync_jobs` work row committed in the SAME Postgres transaction
 * as the `webhook_deliveries` gate row (ADR-049 decision 1). Redis is not part
 * of the durable path: the inner `webhook:*` dedup marks are best-effort, and
 * the runner's 1 s Postgres poll picks up the committed job with no hint.
 *
 * @module apps/api/src/webhooks/application/services
 * @implements {IWebhookService}
 */
import { Inject, Injectable } from '@nestjs/common';
import type { IWebhookService } from '../interfaces/webhook.service.interface';
import { WebhookAuthService } from './webhook-auth.service';
import { WebhookDedupService } from './webhook-dedup.service';
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
  WebhookAuthRejectionRepositoryPort,
  WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN,
} from '@openlinker/core/webhooks';
import {
  INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN,
  IInboundWebhookRoutingService,
} from '../interfaces/inbound-webhook-routing.service.interface';
import {
  WEBHOOK_JOB_GATE_SERVICE_TOKEN,
  IWebhookJobGateService,
} from '../interfaces/webhook-job-gate.service.interface';

@Injectable()
export class WebhookService implements IWebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly authService: WebhookAuthService,
    private readonly dedupService: WebhookDedupService,
    private readonly defaultDecoder: DefaultWebhookDecoder,
    @Inject(INBOUND_WEBHOOK_DECODER_REGISTRY_TOKEN)
    private readonly decoderRegistry: InboundWebhookDecoderRegistryService,
    @Inject(WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN)
    private readonly authRejectionRepository: WebhookAuthRejectionRepositoryPort,
    @Inject(INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN)
    private readonly inboundRouting: IInboundWebhookRoutingService,
    @Inject(WEBHOOK_JOB_GATE_SERVICE_TOKEN)
    private readonly jobGate: IWebhookJobGateService
  ) {}

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

    // Translate → route synchronously at ingress (#2280) so the jobType /
    // payload / idempotencyKey are known INSIDE the gate transaction. A
    // transient failure here (e.g. DB blip resolving the adapter) throws
    // before anything is inserted, so the source's retry re-enters cleanly —
    // the #711 semantic is preserved by never needing a compensating delete.
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
    const routing = await this.inboundRouting.resolveEvent(event);

    // Inner Redis dedup mark — BEST-EFFORT and non-fatal (#2280): Redis is a
    // hint on this path, never a gate, so a Redis outage must not 5xx a
    // webhook whose durable write is about to commit.
    let redisSaidDuplicate = false;
    try {
      redisSaidDuplicate = !(await this.dedupService.markProcessing(
        provider,
        connectionId,
        envelope.eventId
      ));
    } catch (redisError) {
      this.logger.warn(
        `Redis dedup markProcessing failed (non-fatal): provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}: ${redisError instanceof Error ? redisError.message : String(redisError)}`
      );
    }

    // The durable-spine gate (ADR-049 decision 1): the ADR-005 dedup INSERT on
    // `webhook_deliveries` and — for a routed event — the `sync_jobs` work row,
    // in ONE transaction. A replay finds the existing row and short-circuits to
    // the 202 idempotent ack. The row is written in its FINAL status: routing
    // already happened, so `received → published → job_enqueued` collapses to a
    // single statement (`published` is unreachable for new webhook rows; the
    // #1916 rank guard stays for legacy rows and the startup drain).
    const delivery: WebhookDeliveryUpsertInput = {
      eventId: envelope.eventId,
      provider,
      connectionId,
      eventType: envelope.eventType ?? null,
      objectType: envelope.objectType ?? null,
      externalId: envelope.externalId ?? null,
      receivedAt: new Date(),
      payload: envelope.payload as Record<string, unknown>,
      signatureValid: true,
      dedupResult: 'new',
      status:
        routing.kind === 'routed'
          ? 'job_enqueued'
          : routing.kind === 'ping'
            ? 'received'
            : 'deadlettered',
      dlqReason: routing.kind === 'unroutable' ? routing.reason.slice(0, 500) : null,
    };
    const gateResult = await this.jobGate.insertDeliveryWithJob(
      delivery,
      routing.kind === 'routed' ? routing.job : null
    );

    if (!gateResult.isNew) {
      this.logger.warn(
        `Duplicate webhook event (Postgres gate): provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`
      );
      return; // 202 idempotent ack.
    }
    if (redisSaidDuplicate) {
      // Postgres said new, Redis said duplicate — trust Postgres (the
      // authoritative gate, ADR-005); downstream is idempotent on `eventId`.
      this.logger.warn(
        `Postgres/Redis dedup disagreement (proceeded via Postgres): provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`
      );
    }

    if (routing.kind === 'routed') {
      this.logger.log(
        `Webhook routed at ingress: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId} → ${routing.job.jobType} (job ${gateResult.jobId ?? 'unknown'})`
      );
    } else if (routing.kind === 'unroutable') {
      this.logger.warn(
        `Webhook recorded as deadlettered: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}: ${routing.reason}`
      );
    }

    // Post-commit: Redis mark only — best-effort, and deliberately NOT wrapped
    // in a catch that deletes the delivery row. After the gate commit a delete
    // would orphan the committed job and eat the source's retry (#2280).
    try {
      await this.dedupService.markDone(provider, connectionId, envelope.eventId);
    } catch (markDoneError) {
      this.logger.warn(
        `Failed to mark webhook as done (non-fatal): provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`,
        markDoneError instanceof Error ? markDoneError.message : String(markDoneError)
      );
    }
  }
}
