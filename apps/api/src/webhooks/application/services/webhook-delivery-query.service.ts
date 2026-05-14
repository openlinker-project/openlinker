/**
 * Webhook Delivery Query Service
 *
 * Thin read-through service for the webhook-delivery visibility API. Delegates
 * to the repository port; kept as a service to enforce the interface boundary
 * and give us a place to add auth scoping or formatting later.
 *
 * @module apps/api/src/webhooks/application/services
 * @implements {IWebhookDeliveryQueryService}
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  PaginatedWebhookDeliveries,
  WebhookDelivery,
  WebhookDeliveryFilters,
  WebhookDeliveryPagination,
} from '@openlinker/core/webhooks';
import {
  WebhookDeliveryRepositoryPort,
  WEBHOOK_DELIVERY_REPOSITORY_TOKEN,
} from '@openlinker/core/webhooks';
import type { IWebhookDeliveryQueryService } from '../interfaces/webhook-delivery-query.service.interface';

@Injectable()
export class WebhookDeliveryQueryService implements IWebhookDeliveryQueryService {
  constructor(
    @Inject(WEBHOOK_DELIVERY_REPOSITORY_TOKEN)
    private readonly repository: WebhookDeliveryRepositoryPort
  ) {}

  list(
    filters: WebhookDeliveryFilters,
    pagination: WebhookDeliveryPagination
  ): Promise<PaginatedWebhookDeliveries> {
    return this.repository.findMany(filters, pagination);
  }

  getById(id: string): Promise<WebhookDelivery | null> {
    return this.repository.findById(id);
  }
}
