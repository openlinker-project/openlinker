/**
 * Webhook Status Service
 *
 * Derives the operator-facing inbound-webhook status for a connection (#1770)
 * from the latest recorded delivery, the durable auth-rejection signal (#1814),
 * and whether a signing secret is stored. Read-only projection: OpenLinker
 * cannot query a platform's subscription state, so activation is inferred from
 * delivery + rejection history (see type docs).
 *
 * @module apps/api/src/integrations/application/services
 * @implements {IWebhookStatusService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConnectionPort, CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import {
  WebhookSecretProviderPort,
  WEBHOOK_SECRET_PROVIDER_TOKEN,
} from '@openlinker/core/integrations';
import {
  WebhookAuthRejectionRepositoryPort,
  WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN,
} from '@openlinker/core/webhooks';
import {
  WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN,
  type IWebhookDeliveryQueryService,
} from '@openlinker/api/webhooks/application/interfaces/webhook-delivery-query.service.interface';
import type { IWebhookStatusService } from '../interfaces/webhook-status.service.interface';
import type { WebhookActivation, WebhookStatus } from '../types/webhook-status.types';

/**
 * A rejection older than this stops driving `auth-failing`: if deliveries have
 * quietly stopped (integration abandoned), the connection reverts to
 * `not-registered` rather than raising a permanent stale alarm. Sized to a day
 * so a nightly-batch integration that fails every night still reads as failing.
 */
const AUTH_REJECTION_FRESHNESS_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class WebhookStatusService implements IWebhookStatusService {
  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(WEBHOOK_SECRET_PROVIDER_TOKEN)
    private readonly secretProvider: WebhookSecretProviderPort,
    @Inject(WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN)
    private readonly deliveryQuery: IWebhookDeliveryQueryService,
    @Inject(WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN)
    private readonly authRejectionRepository: WebhookAuthRejectionRepositoryPort
  ) {}

  async getStatus(connectionId: string): Promise<WebhookStatus> {
    const connection = await this.connectionPort.get(connectionId);
    const provider = connection.platformType;

    const [page, hasSecret, rejection] = await Promise.all([
      this.deliveryQuery.list({ provider, connectionId }, { limit: 1, offset: 0 }),
      this.secretProvider.has(provider, connectionId),
      this.authRejectionRepository.find(provider, connectionId),
    ]);

    const latest = page.items[0] ?? null;
    const lastDeliveryAt = latest ? latest.receivedAt : null;

    return {
      activation: this.deriveActivation(lastDeliveryAt, rejection?.lastRejectedAt ?? null),
      signature: hasSecret ? 'configured' : 'off',
      lastDeliveryAt: lastDeliveryAt ? lastDeliveryAt.toISOString() : null,
      lastDeliveryEvent: latest?.eventType ?? null,
      lastDeliveryResult: latest?.status ?? null,
    };
  }

  /**
   * Precedence (#1814): a recent auth rejection with no newer verified delivery
   * → `auth-failing`; else any verified delivery → `verified`; else
   * `not-registered`. Comparing rejection recency against the last delivery is
   * what makes the state self-heal when the operator fixes the secret.
   */
  private deriveActivation(
    lastDeliveryAt: Date | null,
    lastRejectedAt: Date | null,
    now: Date = new Date()
  ): WebhookActivation {
    if (lastRejectedAt) {
      const isRecent = now.getTime() - lastRejectedAt.getTime() <= AUTH_REJECTION_FRESHNESS_MS;
      const newerThanDelivery =
        lastDeliveryAt === null || lastRejectedAt.getTime() > lastDeliveryAt.getTime();
      if (isRecent && newerThanDelivery) {
        return 'auth-failing';
      }
    }
    return lastDeliveryAt ? 'verified' : 'not-registered';
  }
}
