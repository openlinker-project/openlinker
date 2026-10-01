/**
 * Maintenance Module
 *
 * NestJS module for the `maintenance` worker role (#2279, ADR-051): periodic
 * fleet hygiene that is neither job execution nor event consumption.
 * Occupants: stuck-job recovery (extracted from `SyncJobRunner` so a split
 * deployment can run it independently of the job runners) and, since the
 * #3534 recovery pass, the `order_exports` file-retention sweep — ADR-051's
 * own named example of the "future destructive periodic work (retention
 * sweeps, partition drops)" this role exists for. Since #3507 G03-14 it also
 * runs the `order_records.searchText` reindex that takes buyer personal data
 * out of the search index once `OL_STORE_PII` is off.
 *
 * @module apps/worker/src/maintenance
 */
import { Module } from '@nestjs/common';
import { SyncModule as CoreSyncModule } from '@openlinker/core/sync';
import { OrdersModule as CoreOrdersModule } from '@openlinker/core/orders';
import { StuckJobRecoveryService } from './stuck-job-recovery.service';
import { OrderExportRetentionService } from './order-export-retention.service';
import { OrderSearchTextReindexSweepService } from './order-search-text-reindex-sweep.service';

@Module({
  imports: [CoreSyncModule, CoreOrdersModule],
  providers: [
    StuckJobRecoveryService,
    OrderExportRetentionService,
    OrderSearchTextReindexSweepService,
  ],
})
export class MaintenanceModule {}
