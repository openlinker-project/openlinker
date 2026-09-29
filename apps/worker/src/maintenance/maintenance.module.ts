/**
 * Maintenance Module
 *
 * NestJS module for the `maintenance` worker role (#2279, ADR-051): periodic
 * fleet hygiene that is neither job execution nor event consumption.
 * Occupants: stuck-job recovery (extracted from `SyncJobRunner` so a split
 * deployment can run it independently of the job runners) and, since the
 * #3534 recovery pass, the `order_exports` file-retention sweep — ADR-051's
 * own named example of the "future destructive periodic work (retention
 * sweeps, partition drops)" this role exists for.
 *
 * @module apps/worker/src/maintenance
 */
import { Module } from '@nestjs/common';
import { SyncModule as CoreSyncModule } from '@openlinker/core/sync';
import { OrdersModule as CoreOrdersModule } from '@openlinker/core/orders';
import { StuckJobRecoveryService } from './stuck-job-recovery.service';
import { OrderExportRetentionService } from './order-export-retention.service';

@Module({
  imports: [CoreSyncModule, CoreOrdersModule],
  providers: [StuckJobRecoveryService, OrderExportRetentionService],
})
export class MaintenanceModule {}
