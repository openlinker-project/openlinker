/**
 * Bulk Shop Publish Submit Service (#1044)
 *
 * Bulk shop-publish orchestration. Validates the connection's `ProductPublisher`
 * capability once up front, persists the parent `BulkListingBatch`, fans N
 * enqueues out through the single-publish `IProductPublishEnqueueService` (each
 * carrying `bulkBatchId`), then transitions the batch `pending → running`.
 * Reuses the child-type-agnostic batch aggregate + progress + advancement the
 * marketplace bulk-offer flow uses — only the child type differs
 * (`ListingCreationRecord` vs `OfferCreationRecord`).
 *
 * @module libs/core/src/listings/application/services
 * @implements {IBulkShopPublishSubmitService}
 */

import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import type { ShopProductManagerPort } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';

import type { BulkListingBatch } from '../../domain/entities/bulk-listing-batch.entity';
import { EmptyBulkSubmissionException } from '../../domain/exceptions/empty-bulk-submission.exception';
import { BulkListingBatchRepositoryPort } from '../../domain/ports/bulk-listing-batch-repository.port';
import { ListingCreationRecordRepositoryPort } from '../../domain/ports/listing-creation-record-repository.port';
import { BULK_BATCH_STATUS, type BulkBatchStatus } from '../../domain/types/bulk-listing-batch.types';
import {
  BULK_LISTING_BATCH_REPOSITORY_TOKEN,
  LISTING_CREATION_RECORD_REPOSITORY_TOKEN,
  PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN,
} from '../../listings.tokens';
import type { IBulkShopPublishSubmitService } from '../interfaces/bulk-shop-publish-submit.service.interface';
import { IProductPublishEnqueueService } from '../interfaces/product-publish-enqueue.service.interface';
import type {
  BulkShopPublishBatchSummary,
  BulkShopPublishItem,
  BulkShopPublishSubmitInput,
  BulkShopPublishSubmitResult,
} from '../types/bulk-shop-publish-submit.types';

@Injectable()
export class BulkShopPublishSubmitService implements IBulkShopPublishSubmitService {
  private readonly logger = new Logger(BulkShopPublishSubmitService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(BULK_LISTING_BATCH_REPOSITORY_TOKEN)
    private readonly bulkBatchRepository: BulkListingBatchRepositoryPort,
    @Inject(PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN)
    private readonly enqueue: IProductPublishEnqueueService,
    @Inject(LISTING_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly listingRecords: ListingCreationRecordRepositoryPort,
  ) {}

  async submit(input: BulkShopPublishSubmitInput): Promise<BulkShopPublishSubmitResult> {
    if (input.items.length === 0) {
      throw new EmptyBulkSubmissionException();
    }

    // 1. Validate the capability once up front so the whole batch fails fast
    //    (rather than N times) when the connection can't publish.
    await this.integrationsService.getCapabilityAdapter<ShopProductManagerPort>(
      input.connectionId,
      'ProductPublisher',
    );

    // 2. Persist the parent batch. totalCount = fan-out width (no multi-variant
    //    expansion — each submitted id is its own publish; #1042 model is
    //    variant-keyed). Stock/price are per-item (#1414), so sharedConfig only
    //    carries what's genuinely shared across every child.
    const batch = await this.bulkBatchRepository.create({
      connectionId: input.connectionId,
      initiatedBy: input.initiatedBy,
      totalCount: input.items.length,
      sharedConfig: {
        status: input.status,
        ...(input.content !== undefined && { content: input.content }),
        ...(input.commerce !== undefined && { commerce: input.commerce }),
      },
    });

    // 3. Fan out through the single-publish primitive. On a mid-fan-out failure
    //    the batch is reconciled so it can still reach a terminal status
    //    (partial-submit atomicity, mirrors BulkListingSubmitService #1741):
    //    - if >=1 child reached the stream, reconcile `totalCount` down to what
    //      was enqueued, delete any orphaned pre-created record (the child whose
    //      enqueue threw after `enqueuePublish` persisted its record but before
    //      the stream write), then LEVEL-triggered terminal check -> 'running'
    //      or a terminal status. Without this the counter gate
    //      (`succeeded + failed === totalCount`) could never terminate and the
    //      batch would strand in 'running' forever.
    //    - if nothing enqueued, flip terminal 'failed'.
    //    The underlying enqueue error is always re-thrown so the operator learns
    //    the submit was partial.
    const items: BulkShopPublishItem[] = [];
    const enqueuedRecordIds = new Set<string>();
    try {
      for (const item of input.items) {
        // Per-item content (#1831) WINS over the batch-shared content; each
        // per-item category/parameter override is threaded straight through so
        // the builder uses it instead of its server-derived default. Omitted
        // fields fall back to batch-shared / server-derived behavior.
        const content = item.content ?? input.content;
        const { jobId, listingCreationRecord } = await this.enqueue.enqueuePublish({
          connectionId: input.connectionId,
          internalVariantId: item.internalVariantId,
          status: input.status,
          stock: item.stock,
          bulkBatchId: batch.id,
          ...(item.price !== undefined && { price: item.price }),
          ...(content !== undefined && { content }),
          ...(input.commerce !== undefined && { commerce: input.commerce }),
          ...(item.destinationCategoryIds !== undefined && {
            destinationCategoryIds: item.destinationCategoryIds,
          }),
          ...(item.parameters !== undefined && { parameters: item.parameters }),
        });
        enqueuedRecordIds.add(listingCreationRecord.id);
        items.push({
          internalVariantId: item.internalVariantId,
          jobId,
          listingCreationRecordId: listingCreationRecord.id,
        });
      }
    } catch (error) {
      const enqueued = items.length;
      this.logger.error(
        `Bulk publish batch ${batch.id} enqueue failed after ${enqueued}/${input.items.length} jobs: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Best-effort reconciliation; if it also fails the underlying enqueue
      // error still propagates and dominates the FE message.
      try {
        await this.deleteOrphanRecords(batch.id, enqueuedRecordIds);
        if (enqueued > 0) {
          const reconciled = await this.bulkBatchRepository.updateTotalCount(batch.id, enqueued);
          const nextStatus = isBatchFinished(reconciled)
            ? deriveTerminalStatus(reconciled)
            : BULK_BATCH_STATUS.Running;
          await this.bulkBatchRepository.updateStatus(batch.id, nextStatus);
        } else {
          await this.bulkBatchRepository.updateStatus(batch.id, BULK_BATCH_STATUS.Failed);
        }
      } catch (reconcileError) {
        this.logger.error(
          `Bulk publish batch ${batch.id} partial-submit reconciliation also failed: ${(reconcileError as Error).message}`,
          (reconcileError as Error).stack,
        );
      }
      throw error;
    }

    // 4. All children enqueued — flip pending → running.
    await this.bulkBatchRepository.updateStatus(batch.id, BULK_BATCH_STATUS.Running);

    return { batchId: batch.id, items };
  }

  /**
   * Delete pre-created records for the batch that never reached the stream
   * (#1845). `enqueuePublish` persists the record before enqueuing, so a stream
   * write that throws leaves an orphaned pending record with no job — deleting
   * it keeps the persisted-record set aligned with the reconciled `totalCount`.
   * Best-effort; each delete is idempotent.
   */
  private async deleteOrphanRecords(
    batchId: string,
    enqueuedRecordIds: ReadonlySet<string>,
  ): Promise<void> {
    const records = await this.listingRecords.findByBulkBatchId(batchId);
    for (const record of records) {
      if (!enqueuedRecordIds.has(record.id)) {
        await this.listingRecords.deleteById(record.id);
      }
    }
  }

  async getBatch(batchId: string): Promise<BulkShopPublishBatchSummary | null> {
    const batch = await this.bulkBatchRepository.findById(batchId);
    if (!batch) {
      return null;
    }
    const records = await this.listingRecords.findByBulkBatchId(batchId);
    return { batch, records };
  }
}

/**
 * True once every child of the batch has terminated
 * (`succeededCount + failedCount === totalCount`) — the counter gate.
 */
function isBatchFinished(batch: BulkListingBatch): boolean {
  return batch.succeededCount + batch.failedCount === batch.totalCount;
}

/**
 * Derive the terminal batch status from its post-reconcile counters (#1845).
 * Same rule as `BulkListingProgressService`: all-succeeded ⇒ completed,
 * all-failed ⇒ failed, mixed ⇒ partially-failed. Call only when
 * {@link isBatchFinished} holds.
 */
function deriveTerminalStatus(batch: BulkListingBatch): BulkBatchStatus {
  if (batch.failedCount === 0) return BULK_BATCH_STATUS.Completed;
  if (batch.succeededCount === 0) return BULK_BATCH_STATUS.Failed;
  return BULK_BATCH_STATUS.PartiallyFailed;
}
