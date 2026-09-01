/**
 * Sync API Module
 *
 * NestJS module for sync job management API endpoints. Imports core sync
 * module and registers the controller for job enqueueing and inspection.
 *
 * The SchedulerService moved to `apps/worker/src/scheduler/` (#2279,
 * ADR-051): scheduling is background work, and hosting it here made every
 * api replica a scheduler.
 *
 * @module apps/api/src/sync
 */
import { Module } from '@nestjs/common';
import { SyncModule as CoreSyncModule } from '@openlinker/core/sync';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { SyncController } from './http/sync.controller';
import { ConnectionSyncStatusController } from './http/connection-sync-status.controller';

@Module({
  imports: [
    CoreSyncModule, // Provides JobEnqueuePort
    IdentifierMappingModule, // Provides ConnectionPort
    IntegrationsModule, // Provides IIntegrationsService
  ],
  controllers: [SyncController, ConnectionSyncStatusController],
})
export class SyncModule {}

