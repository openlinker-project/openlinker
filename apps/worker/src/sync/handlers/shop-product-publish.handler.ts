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
 * The payload's `destinationCategoryIds` / `parameters` fields (#1831) carry
 * per-item overrides from the bulk transport; when present the builder uses them
 * verbatim instead of re-resolving category placement / attribute projection.
 * When absent the builder derives both as before (backward compatible).
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  CONTENT_SUGGESTION_SERVICE_TOKEN,
  type IContentSuggestionService,
} from '@openlinker/core/content';
import {
  type BulkChildOutcome,
  BULK_LISTING_PROGRESS_SERVICE_TOKEN,
  type IBulkListingProgressService,
  type IProductPublishExecutionService,
  type PublishProductContent,
  PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
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

/**
 * Prompt-template channel for shop-publish AI descriptions (#1840). The
 * `offer.description.suggest` template is seeded per channel; the shop-publish
 * flow targets WooCommerce, so it renders the `woocommerce` variant — the
 * open-world channel seam (`PromptTemplateChannel = string`) mirrors the offer
 * handler's hardcoded `allegro` channel. A missing template surfaces as an AI
 * failure and falls through to the master description (see below).
 */
const SHOP_PUBLISH_AI_CHANNEL = 'woocommerce';

@Injectable()
export class ShopProductPublishHandler implements SyncJobHandler {
  private readonly logger = new Logger(ShopProductPublishHandler.name);

  constructor(
    @Inject(PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN)
    private readonly productPublish: IProductPublishExecutionService,
    @Inject(BULK_LISTING_PROGRESS_SERVICE_TOKEN)
    private readonly bulkProgress: IBulkListingProgressService,
    @Inject(CONTENT_SUGGESTION_SERVICE_TOKEN)
    private readonly contentSuggestion: IContentSuggestionService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing shop.product.publish job ${job.id} variant=${payload.internalVariantId} connection=${job.connectionId} status=${payload.status}`,
    );

    // #1840 — fill content.description from AI when the operator asked for it
    // and hasn't supplied an explicit description override. AI failure falls
    // through to the master description (builder default), never blocking the
    // publish. Mirrors the offer-create handler's placement + precedence.
    const content = await this.maybeRunAiDescription(payload);

    try {
      const { listingCreationRecord, outcome } = await this.productPublish.executePublish({
        internalVariantId: payload.internalVariantId,
        connectionId: job.connectionId,
        stock: payload.stock,
        status: payload.status,
        price: payload.price,
        content,
        commerce: payload.commerce,
        destinationCategoryIds: payload.destinationCategoryIds,
        parameters: payload.parameters,
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

  /**
   * #1840 — when `generateDescription === true` and no explicit operator
   * description override is present, generate the product description via the
   * `offer.description.suggest` prompt template and merge it into `content`.
   * An operator-supplied `content.description` always wins (never overwritten).
   * Any failure (variant lookup, missing template, LLM error) logs a warning
   * and returns the original `payload.content` unchanged so the publish still
   * proceeds on the master description / builder default.
   */
  private async maybeRunAiDescription(
    payload: ShopProductPublishPayload,
  ): Promise<PublishProductContent | undefined> {
    if (payload.generateDescription !== true) {
      return payload.content;
    }
    if (payload.content?.description != null) {
      // Explicit operator override wins — don't overwrite it.
      return payload.content;
    }

    let productId: string;
    try {
      const variant = await this.products.getVariant(payload.internalVariantId);
      if (!variant) {
        this.logger.warn(
          `AI description skipped — variant not found: ${payload.internalVariantId}`,
        );
        return payload.content;
      }
      productId = variant.productId;
    } catch (err) {
      this.logger.warn(
        `AI description skipped — variant lookup failed: ${(err as Error).message}`,
      );
      return payload.content;
    }

    try {
      const result = await this.contentSuggestion.suggestDescription({
        productId,
        channel: SHOP_PUBLISH_AI_CHANNEL,
        ...(payload.descriptionTone !== undefined && { tone: payload.descriptionTone }),
      });
      return { ...payload.content, description: result.suggestion };
    } catch (err) {
      this.logger.warn(
        `AI description failed (falling back to master description / default): ${(err as Error).message}`,
      );
      return payload.content;
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
      commerce: payload.commerce,
      parameters: payload.parameters,
      generateDescription: payload.generateDescription,
      descriptionTone: payload.descriptionTone,
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
