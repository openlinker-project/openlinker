/**
 * Master Product Sync Handler (Generic)
 *
 * Thin delegate for jobs of type 'master.product.syncByExternalId'.
 * Legacy job types (e.g., 'prestashop.product.syncByExternalId') should be aliased
 * to this handler during migration.
 *
 * @module apps/worker/src/sync/handlers
 */

import { Injectable, Inject } from '@nestjs/common';
import {
  SyncJobHandler,
  SyncJob as SyncJobEntity,
  SyncJobExecutionError,
  MasterProductSyncByExternalIdPayloadV1,
} from '@openlinker/core/sync';
import {
  IMasterProductSyncService,
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MasterProductSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(MasterProductSyncHandler.name);

  constructor(
    @Inject(MASTER_PRODUCT_SYNC_SERVICE_TOKEN)
    private readonly masterProductSync: IMasterProductSyncService,
  ) {}

  async execute(job: SyncJob): Promise<void> {
    const payload = this.getPayload(job);

    if (payload.objectType !== 'Product') {
      throw new SyncJobExecutionError(
        `Invalid objectType for master product sync: ${String(payload.objectType)}. Expected 'Product'.`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    this.logger.log(
      `Executing master product sync job ${job.id} (connection: ${job.connectionId}, externalId: ${String(payload.externalId)})`,
    );

    try {
      await this.masterProductSync.syncFromMasterByExternalId(job.connectionId, payload.externalId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Master product sync failed (externalId: ${String(payload.externalId)}): ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): MasterProductSyncByExternalIdPayloadV1 {
    const payload = job.payload as unknown as Partial<MasterProductSyncByExternalIdPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    if (!payload.externalId || typeof payload.externalId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid externalId in job payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    if (!payload.objectType || typeof payload.objectType !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid objectType in job payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    return {
      schemaVersion: 1,
      externalId: payload.externalId,
      objectType: payload.objectType as 'Product',
    };
  }
}

