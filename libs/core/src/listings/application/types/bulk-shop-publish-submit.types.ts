/**
 * Bulk Shop Publish Submit Types
 *
 * I/O contract for `BulkShopPublishSubmitService` (#1044) — the shop-publish
 * sibling of `bulk-listing-submit.types.ts`. Reuses the child-type-agnostic
 * `BulkListingBatch` aggregate; children are `ListingCreationRecord`s linked by
 * `bulkBatchId`.
 *
 * @module libs/core/src/listings/application/types
 */

import type { OfferDescriptionTone } from '@openlinker/core/sync';

import type { BulkListingBatch } from '../../domain/entities/bulk-listing-batch.entity';
import type { ListingCreationRecord } from '../../domain/entities/listing-creation-record.entity';
import type { OfferParameter } from '../../domain/types/offer-parameter.types';
import type {
  PublishProductCommerce,
  PublishProductContent,
  PublishProductStatus,
} from '../../domain/types/product-publish.types';

/**
 * One child publish within a bulk submission — variant id plus its own stock
 * and optional price override (#1414: stock/price are per-product, not
 * batch-shared; a bulk publish is N independent publish decisions that happen
 * to share a connection, status, and content).
 *
 * Per-item `content` / `destinationCategoryIds` / `parameters` (#1831) are
 * optional overrides that WIN over the batch-shared `content` and the builder's
 * server-derived category placement / attribute projection. Omitting any of them
 * keeps today's batch-shared / server-derived behavior (backward compatible).
 */
export interface BulkShopPublishSubmitItemInput {
  internalVariantId: string;
  stock: number;
  /** Omitted ⇒ this child falls back to its master product's price. */
  price?: { amount: number; currency: string };
  /**
   * This child's own content override. Present ⇒ replaces the batch-shared
   * `content` for this child; omitted ⇒ the batch-shared `content` applies. The
   * builder still merges the chosen content object over master-product fallbacks.
   */
  content?: PublishProductContent;
  /**
   * This child's own destination category placement. Present (including an empty
   * array to publish uncategorised) ⇒ the builder skips server-side category
   * provisioning and uses these ids; omitted ⇒ the builder provisions as today.
   */
  destinationCategoryIds?: string[];
  /**
   * This child's own neutral category parameters. Present (including an empty
   * array) ⇒ the builder skips attribute projection and uses these; omitted ⇒
   * the builder projects the variant's attributes as today.
   */
  parameters?: OfferParameter[];
}

export interface BulkShopPublishSubmitInput {
  /** Target shop connection id. */
  connectionId: string;
  /** Operator user id that submitted the bulk request. */
  initiatedBy: string;
  /** One child publish (variant + own stock/price) each. */
  items: BulkShopPublishSubmitItemInput[];
  /** Shared target publication state applied to every child. */
  status: PublishProductStatus;
  /** Optional shared content overrides applied to every child. */
  content?: PublishProductContent;
  /** Optional shared commerce fields (sale price, dimensions, tax) applied to every child. */
  commerce?: PublishProductCommerce;
  /**
   * Shared AI flag (#1840): when `true`, every child publish generates its
   * description via the `offer.description.suggest` prompt template (unless a
   * child already carries an explicit description override). Batch-scoped,
   * mirroring the offer bulk flow's batch-level `generateDescription`.
   */
  generateDescription?: boolean;
  /** Optional shared AI tone hint; ignored when `generateDescription` is not `true`. */
  descriptionTone?: OfferDescriptionTone;
}

export interface BulkShopPublishItem {
  internalVariantId: string;
  jobId: string;
  listingCreationRecordId: string;
}

export interface BulkShopPublishSubmitResult {
  batchId: string;
  items: BulkShopPublishItem[];
}

export interface BulkShopPublishBatchSummary {
  batch: BulkListingBatch;
  /** Child publish records belonging to the batch, ordered `createdAt ASC`. */
  records: ListingCreationRecord[];
}
