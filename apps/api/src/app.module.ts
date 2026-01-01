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
import { DatabaseModule } from './database/database.module';
import { RedisConfigModule } from './redis/redis-config.module';
import { HealthModule } from './health/health.module';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { IntegrationsModule } from './integrations/integrations.module';
import { WebhooksModule } from './webhooks/webhooks.module';

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
    IdentifierMappingModule,
    IntegrationsModule,
    WebhooksModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

