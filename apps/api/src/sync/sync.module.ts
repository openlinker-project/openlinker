/**
 * Sync API Module
 *
 * NestJS module for sync job management API endpoints. Imports core sync
 * module and registers controllers and services for job enqueueing and
 * scheduled polling.
 *
 * @module apps/api/src/sync
 */
import { Module } from '@nestjs/common';
import { SyncModule as CoreSyncModule } from '@openlinker/core/sync';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { SyncController } from './http/sync.controller';
import { SchedulerService } from './application/services/scheduler.service';

@Module({
  imports: [
    CoreSyncModule, // Provides JobEnqueuePort
    IdentifierMappingModule, // Provides ConnectionPort
  ],
  controllers: [SyncController],
  providers: [SchedulerService],
})
export class SyncModule {}

