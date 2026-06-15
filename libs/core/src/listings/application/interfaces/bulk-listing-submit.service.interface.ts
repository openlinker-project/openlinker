/**
 * Bulk Offer Creation Submit Service Interface (#736)
 *
 * Contract for the bulk-submission orchestration: validate connection +
 * capability, persist the parent `BulkListingBatch`, fan out to
 * `IOfferCreationEnqueueService` once per product (emitting
 * `MarketplaceOfferCreatePayloadV2`), advance the batch to `'running'`,
 * and expose a `getBatch` read for the FE progress page.
 *
 * Terminal-status derivation (deriving `completed | partially-failed |
 * failed` when `succeededCount + failedCount === totalCount`) lives in
 * this service per `architecture-overview.md` §7 and the entity header in
 * `bulk-listing-batch.entity.ts`. The state-machine method that
 * does the derivation is added by the worker handler change in **#737** —
 * this slice exposes only `submit` + `getBatch`.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type {
  BulkBatchSummary,
  BulkListingSubmitInput,
  BulkListingSubmitResult,
} from '../types/bulk-listing-submit.types';

export interface IBulkListingSubmitService {
  /**
   * Validate + persist batch + fan out enqueues.
   *
   * Throws:
   * - `ConnectionNotFoundException` (→ HTTP 404) when the connection does not exist.
   * - `ConnectionDisabledException` (→ HTTP 409) when the connection is disabled.
   * - `CapabilityNotSupportedException` (→ HTTP 422) when the adapter does
   *   not implement `OfferManager`.
   * - `UnprocessableEntityException` (→ HTTP 422) when the adapter implements
   *   `OfferManager` but not the `OfferCreator` sub-capability.
   * - `EmptyBulkSubmissionException` (→ HTTP 400) when `productIds` is empty.
   *
   * On partial enqueue failure (Redis stream rejects the Nth job), the
   * batch row is marked `'failed'` best-effort and the underlying error
   * is re-thrown — the FE wizard treats this as an end-to-end failure
   * and offers a fresh submit.
   */
  submit(input: BulkListingSubmitInput): Promise<BulkListingSubmitResult>;

  /**
   * Return the batch + every child `OfferCreationRecord` belonging to it,
   * ordered by `createdAt ASC`. Returns `null` when the batch id is
   * unknown — the controller maps null to HTTP 404.
   */
  getBatch(batchId: string): Promise<BulkBatchSummary | null>;
}
