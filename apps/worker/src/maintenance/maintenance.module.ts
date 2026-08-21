/**
 * Maintenance Module
 *
 * NestJS module for the `maintenance` worker role (#2279, ADR-051): periodic
 * fleet hygiene that is neither job execution nor event consumption. First
 * occupant: stuck-job recovery, extracted from `SyncJobRunner` so a
 * split deployment can run it independently of the job runners.
 *
 * @module apps/worker/src/maintenance
 */
import { Module } from '@nestjs/common';
import { SyncModule as CoreSyncModule } from '@openlinker/core/sync';
import { StuckJobRecoveryService } from './stuck-job-recovery.service';

@Module({
  imports: [CoreSyncModule],
  providers: [StuckJobRecoveryService],
})
export class MaintenanceModule {}
