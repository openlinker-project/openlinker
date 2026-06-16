/**
 * Bulk Shop Publish Submit Service Interface (#1044)
 *
 * Contract for bulk shop-publish: validate the connection's `ProductPublisher`
 * capability, persist the parent `BulkListingBatch`, fan out to the
 * single-publish `IProductPublishEnqueueService` once per variant (carrying the
 * `bulkBatchId` so the worker advances the shared progress counter), transition
 * the batch to `running`, and expose a `getBatch` read for the FE tracker.
 *
 * Reuses the same child-type-agnostic `BulkListingBatch` + `BulkListingProgressService`
 * + `bulk_batch_advancements` aggregate the marketplace bulk-offer flow uses.
 * Batch-level retry of failed children is deferred (the publish record carries
 * no request snapshot) — single-job worker retry is unaffected.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type {
  BulkShopPublishBatchSummary,
  BulkShopPublishSubmitInput,
  BulkShopPublishSubmitResult,
} from '../types/bulk-shop-publish-submit.types';

export interface IBulkShopPublishSubmitService {
  /**
   * Validate + persist batch + fan out enqueues.
   *
   * Throws `ConnectionNotFoundException` (→ 404), `ConnectionDisabledException`
   * (→ 409), `CapabilityNotSupportedException` (→ 422) for the connection/capability
   * cascade, and `EmptyBulkSubmissionException` (→ 400) when `internalVariantIds`
   * is empty. On partial enqueue failure the batch is marked `failed` best-effort
   * and the error re-thrown.
   */
  submit(input: BulkShopPublishSubmitInput): Promise<BulkShopPublishSubmitResult>;

  /**
   * Return the batch + every child `ListingCreationRecord` belonging to it,
   * ordered `createdAt ASC`. Null when the batch id is unknown (controller → 404).
   */
  getBatch(batchId: string): Promise<BulkShopPublishBatchSummary | null>;
}
