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
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MasterProductSyncByExternalIdPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
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
    private readonly masterProductSync: IMasterProductSyncService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    if (String(payload.objectType).toLowerCase() !== 'product') {
      throw new SyncJobExecutionError(
        `Invalid objectType for master product sync: ${String(payload.objectType)}. Expected 'Product'.`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    this.logger.log(
      `Executing master product sync job ${job.id} (connection: ${job.connectionId}, externalId: ${String(payload.externalId)})`
    );

    try {
      const result = await this.masterProductSync.syncFromMasterByExternalId(
        job.connectionId,
        payload.externalId
      );

      // A product deleted at the master is a terminal business outcome, not a
      // transient failure — return business_failure so the runner does NOT retry
      // a permanent condition (#1599, ADR-007). The variants were marked stale.
      if (result.masterDeleted) {
        this.logger.warn(
          `Master product sync: product deleted at master (job ${job.id}, connection: ${job.connectionId}, externalId: ${String(payload.externalId)})`
        );
        return { outcome: 'business_failure' };
      }

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Master product sync failed (externalId: ${String(payload.externalId)}): ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
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
      objectType: payload.objectType as 'Product',
    };
  }
}
