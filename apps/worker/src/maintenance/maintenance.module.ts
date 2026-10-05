/**
 * Maintenance Module
 *
 * NestJS module for the `maintenance` worker role (#2279, ADR-051): periodic
 * fleet hygiene that is neither job execution nor event consumption.
 * Occupants: stuck-job recovery (extracted from `SyncJobRunner` so a split
 * deployment can run it independently of the job runners) and, since #2946,
 * the `sync_jobs` retention sweep - ADR-051's own named example of the
 * "future destructive periodic work (retention sweeps, partition drops)"
 * this role exists for, and the first occupant to actually need the lease
 * the role was built to support.
 *
 * @module apps/worker/src/maintenance
 */
import { Module } from '@nestjs/common';
import { SyncModule as CoreSyncModule } from '@openlinker/core/sync';
import { OperationalSettingsModule } from '@openlinker/core/operational-settings';
import { StuckJobRecoveryService } from './stuck-job-recovery.service';
import { SyncJobRetentionService } from './sync-job-retention.service';

@Module({
  imports: [CoreSyncModule, OperationalSettingsModule],
  providers: [StuckJobRecoveryService, SyncJobRetentionService],
})
export class MaintenanceModule {}
