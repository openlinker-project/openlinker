/**
 * Webhooks Core Module
 *
 * Provides persistence for inbound webhook delivery records. Kept in
 * `libs/core` so TypeORM migrations discover the ORM entity alongside the
 * rest of the platform schema.
 *
 * @module libs/core/src/webhooks
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookDeliveryOrmEntity } from './infrastructure/persistence/entities/webhook-delivery.orm-entity';
import { WebhookDeliveryRepository } from './infrastructure/persistence/repositories/webhook-delivery.repository';
import { WEBHOOK_DELIVERY_REPOSITORY_TOKEN } from './domain/ports/webhook-delivery-repository.port';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookDeliveryOrmEntity])],
  providers: [
    WebhookDeliveryRepository,
    { provide: WEBHOOK_DELIVERY_REPOSITORY_TOKEN, useExisting: WebhookDeliveryRepository },
  ],
  exports: [WEBHOOK_DELIVERY_REPOSITORY_TOKEN],
})
export class WebhooksCoreModule {}
