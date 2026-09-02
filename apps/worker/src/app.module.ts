/**
 * Worker Application Root Module
 *
 * Root NestJS module for the worker. Since #2279 (ADR-051) the worker boots a
 * ROLE SET (`OL_WORKER_ROLE`, default `all`): each role maps to a module
 * import, so a role that is off contributes no providers, no consumers, and
 * no timers — conditional imports at bootstrap, never runtime flags on an
 * already-booted graph.
 *
 * Roles:
 *  - `jobs`        → SyncWorkerModule (job intake + runner + handlers)
 *  - `events`      → EventsConsumerModule (domain-event stream consumers)
 *  - `scheduler`   → WorkerSchedulerModule (cron tasks, singleton via lease)
 *  - `maintenance` → MaintenanceModule (stuck-job recovery)
 *
 * The infrastructure spine (config, DB, Redis, cache, core contexts, plugin
 * registry) is shared by every role: plugins must register their adapters and
 * scheduler tasks whichever role is booted.
 *
 * @module apps/worker/src
 */
import type { DynamicModule, Type } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@openlinker/shared/cache';
import { DatabaseModule } from '@openlinker/shared/database';
import { RedisConfigModule } from '@openlinker/shared/redis';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { ProductsModule } from '@openlinker/core/products';
import { InventoryModule } from '@openlinker/core/inventory';
import { SyncModule } from '@openlinker/core/sync';
import { FulfillmentModule } from '@openlinker/core/fulfillment';
import { IntegrationsModule } from './integrations/integrations.module';
import { SyncWorkerModule } from './sync/sync-worker.module';
import { EventsConsumerModule } from './events/events-consumer.module';
import { WorkerSchedulerModule } from './scheduler/worker-scheduler.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { WorkerHeartbeatService } from './health/worker-heartbeat.service';
import type { WorkerRole } from './roles/worker-role.types';
import { WorkerRoleValues } from './roles/worker-role.types';

const ROLE_MODULES: Record<WorkerRole, Type<unknown>> = {
  jobs: SyncWorkerModule,
  events: EventsConsumerModule,
  scheduler: WorkerSchedulerModule,
  maintenance: MaintenanceModule,
};

@Module({})
export class AppModule {
  static forRoles(roles: readonly WorkerRole[] = WorkerRoleValues): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env.local', '.env'],
        }),
        DatabaseModule,
        RedisConfigModule,
        CacheModule,
        IdentifierMappingModule,
        CoreIntegrationsModule,
        IntegrationsModule,
        ProductsModule,
        InventoryModule,
        SyncModule,
        // #2392: the fulfillment persistence graph. Goes in the SHARED array
        // rather than ROLE_MODULES on purpose — entities registered per-role
        // would be invisible to `autoLoadEntities` under any other role set,
        // so the tables would exist for some workers and not others.
        FulfillmentModule,
        ...roles.map((role) => ROLE_MODULES[role]),
      ],
      providers: [WorkerHeartbeatService],
    };
  }
}
