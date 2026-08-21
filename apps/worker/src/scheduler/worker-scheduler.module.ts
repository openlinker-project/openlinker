/**
 * Worker Scheduler Module
 *
 * NestJS module for the `scheduler` worker role (#2279, ADR-051): the moved
 * `SchedulerService` (previously an api-hosted provider), `@nestjs/schedule`'s
 * `SchedulerRegistry`, and the `SchedulerLeaseCoordinator` that serializes the
 * fleet onto one active scheduler via the `singleton:scheduler` lease.
 *
 * Imported only when the booted role set includes `scheduler`
 * (`AppModule.forRoles`) — a worker without the role carries no cron machinery
 * at all.
 *
 * @module apps/worker/src/scheduler
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SyncModule as CoreSyncModule } from '@openlinker/core/sync';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { SchedulerService } from './scheduler.service';
import { SchedulerLeaseCoordinator } from './scheduler-lease.coordinator';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CoreSyncModule, // JobEnqueuePort + SchedulerTaskRegistry + SyncLockPort
    IdentifierMappingModule, // ConnectionPort
    CoreIntegrationsModule, // IIntegrationsService (capability-based fan-out)
  ],
  providers: [SchedulerService, SchedulerLeaseCoordinator],
})
export class WorkerSchedulerModule {}
