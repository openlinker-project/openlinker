/**
 * Shop Product Publish Handler
 *
 * Handles sync jobs of type `shop.product.publish` (#1042, ADR-024): validate
 * the `ShopProductPublishPayloadV1` wire shape → delegate to
 * `ProductPublishExecutionService.executePublish` → return the business outcome.
 *
 * A thin shell: orchestration (create-vs-upsert, category provisioning,
 * attribute projection, mapping, record lifecycle) lives in the core execution
 * service per architecture-overview.md §7. No AI / bulk side-effects (those are
 * marketplace-offer-only today).
 *
 * The payload's `destinationCategoryIds` / `parameters` fields are reserved for
 * a future pre-resolved enqueue path (#1044); today the builder re-resolves
 * category placement + attribute projection, so the handler threads only the
 * publish inputs the execution service consumes.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  type IProductPublishExecutionService,
  PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import type {
  ShopProductPublishPayloadV1,
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
    private readonly productPublish: IProductPublishExecutionService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing shop.product.publish job ${job.id} variant=${payload.internalVariantId} connection=${job.connectionId} status=${payload.status}`
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
        `Shop product publish finished: job=${job.id} recordId=${listingCreationRecord.id} status=${listingCreationRecord.status} outcome=${outcome} externalProductId=${listingCreationRecord.externalProductId ?? 'n/a'}`
      );

      return { outcome };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `shop.product.publish job failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): ShopProductPublishPayloadV1 {
    const payload = job.payload as unknown as Partial<ShopProductPublishPayloadV1>;

    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (payload.schemaVersion !== 1) {
      throw new SyncJobExecutionError(
        `Unsupported schemaVersion (${String(payload.schemaVersion)}) in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (typeof payload.internalVariantId !== 'string' || payload.internalVariantId.length === 0) {
      throw new SyncJobExecutionError(
        `Missing or invalid internalVariantId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (typeof payload.stock !== 'number' || !Number.isInteger(payload.stock) || payload.stock < 0) {
      throw new SyncJobExecutionError(
        `Missing or invalid stock in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (payload.status !== 'draft' && payload.status !== 'published') {
      throw new SyncJobExecutionError(
        `Missing or invalid status in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return {
      schemaVersion: 1,
      internalVariantId: payload.internalVariantId,
      status: payload.status,
      stock: payload.stock,
      price: payload.price,
      destinationCategoryIds: payload.destinationCategoryIds,
      content: payload.content,
      parameters: payload.parameters,
      idempotencyKey: payload.idempotencyKey,
      listingCreationRecordId: payload.listingCreationRecordId,
    };
  }
}
