/**
 * Webhook Status Service
 *
 * Derives the operator-facing inbound-webhook status for a connection (#1770)
 * from the latest recorded delivery plus whether a signing secret is stored.
 * Read-only projection: OpenLinker cannot query a platform's subscription
 * state, so activation is inferred from delivery history (see type docs).
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
import type { IWebhookStatusService } from '../interfaces/webhook-status.service.interface';
import type { WebhookStatus } from '../types/webhook-status.types';
import {
  WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN,
  type IWebhookDeliveryQueryService,
} from '../../../webhooks/application/interfaces/webhook-delivery-query.service.interface';

@Injectable()
export class WebhookStatusService implements IWebhookStatusService {
  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(WEBHOOK_SECRET_PROVIDER_TOKEN)
    private readonly secretProvider: WebhookSecretProviderPort,
    @Inject(WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN)
    private readonly deliveryQuery: IWebhookDeliveryQueryService
  ) {}

  async getStatus(connectionId: string): Promise<WebhookStatus> {
    const connection = await this.connectionPort.get(connectionId);
    const provider = connection.platformType;

    const [page, hasSecret] = await Promise.all([
      this.deliveryQuery.list({ provider, connectionId }, { limit: 1, offset: 0 }),
      this.secretProvider.has(provider, connectionId),
    ]);

    const latest = page.items[0] ?? null;

    return {
      activation: latest ? 'verified' : 'not-registered',
      signature: !hasSecret
        ? 'off'
        : latest?.signatureValid === false
          ? 'mismatch'
          : 'configured',
      lastDeliveryAt: latest ? latest.receivedAt.toISOString() : null,
      lastDeliveryEvent: latest?.eventType ?? null,
      lastDeliveryResult: latest?.status ?? null,
    };
  }
}
