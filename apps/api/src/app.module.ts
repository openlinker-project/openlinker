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
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RedisConfigModule,
    IdentifierMappingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

