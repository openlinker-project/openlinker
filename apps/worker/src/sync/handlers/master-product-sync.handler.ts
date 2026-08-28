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
import {
  SyncJobExecutionError,
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
} from '@openlinker/core/sync';
import {
  IMasterProductSyncService,
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/products';
import {
  IdentifierMappingQueryPort,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { propagateTaxRateChanges } from './tax-rate-propagation';

type SyncJob = SyncJobEntity;

@Injectable()
export class MasterProductSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(MasterProductSyncHandler.name);

  constructor(
    @Inject(MASTER_PRODUCT_SYNC_SERVICE_TOKEN)
    private readonly masterProductSync: IMasterProductSyncService,
    // #2263 - the propagation is an outbound offer write, so it is enqueued
    // here rather than inside the products context (which has no `sync` edge).
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    // The narrow QUERY port: this handler only reads which offers a variant has.
    private readonly identifierMapping: IdentifierMappingQueryPort
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

      // The staleness prune did not run. Two causes with completely different
      // remediations, so they are reported as different lines rather than one
      // ambiguous "prune skipped" (#2222): a #1904 collision needs the operator
      // to resolve which connection owns the id, while a zero-variant response
      // needs nothing at all unless it persists, in which case the master is
      // flaky. Neither is a business failure - the upserts (or the deletion
      // signal below) still stand.
      if (result.pruneSkippedReason === 'rival') {
        this.logger.warn(
          `Master product sync: staleness prune skipped - internal product id claimed by more than one ProductMaster connection (job ${job.id}, connection: ${job.connectionId}, externalId: ${String(payload.externalId)}, internalProductId: ${result.internalProductId})`
        );
      } else if (result.pruneSkippedReason === 'empty-response') {
        this.logger.warn(
          `Master product sync: staleness prune skipped - the master returned zero variants for an existing product, which is ambiguous enough that pruning would risk staling every variant (job ${job.id}, connection: ${job.connectionId}, externalId: ${String(payload.externalId)}, internalProductId: ${result.internalProductId})`
        );
      }

      // A product deleted at the master is a terminal business outcome, not a
      // transient failure — return business_failure so the runner does NOT retry
      // a permanent condition (#1599, ADR-007). The variants were marked stale.
      if (result.masterDeleted) {
        this.logger.warn(
          `Master product sync: product deleted at master (job ${job.id}, connection: ${job.connectionId}, externalId: ${String(payload.externalId)})`
        );
        return { outcome: 'business_failure', outcomeReason: 'master_deleted' };
      }

      // #2263 (ADR-063): the shop is the authority, so a rate it just changed is
      // pushed onto the offers already selling under the old one. Strictly after
      // the sync and outside its try: a propagation failure must not turn a
      // completed catalogue sync into a retried one, and the next change (or the
      // next sweep that observes one) enqueues again.
      await propagateTaxRateChanges(
        {
          jobEnqueue: this.jobEnqueue,
          identifierMapping: this.identifierMapping,
          logger: this.logger,
        },
        job.connectionId,
        result.taxRateChanges
      );

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
