/**
 * Redis Configuration Module
 *
 * Configures Redis connection for caching and event bus. Provides async
 * configuration using environment variables for Redis connection settings.
 * Used for distributed caching and Redis Streams-based event messaging.
 *
 * @module apps/api/src/redis
 */
import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs/redis';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        config: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD'),
          db: configService.get<number>('REDIS_DB', 0),
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class RedisConfigModule {}

