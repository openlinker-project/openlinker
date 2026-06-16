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

import { EmptyBulkSubmissionException } from '../../domain/exceptions/empty-bulk-submission.exception';
import { BulkListingBatchRepositoryPort } from '../../domain/ports/bulk-listing-batch-repository.port';
import { ListingCreationRecordRepositoryPort } from '../../domain/ports/listing-creation-record-repository.port';
import { BULK_BATCH_STATUS } from '../../domain/types/bulk-listing-batch.types';
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
    if (input.internalVariantIds.length === 0) {
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
    //    variant-keyed).
    const batch = await this.bulkBatchRepository.create({
      connectionId: input.connectionId,
      initiatedBy: input.initiatedBy,
      totalCount: input.internalVariantIds.length,
      sharedConfig: {
        status: input.status,
        stock: input.stock,
        ...(input.price !== undefined && { price: input.price }),
        ...(input.content !== undefined && { content: input.content }),
      },
    });

    // 3. Fan out through the single-publish primitive. First enqueue failure
    //    marks the batch failed and re-throws (mirrors BulkListingSubmitService).
    const items: BulkShopPublishItem[] = [];
    try {
      for (const internalVariantId of input.internalVariantIds) {
        const { jobId, listingCreationRecord } = await this.enqueue.enqueuePublish({
          connectionId: input.connectionId,
          internalVariantId,
          status: input.status,
          stock: input.stock,
          bulkBatchId: batch.id,
          ...(input.price !== undefined && { price: input.price }),
          ...(input.content !== undefined && { content: input.content }),
        });
        items.push({ internalVariantId, jobId, listingCreationRecordId: listingCreationRecord.id });
      }
    } catch (error) {
      this.logger.warn(
        `Bulk publish batch ${batch.id} enqueue failed after ${items.length}/${input.internalVariantIds.length} jobs: ${(error as Error).message}`,
      );
      await this.bulkBatchRepository.updateStatus(batch.id, BULK_BATCH_STATUS.Failed);
      throw error;
    }

    // 4. All children enqueued — flip pending → running.
    await this.bulkBatchRepository.updateStatus(batch.id, BULK_BATCH_STATUS.Running);

    return { batchId: batch.id, items };
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
