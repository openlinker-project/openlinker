/**
 * Webhooks Module
 *
 * NestJS module for webhook ingestion functionality. Configures webhook controller,
 * services, middleware, and dependency injection. Imports core modules for events,
 * integrations, and connections.
 *
 * @module apps/api/src/webhooks
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisClientType } from 'redis';
import { createClient } from 'redis';
import { EventsModule } from '@openlinker/core/events';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { SyncModule } from '@openlinker/core/sync';
import { WebhooksCoreModule } from '@openlinker/core/webhooks';
import { WebhookController } from './http/webhook.controller';
import { WebhookDeliveryController } from './http/webhook-delivery.controller';
import { WebhookService } from './application/services/webhook.service';
import { WebhookAuthService } from './application/services/webhook-auth.service';
import { WebhookDedupService } from './application/services/webhook-dedup.service';
import { WebhookEventPublisher } from './application/services/webhook-event-publisher.service';
import { WebhookDeliveryQueryService } from './application/services/webhook-delivery-query.service';
import { WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN } from './application/interfaces/webhook-delivery-query.service.interface';
import { WebhookToJobHandler } from './application/handlers/webhook-to-job.handler';
import { REDIS_CLIENT_BLOCKING_TOKEN } from './webhooks.tokens';

/**
 * Webhooks Module
 *
 * Note: Raw body capture for webhook signature verification is handled at the
 * application level in main.ts using express.json() with verify hook for /webhooks routes.
 * This ensures the verify hook fires before any other body parsing.
 */
@Module({
  imports: [
    EventsModule, // For EventPublisherPort
    IntegrationsModule, // For WebhookSecretProviderPort
    IdentifierMappingModule, // For ConnectionPort
    SyncModule, // For JobEnqueuePort
    WebhooksCoreModule, // For WebhookDeliveryRepositoryPort
  ],
  controllers: [WebhookController, WebhookDeliveryController],
  providers: [
    WebhookService,
    WebhookAuthService,
    WebhookDedupService,
    WebhookEventPublisher,
    WebhookDeliveryQueryService,
    { provide: WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN, useExisting: WebhookDeliveryQueryService },
    WebhookToJobHandler,
    {
      // Dedicated client for blocking xReadGroup loop — must not share with health check client
      provide: REDIS_CLIENT_BLOCKING_TOKEN,
      useFactory: async (configService: ConfigService): Promise<RedisClientType> => {
        const client = createClient({
          socket: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
          },
          password: configService.get<string>('REDIS_PASSWORD'),
          database: configService.get<number>('REDIS_DB', 0),
        });
        try {
          await client.connect();
        } catch (error) {
          throw new Error(
            `WebhooksModule: Failed to connect REDIS_CLIENT_BLOCKING: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        return client as RedisClientType;
      },
      inject: [ConfigService],
    },
  ],
})
export class WebhooksModule {}
