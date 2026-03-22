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
import { HealthModule } from './health/health.module';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { CustomersModule } from '@openlinker/core/customers';
import { AuthModule } from './auth/auth.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RedisConfigModule,
    HealthModule,
    AuthModule,
    IdentifierMappingModule,
    CustomersModule, // Import CustomersModule for customer identity resolution and projections
    IntegrationsModule,
    WebhooksModule,
    SyncModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

