/**
 * Bulk Shop Publish Retry Service (#1845)
 *
 * Re-runs the failed children of a shop-publish `BulkListingBatch`. The
 * shop-side sibling of `BulkListingRetryService` (#742). Owns the counter-reopen
 * policy: deletes per-record `bulk_batch_advancements` rows, decrements
 * `failedCount` per record (lock-stepped to the reset), transitions a
 * terminal-state batch back to `'running'` after the loop, and enqueues fresh
 * `shop.product.publish` V2 jobs with a wave-distinct idempotency key.
 *
 * Direct dependency on `JobEnqueuePort` (not `IProductPublishEnqueueService`):
 * the enqueue service always creates a NEW `ListingCreationRecord`; the retry
 * path reuses the existing failed record post-reset and rebuilds the V2 payload
 * inline from the record's persisted `request` snapshot.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IBulkShopPublishRetryService}
 */
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  type ShopProductPublishPayloadV2,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import type { ShopProductManagerPort } from '@openlinker/core/listings';

import { BulkListingBatchNotFoundException } from '../../domain/exceptions/bulk-listing-batch-not-found.exception';
import { BulkRetryMissingSnapshotException } from '../../domain/exceptions/bulk-retry-missing-snapshot.exception';
import { NoFailedChildrenToRetryException } from '../../domain/exceptions/no-failed-children-to-retry.exception';
import { BulkBatchAdvancementRepositoryPort } from '../../domain/ports/bulk-batch-advancement-repository.port';
import { BulkListingBatchRepositoryPort } from '../../domain/ports/bulk-listing-batch-repository.port';
import { ListingCreationRecordRepositoryPort } from '../../domain/ports/listing-creation-record-repository.port';
import {
  BULK_BATCH_STATUS,
  type BulkBatchStatus,
} from '../../domain/types/bulk-listing-batch.types';
import { LISTING_CREATION_STATUS } from '../../domain/types/listing-creation-record.types';
import {
  BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN,
  BULK_LISTING_BATCH_REPOSITORY_TOKEN,
  LISTING_CREATION_RECORD_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { IBulkShopPublishRetryService } from '../interfaces/bulk-shop-publish-retry.service.interface';
import type { BulkShopPublishRetryResult } from '../types/bulk-shop-publish-retry.types';

@Injectable()
export class BulkShopPublishRetryService implements IBulkShopPublishRetryService {
  private readonly logger = new Logger(BulkShopPublishRetryService.name);

  constructor(
    @Inject(BULK_LISTING_BATCH_REPOSITORY_TOKEN)
    private readonly bulkBatchRepository: BulkListingBatchRepositoryPort,
    @Inject(LISTING_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly listingRecords: ListingCreationRecordRepositoryPort,
    @Inject(BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN)
    private readonly advancementRepository: BulkBatchAdvancementRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
  ) {}

  async retryFailed(batchId: string): Promise<BulkShopPublishRetryResult> {
    // 1. Verify batch exists.
    const batch = await this.bulkBatchRepository.findById(batchId);
    if (!batch) {
      throw new BulkListingBatchNotFoundException(batchId);
    }

    // 2. Load children + filter to failed (ordered createdAt ASC).
    const allChildren = await this.listingRecords.findByBulkBatchId(batchId);
    const failedChildren = allChildren.filter(
      (r) => r.status === LISTING_CREATION_STATUS.Failed,
    );
    if (failedChildren.length === 0) {
      throw new NoFailedChildrenToRetryException(batchId);
    }

    // 3. Capability check fail-fast (before any state mutation). Resolving the
    //    `ProductPublisher` adapter surfaces the connection-failure cascade
    //    (not found / disabled / capability unsupported) so a downgraded
    //    connection fails identically to the submit path.
    await this.integrationsService.getCapabilityAdapter<ShopProductManagerPort>(
      batch.connectionId,
      'ProductPublisher',
    );

    const retryWaveId = randomUUID();
    this.logger.log(
      `Retrying ${failedChildren.length} failed shop-publish records on batch ${batchId} (waveId=${retryWaveId})`,
    );

    // 4. Fan out per record. Critical ordering (a)->(b)->(c)->(d), mirrors the
    //    offer retry: open the advancement gate, reset the record, decrement the
    //    counter in lock-step, then hand off the job last so a mid-loop throw
    //    leaves state recoverable.
    const retriedRecordIds: string[] = [];
    for (const record of failedChildren) {
      const snapshot = record.request;
      if (!snapshot) {
        // Documented invariant: every bulk-batch child carries a `request`
        // snapshot (persisted at enqueue). A null here is a backfill / migration
        // gap - surface as a typed exception so the runner classifies it
        // non-retryable rather than silently skipping and lying to the operator.
        throw new BulkRetryMissingSnapshotException(record.id, batchId);
      }

      // (a) Open the advancement gate.
      await this.advancementRepository.deleteForRecord(batchId, record.id);
      // (b) Reset record to 'pending' (clears externalProductId / errors / warnings).
      await this.listingRecords.resetForRetry(record.id);
      // (c) Decrement failedCount in lock-step.
      await this.bulkBatchRepository.incrementCounters(batchId, { failed: -1 });

      const payload = {
        schemaVersion: 2 as const,
        internalVariantId: snapshot.internalVariantId,
        status: snapshot.status,
        stock: snapshot.stock,
        bulkBatchId: batchId,
        listingCreationRecordId: record.id,
        ...(snapshot.price !== undefined && { price: snapshot.price }),
        ...(snapshot.destinationCategoryIds !== undefined && {
          destinationCategoryIds: snapshot.destinationCategoryIds,
        }),
        ...(snapshot.content !== undefined && { content: snapshot.content }),
        ...(snapshot.commerce !== undefined && { commerce: snapshot.commerce }),
        ...(snapshot.parameters !== undefined && { parameters: snapshot.parameters }),
      } satisfies ShopProductPublishPayloadV2;

      const idempotencyKey = `bulk-publish:${batchId}:variant:${snapshot.internalVariantId}:retry:${retryWaveId}`;

      // (d) Hand the job off last.
      await this.jobEnqueue.enqueueJob({
        jobType: 'shop.product.publish',
        connectionId: batch.connectionId,
        idempotencyKey,
        payload,
      });

      retriedRecordIds.push(record.id);
    }

    // 5. Single status flip after the loop if the batch was terminal.
    if (this.isTerminalStatus(batch.status)) {
      await this.bulkBatchRepository.updateStatus(batchId, BULK_BATCH_STATUS.Running);
    }

    return {
      retriedCount: retriedRecordIds.length,
      retriedRecordIds,
      retryWaveId,
      batchStatus: BULK_BATCH_STATUS.Running,
    };
  }

  private isTerminalStatus(status: BulkBatchStatus): boolean {
    return (
      status === BULK_BATCH_STATUS.Completed ||
      status === BULK_BATCH_STATUS.PartiallyFailed ||
      status === BULK_BATCH_STATUS.Failed
    );
  }
}
