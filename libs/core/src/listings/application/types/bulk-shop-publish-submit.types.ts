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

import type { BulkListingBatch } from '../../domain/entities/bulk-listing-batch.entity';
import type { ListingCreationRecord } from '../../domain/entities/listing-creation-record.entity';
import type {
  PublishProductContent,
  PublishProductStatus,
} from '../../domain/types/product-publish.types';

export interface BulkShopPublishSubmitInput {
  /** Target shop connection id. */
  connectionId: string;
  /** Operator user id that submitted the bulk request. */
  initiatedBy: string;
  /** Internal variant ids to publish — one child publish each. */
  internalVariantIds: string[];
  /** Shared target publication state applied to every child. */
  status: PublishProductStatus;
  /** Shared stock applied to every child. */
  stock: number;
  /** Optional shared price override; omitted ⇒ each child falls back to its master product. */
  price?: { amount: number; currency: string };
  /** Optional shared content overrides applied to every child. */
  content?: PublishProductContent;
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
