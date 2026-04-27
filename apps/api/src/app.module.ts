/**
 * Application Root Module
 *
 * Root NestJS module that configures and imports all application modules,
 * including database, Redis, scheduling, and core bounded contexts.
 * Serves as the entry point for dependency injection and module composition.
 *
 * @module apps/api/src
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from '@openlinker/shared/database';
import { RedisConfigModule } from '@openlinker/shared/redis';
import { CacheModule } from '@openlinker/shared/cache';
import { HealthModule } from './health/health.module';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { CustomersModule } from '@openlinker/core/customers';
import { ContentModule } from '@openlinker/core/content';
import { AiModule as CoreAiModule } from '@openlinker/core/ai';
import { AuthModule } from './auth/auth.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { SyncModule } from './sync/sync.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsApiModule } from './products/products.module';
import { CustomersApiModule } from './customers/customers.module';
import { ListingsApiModule } from './listings/listings.module';
import { CursorsModule } from './cursors/cursors.module';
import { MappingsApiModule } from './mappings/mappings.module';
import { AiApiModule } from './ai/ai.module';
import { ContentApiModule } from './content/content.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RedisConfigModule,
    CacheModule,
    HealthModule,
    AuthModule,
    IdentifierMappingModule,
    CustomersModule, // Import CustomersModule for customer identity resolution and projections
    IntegrationsModule,
    WebhooksModule,
    SyncModule,
    InventoryModule,
    OrdersModule,
    ProductsApiModule,
    CustomersApiModule,
    ListingsApiModule,
    CursorsModule,
    MappingsApiModule,
    ContentModule, // Product content draft buffer + reconcile + publish (#338)
    CoreAiModule, // Editable prompt-template storage + render service (#341)
    AiApiModule, // REST surface for prompt templates (#341)
    ContentApiModule, // REST surface for product content editor + AI suggest (#339 + #342)
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

