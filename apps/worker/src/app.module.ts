/**
 * Worker Application Root Module
 *
 * Root NestJS module that configures and imports all modules required for
 * the worker application, including database, Redis, and sync job processing.
 *
 * @module apps/worker/src
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@openlinker/shared/database';
import { RedisConfigModule } from '@openlinker/shared/redis';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { PrestashopIntegrationModule } from '@openlinker/integrations-prestashop';
import { AllegroIntegrationModule } from '@openlinker/integrations-allegro';
import { ProductsModule } from '@openlinker/core/products';
import { InventoryModule } from '@openlinker/core/inventory';
import { SyncModule } from '@openlinker/core/sync';
import { SyncWorkerModule } from './sync/sync-worker.module';
import { WorkerHeartbeatService } from './health/worker-heartbeat.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    RedisConfigModule,
    IdentifierMappingModule,
    CoreIntegrationsModule,
    PrestashopIntegrationModule, // Register PrestaShop adapter factory
    AllegroIntegrationModule, // Register Allegro adapter factory
    ProductsModule,
    InventoryModule,
    SyncModule,
    SyncWorkerModule,
  ],
  providers: [WorkerHeartbeatService],
})
export class AppModule {}

