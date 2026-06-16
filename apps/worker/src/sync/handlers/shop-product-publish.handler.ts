/**
 * Shop Product Publish Handler
 *
 * Handles sync jobs of type `shop.product.publish` (#1042, ADR-024): validate
 * the `ShopProductPublishPayload` wire shape (V1 single / V2 bulk) → delegate to
 * `ProductPublishExecutionService.executePublish` → advance the parent
 * `BulkListingBatch` counter when the job is a bulk child (V2) → return the
 * business outcome.
 *
 * A thin shell: orchestration (create-vs-upsert, category provisioning,
 * attribute projection, mapping, record lifecycle) lives in the core execution
 * service per architecture-overview.md §7. Bulk-counter advancement reuses the
 * same `BulkListingProgressService` + at-most-once `bulk_batch_advancements`
 * gate the marketplace offer-create handler uses (#737/#1044).
 *
 * The payload's `destinationCategoryIds` / `parameters` fields are reserved for
 * a future pre-resolved enqueue path; today the builder re-resolves category
 * placement + attribute projection, so the handler threads only the publish
 * inputs the execution service consumes.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  type BulkChildOutcome,
  BULK_LISTING_PROGRESS_SERVICE_TOKEN,
  type IBulkListingProgressService,
  type IProductPublishExecutionService,
  PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import type {
  ShopProductPublishPayload,
  ShopProductPublishPayloadV2,
  SyncJob as SyncJobEntity,
  SyncJobHandler,
  SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class ShopProductPublishHandler implements SyncJobHandler {
  private readonly logger = new Logger(ShopProductPublishHandler.name);

  constructor(
    @Inject(PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN)
    private readonly productPublish: IProductPublishExecutionService,
    @Inject(BULK_LISTING_PROGRESS_SERVICE_TOKEN)
    private readonly bulkProgress: IBulkListingProgressService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing shop.product.publish job ${job.id} variant=${payload.internalVariantId} connection=${job.connectionId} status=${payload.status}`,
    );

    try {
      const { listingCreationRecord, outcome } = await this.productPublish.executePublish({
        internalVariantId: payload.internalVariantId,
        connectionId: job.connectionId,
        stock: payload.stock,
        status: payload.status,
        price: payload.price,
        content: payload.content,
        idempotencyKey: payload.idempotencyKey,
        listingCreationRecordId: payload.listingCreationRecordId,
      });

      this.logger.log(
        `Shop product publish finished: job=${job.id} recordId=${listingCreationRecord.id} status=${listingCreationRecord.status} outcome=${outcome} externalProductId=${listingCreationRecord.externalProductId ?? 'n/a'}`,
      );

      if (this.isV2(payload)) {
        // Bulk child — advance the parent batch counter. At-most-once is
        // enforced by `bulk_batch_advancements` inside the progress service,
        // so a worker retry can't double-count.
        const batchOutcome: BulkChildOutcome = outcome === 'ok' ? 'succeeded' : 'failed';
        await this.bulkProgress.advanceBatchStatus(
          payload.bulkBatchId,
          listingCreationRecord.id,
          batchOutcome,
        );
      }

      return { outcome };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `shop.product.publish job failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private isV2(payload: ShopProductPublishPayload): payload is ShopProductPublishPayloadV2 {
    return payload.schemaVersion === 2;
  }

  private getPayload(job: SyncJob): ShopProductPublishPayload {
    const payload = job.payload as unknown as Partial<ShopProductPublishPayload>;

    if (!payload || typeof payload !== 'object') {
      throw this.invalid(job, `Missing payload for job: ${job.id}`);
    }
    if (payload.schemaVersion !== 1 && payload.schemaVersion !== 2) {
      throw this.invalid(
        job,
        `Unsupported schemaVersion (${String(payload.schemaVersion)}) in payload: ${JSON.stringify(job.payload)}`,
      );
    }
    if (typeof payload.internalVariantId !== 'string' || payload.internalVariantId.length === 0) {
      throw this.invalid(
        job,
        `Missing or invalid internalVariantId in payload: ${JSON.stringify(job.payload)}`,
      );
    }
    if (
      typeof payload.stock !== 'number' ||
      !Number.isInteger(payload.stock) ||
      payload.stock < 0
    ) {
      throw this.invalid(
        job,
        `Missing or invalid stock in payload: ${JSON.stringify(job.payload)}`,
      );
    }
    if (payload.status !== 'draft' && payload.status !== 'published') {
      throw this.invalid(
        job,
        `Missing or invalid status in payload: ${JSON.stringify(job.payload)}`,
      );
    }

    const common = {
      internalVariantId: payload.internalVariantId,
      status: payload.status,
      stock: payload.stock,
      price: payload.price,
      destinationCategoryIds: payload.destinationCategoryIds,
      content: payload.content,
      parameters: payload.parameters,
      idempotencyKey: payload.idempotencyKey,
    };

    if (payload.schemaVersion === 2) {
      if (typeof payload.bulkBatchId !== 'string' || payload.bulkBatchId.length === 0) {
        throw this.invalid(job, `V2 payload missing bulkBatchId: ${JSON.stringify(job.payload)}`);
      }
      if (
        typeof payload.listingCreationRecordId !== 'string' ||
        payload.listingCreationRecordId.length === 0
      ) {
        throw this.invalid(
          job,
          `V2 payload missing listingCreationRecordId: ${JSON.stringify(job.payload)}`,
        );
      }
      return {
        schemaVersion: 2,
        ...common,
        bulkBatchId: payload.bulkBatchId,
        listingCreationRecordId: payload.listingCreationRecordId,
      };
    }

    return {
      schemaVersion: 1,
      ...common,
      listingCreationRecordId: payload.listingCreationRecordId,
    };
  }

  private invalid(job: SyncJob, message: string): SyncJobExecutionError {
    return new SyncJobExecutionError(message, job.id, job.jobType, job.connectionId);
  }
}
