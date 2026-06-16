/**
 * Product Publish Enqueue Types
 *
 * I/O contract for `ProductPublishEnqueueService` (#1044) — the pre-enqueue half
 * of the shop-publish flow (the shop-side sibling of `offer-creation-enqueue.types.ts`).
 * The single per-child primitive both the single-publish controller and the bulk
 * submit service fan out through.
 *
 * @module libs/core/src/listings/application/types
 */

import type {
  PublishProductContent,
  PublishProductStatus,
} from '../../domain/types/product-publish.types';
import type { ListingCreationRecord } from '../../domain/entities/listing-creation-record.entity';

export interface EnqueueProductPublishInput {
  /** Target shop connection id. */
  connectionId: string;
  /** OL internal variant id to publish. */
  internalVariantId: string;
  /** Target publication state (draft vs published). */
  status: PublishProductStatus;
  /** Stock quantity to publish. */
  stock: number;
  /** Optional explicit price; when omitted the builder falls back to the master product. */
  price?: { amount: number; currency: string };
  /** Optional owned-record content overrides (title, description, images, SEO). */
  content?: PublishProductContent;
  /** Optional idempotency key; defaults to `shop-publish:{recordId}` (single) / a batch-scoped key (bulk). */
  idempotencyKey?: string;
  /**
   * Parent bulk-batch id when this enqueue is part of a bulk submission (#1044).
   * Present ⇒ the V2 payload is emitted and the child record carries the batch id
   * so the worker can advance the shared progress counter.
   */
  bulkBatchId?: string;
}

export interface EnqueueProductPublishResult {
  /** Enqueued sync-job id (Redis Streams message id). */
  jobId: string;
  /** Pre-created listing-creation record (status `pending`); id is poll-able immediately. */
  listingCreationRecord: ListingCreationRecord;
}
