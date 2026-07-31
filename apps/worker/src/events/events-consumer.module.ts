/**
 * Worker Events Consumer Module
 *
 * Houses stream consumers that translate core domain events into sync jobs
 * (the worker-side counterpart to `apps/api/src/webhooks`' inbound-webhook
 * consumer). Today: `MasterDeletionToJobHandler` (#1689).
 *
 * @module apps/worker/src/events
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisClientType } from 'redis';
import { createClient } from 'redis';
import { SyncModule } from '@openlinker/core/sync';
import { MasterDeletionToJobHandler } from './master-deletion-to-job.handler';
import { MASTER_DELETION_REDIS_CLIENT_BLOCKING_TOKEN } from './events.tokens';

@Module({
  imports: [SyncModule],
  providers: [
    MasterDeletionToJobHandler,
    {
      // Dedicated client for the blocking xReadGroup loop — must not share
      // with the worker's shared 'REDIS_CLIENT' (JobIntakeConsumer already
      // blocks on it; two XREADGROUP loops cannot share one connection).
      provide: MASTER_DELETION_REDIS_CLIENT_BLOCKING_TOKEN,
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
            `EventsConsumerModule: Failed to connect MASTER_DELETION_REDIS_CLIENT_BLOCKING: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        return client as RedisClientType;
      },
      inject: [ConfigService],
    },
  ],
})
export class EventsConsumerModule {}
