/**
 * Webhooks Module
 *
 * NestJS module for webhook ingestion. Since #2280 (ADR-049 decision 1) the
 * webhook path is ingress-transactional: routing runs synchronously in
 * `WebhookService` and the `sync_jobs` work row commits in the same Postgres
 * transaction as the `webhook_deliveries` gate row (`WebhookJobGateRepository`).
 * The always-on stream consumer and its dedicated blocking Redis client are
 * retired; `LegacyInboundWebhookDrain` runs once at boot to recover any
 * pre-upgrade backlog, and is itself removed in a follow-up release.
 *
 * @module apps/api/src/webhooks
 */
import { Module } from '@nestjs/common';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import {
  SyncModule,
  InboundRoutingPolicyService,
  INBOUND_ROUTING_POLICY_TOKEN,
} from '@openlinker/core/sync';
import { WebhooksCoreModule } from '@openlinker/core/webhooks';
import { WebhookController } from './http/webhook.controller';
import { WebhookDeliveryController } from './http/webhook-delivery.controller';
import { WebhookService } from './application/services/webhook.service';
import { WebhookAuthService } from './application/services/webhook-auth.service';
import { DefaultWebhookDecoder } from './application/decoders/default-webhook-decoder';
import { WebhookDedupService } from './application/services/webhook-dedup.service';
import { WebhookDeliveryQueryService } from './application/services/webhook-delivery-query.service';
import { WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN } from './application/interfaces/webhook-delivery-query.service.interface';
import { InboundWebhookRoutingService } from './application/services/inbound-webhook-routing.service';
import { INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN } from './application/interfaces/inbound-webhook-routing.service.interface';
import { WebhookJobGateRepository } from './infrastructure/persistence/webhook-job-gate.repository';
import { WEBHOOK_JOB_GATE_SERVICE_TOKEN } from './application/interfaces/webhook-job-gate.service.interface';
import { LegacyInboundWebhookDrain } from './application/handlers/legacy-inbound-webhook-drain';

/**
 * Note: Raw body capture for webhook signature verification is handled at the
 * application level in main.ts using express.json() with verify hook for /webhooks routes.
 * This ensures the verify hook fires before any other body parsing.
 */
@Module({
  imports: [
    IntegrationsModule, // For WebhookSecretProviderPort + translator registry
    IdentifierMappingModule, // For ConnectionPort
    SyncModule, // For JobEnqueuePort (route()) + routing policy deps
    WebhooksCoreModule, // For WebhookDeliveryRepositoryPort
  ],
  controllers: [WebhookController, WebhookDeliveryController],
  providers: [
    WebhookService,
    WebhookAuthService,
    DefaultWebhookDecoder,
    WebhookDedupService,
    WebhookDeliveryQueryService,
    { provide: WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN, useExisting: WebhookDeliveryQueryService },
    // Inbound routing policy (ADR-015 / #903) — core class bound here, where its
    // deps (IIntegrationsService, JobEnqueuePort) are already imported.
    InboundRoutingPolicyService,
    { provide: INBOUND_ROUTING_POLICY_TOKEN, useExisting: InboundRoutingPolicyService },
    // Ingress translate→resolve + the transactional gate (#2280).
    InboundWebhookRoutingService,
    { provide: INBOUND_WEBHOOK_ROUTING_SERVICE_TOKEN, useExisting: InboundWebhookRoutingService },
    WebhookJobGateRepository,
    { provide: WEBHOOK_JOB_GATE_SERVICE_TOKEN, useExisting: WebhookJobGateRepository },
    // One-shot recovery of the pre-#2280 stream backlog (shared Redis client,
    // non-blocking reads only).
    LegacyInboundWebhookDrain,
  ],
})
export class WebhooksModule {}
