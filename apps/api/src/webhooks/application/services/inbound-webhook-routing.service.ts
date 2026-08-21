/**
 * Inbound Webhook Routing Service
 *
 * Resolves a verified inbound webhook to a sync-job spec at ingress (#2280) —
 * the translate→resolve step the retired `WebhookToJobHandler` ran
 * asynchronously, now synchronous so the gate transaction knows the
 * jobType/payload/idempotencyKey (ADR-049 decision 1). The capability-
 * translated routing contract (ADR-015) is unchanged; only WHEN it runs moved.
 *
 * Deterministic faults classify as `unroutable` (durable `deadlettered` rows,
 * replacing the Redis DLQ); anything else rethrows so the source retries.
 *
 * @module apps/api/src/webhooks/application/services
 * @implements {IInboundWebhookRoutingService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { InboundWebhookEvent } from '@openlinker/core/events';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN,
  WebhookEventTranslatorRegistryService,
  IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  ConnectionNotFoundException,
  ConnectionDisabledException,
} from '@openlinker/core/identifier-mapping';
import { INBOUND_ROUTING_POLICY_TOKEN, IInboundRoutingPolicyService } from '@openlinker/core/sync';
import type { IInboundWebhookRoutingService } from '../interfaces/inbound-webhook-routing.service.interface';
import type { InboundWebhookRoutingOutcome } from '../types/inbound-webhook-routing.types';

@Injectable()
export class InboundWebhookRoutingService implements IInboundWebhookRoutingService {
  private readonly logger = new Logger(InboundWebhookRoutingService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN)
    private readonly translatorRegistry: WebhookEventTranslatorRegistryService,
    @Inject(INBOUND_ROUTING_POLICY_TOKEN)
    private readonly routingPolicy: IInboundRoutingPolicyService
  ) {}

  async resolveEvent(event: InboundWebhookEvent): Promise<InboundWebhookRoutingOutcome> {
    // Test/verification pings create no job but the delivery is still recorded
    // (status 'received') so the FE can surface "last test.ping at" (#168).
    if (event.eventType.startsWith('test.')) {
      return { kind: 'ping' };
    }

    // Resolve the connection + adapter metadata. A *permanent* config fault
    // dead-letters (a durable row now, not a Redis DLQ entry); any other
    // (transient) error rethrows so the source retries (ADR-015 invariant 3).
    let resolved;
    try {
      resolved = await this.integrationsService.getAdapter(event.connectionId);
    } catch (resolveError) {
      if (
        resolveError instanceof ConnectionNotFoundException ||
        resolveError instanceof ConnectionDisabledException
      ) {
        return { kind: 'unroutable', reason: `connection-unavailable: ${resolveError.message}` };
      }
      throw resolveError;
    }
    const { connection, metadata } = resolved;

    // Plugin translator by adapterKey — absent means this plugin doesn't
    // decode webhooks (poll-only).
    const translator = this.translatorRegistry.get(metadata.adapterKey);
    if (!translator) {
      return { kind: 'unroutable', reason: `no-translator: ${metadata.adapterKey}` };
    }

    const canonical = translator.translate(event);
    if (!canonical) {
      return {
        kind: 'unroutable',
        reason: `undecodable: objectType=${event.objectType}, eventType=${event.eventType}`,
      };
    }

    const resolution = this.routingPolicy.resolve(
      canonical,
      connection,
      metadata.supportedCapabilities,
      event.eventId
    );
    if (resolution.status === 'ungated') {
      return {
        kind: 'unroutable',
        reason: `ungated: ${canonical.domain} requires ${resolution.requiredCapability}`,
      };
    }

    this.logger.debug(
      `Resolved inbound ${canonical.domain} event ${event.eventId} → ${resolution.job.jobType}`
    );
    return { kind: 'routed', job: resolution.job };
  }
}
