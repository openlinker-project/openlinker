/**
 * Master Inventory Sync Handler (Generic)
 *
 * Thin delegate for jobs of type 'master.inventory.syncByExternalId'.
 * Legacy job types (e.g., 'prestashop.inventory.syncByExternalId') should be aliased
 * to this handler during migration.
 *
 * @module apps/worker/src/sync/handlers
 */

import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MasterInventorySyncByExternalIdPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IMasterInventorySyncService,
  MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/inventory';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MasterInventorySyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(MasterInventorySyncHandler.name);

  constructor(
    @Inject(MASTER_INVENTORY_SYNC_SERVICE_TOKEN)
    private readonly masterInventorySync: IMasterInventorySyncService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    if (!['inventory', 'product'].includes(String(payload.objectType).toLowerCase())) {
      throw new SyncJobExecutionError(
        `Invalid objectType for master inventory sync: ${String(payload.objectType)}. Expected 'Inventory' or 'Product'.`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    this.logger.log(
      `Executing master inventory sync job ${job.id} (connection: ${job.connectionId}, externalId: ${String(payload.externalId)})`
    );

    try {
      const result = await this.masterInventorySync.syncFromMasterByExternalId(
        job.connectionId,
        payload.externalId
      );

      // The staleness prune was withheld because a second InventoryMaster
      // connection claims the same internal product id (#1904). Not a business
      // failure on its own - the canonical writes (or the deletion signal below)
      // still stand; it needs operator attention, so it is logged with job
      // context.
      if (result.pruneSkipped) {
        this.logger.warn(
          `Master inventory sync: staleness prune skipped - internal product id claimed by more than one InventoryMaster connection (job ${job.id}, connection: ${job.connectionId}, externalId: ${String(payload.externalId)}, internalProductId: ${result.internalProductId})`
        );
      }

      // A product deleted at the master is a terminal business outcome, not a
      // transient failure — return business_failure so the runner does NOT retry
      // a permanent condition (#1688, mirrors MasterProductSyncHandler / #1599,
      // ADR-007). The inventory rows were marked stale.
      if (result.masterDeleted) {
        this.logger.warn(
          `Master inventory sync: product deleted at master (job ${job.id}, connection: ${job.connectionId}, externalId: ${String(payload.externalId)})`
        );
        return { outcome: 'business_failure' };
      }

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Master inventory sync failed (externalId: ${String(payload.externalId)}): ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MasterInventorySyncByExternalIdPayloadV1 {
    const payload = job.payload as unknown as Partial<MasterInventorySyncByExternalIdPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (!payload.externalId || typeof payload.externalId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid externalId in job payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (!payload.objectType || typeof payload.objectType !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid objectType in job payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return {
      schemaVersion: 1,
      externalId: payload.externalId,
      objectType: payload.objectType,
    };
  }
}
