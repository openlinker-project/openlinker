/**
 * Webhooks Core Module
 *
 * Provides persistence for inbound webhook delivery records and the
 * per-connection auth-rejection signal (#1814). Kept in `libs/core` so TypeORM
 * migrations discover the ORM entities alongside the rest of the platform schema.
 *
 * @module libs/core/src/webhooks
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookDeliveryOrmEntity } from './infrastructure/persistence/entities/webhook-delivery.orm-entity';
import { WebhookAuthRejectionOrmEntity } from './infrastructure/persistence/entities/webhook-auth-rejection.orm-entity';
import { WebhookDeliveryRepository } from './infrastructure/persistence/repositories/webhook-delivery.repository';
import { WebhookAuthRejectionRepository } from './infrastructure/persistence/repositories/webhook-auth-rejection.repository';
import {
  WEBHOOK_DELIVERY_REPOSITORY_TOKEN,
  WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN,
} from './webhooks.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookDeliveryOrmEntity, WebhookAuthRejectionOrmEntity]),
  ],
  providers: [
    WebhookDeliveryRepository,
    { provide: WEBHOOK_DELIVERY_REPOSITORY_TOKEN, useExisting: WebhookDeliveryRepository },
    WebhookAuthRejectionRepository,
    {
      provide: WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN,
      useExisting: WebhookAuthRejectionRepository,
    },
  ],
  exports: [WEBHOOK_DELIVERY_REPOSITORY_TOKEN, WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN],
})
export class WebhooksCoreModule {}
