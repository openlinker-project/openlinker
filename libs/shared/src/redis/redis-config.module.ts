/**
 * Redis Configuration Module
 *
 * Configures Redis connection for caching and event bus. Provides async
 * configuration using environment variables for Redis connection settings.
 * Used for distributed caching and Redis Streams-based event messaging.
 *
 * This module is shared between apps/api and apps/worker to avoid cross-app dependencies.
 *
 * @module libs/shared/src/redis
 */
import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { RedisClientType } from 'redis';
import { createClient } from 'redis';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: async (configService: ConfigService): Promise<RedisClientType> => {
        const client = createClient({
          socket: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
          },
          password: configService.get<string>('REDIS_PASSWORD'),
          database: configService.get<number>('REDIS_DB', 0),
        });

        await client.connect();
        return client as RedisClientType;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisConfigModule {}
