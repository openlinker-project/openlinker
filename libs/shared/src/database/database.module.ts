/**
 * Database Configuration Module
 *
 * Configures TypeORM connection to PostgreSQL database. Provides async
 * configuration using environment variables for database connection settings.
 *
 * Uses `autoLoadEntities: true` to automatically discover ORM entities registered
 * via `TypeOrmModule.forFeature([...])` in bounded context modules. This avoids
 * breaking domain boundaries by importing entities directly.
 *
 * This module is shared between apps/api and apps/worker to avoid cross-app dependencies.
 *
 * @module libs/shared/src/database
 * @see https://docs.nestjs.com/techniques/database NestJS Database documentation
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

/**
 * Connections one process may hold, and why the number is this one.
 *
 * The lane caps in ADR-050 decide how many handlers can run at once in one
 * worker: 4 realtime + 12 bulk + 2 fiscal + 8 fan-out = 26. Every one of them
 * does database work, and a few hold a transaction connection while issuing a
 * second pooled query (the order read model's line-item upsert, the webhook
 * gate), which deadlocks a pool with no spare. So the floor is one connection
 * per concurrent handler, plus headroom for that nesting and for the runner's
 * own claim and heartbeat queries.
 *
 * pg defaults to 10, which was below the 9 slots the lanes had before #2594 and
 * far below 26. Left at 10 the caps would appear to do nothing: pg's own
 * connection timeout defaults to 0, so an over-subscribed pool queues silently
 * instead of erroring.
 *
 * Both numbers bound ONE process. N worker replicas, and the api, each hold
 * their own pool, so the deployment total is this value times the process
 * count and must stay under the server's `max_connections`.
 */
const DB_POOL_MAX_DEFAULT = 40;

/**
 * Fail a starved pool instead of waiting on it forever.
 *
 * pg's default of 0 means "wait without limit", which turns pool exhaustion
 * into a stall with no error anywhere. A timeout surfaces it as a job failure
 * that walks the ordinary retry ladder and shows up on the jobs surface.
 */
const DB_POOL_CONNECTION_TIMEOUT_MS_DEFAULT = 10_000;

function readPositiveInt(configService: ConfigService, key: string, fallback: number): number {
  const raw = configService.get<string | number>(key);
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'postgres'),
        database: configService.get<string>('DB_DATABASE', 'openlinker'),
        // Use autoLoadEntities to automatically discover entities registered via
        // TypeOrmModule.forFeature([...]) in bounded context modules.
        // This avoids breaking domain boundaries by importing entities directly.
        autoLoadEntities: true,
        synchronize: configService.get<string>('NODE_ENV') !== 'production',
        logging: configService.get<string>('NODE_ENV') === 'development',
        // Migrations are not configured here because:
        // 1. migrationsRun: false - migrations are not auto-executed at startup
        // 2. Migrations are managed via CLI using apps/api/src/database/data-source.ts
        // 3. At runtime, TypeORM would try to load .ts files which Node.js can't execute
        // Migrations should be run explicitly via CLI before application startup
        migrationsRun: false,
        extra: {
          max: readPositiveInt(configService, 'OL_DB_POOL_MAX', DB_POOL_MAX_DEFAULT),
          connectionTimeoutMillis: readPositiveInt(
            configService,
            'OL_DB_POOL_CONNECTION_TIMEOUT_MS',
            DB_POOL_CONNECTION_TIMEOUT_MS_DEFAULT
          ),
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}

