/**
 * Bulk Offer Creation Batch Types
 *
 * Types for BulkOfferCreationBatch — the parent aggregate for a single bulk
 * offer-creation submission (one row per "user clicks bulk-create on N
 * variants"). Child offer-creation attempts reference the batch via
 * `offer_creation_records.bulkBatchId`.
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * Persisted lifecycle status for a bulk offer-creation batch.
 *
 * - `pending`: Batch persisted; child jobs not yet dispatched.
 * - `running`: At least one child offer-creation job has started.
 * - `completed`: All child jobs finished, every child succeeded
 *   (`failedCount === 0`).
 * - `partially-failed`: All child jobs finished, mixed outcome
 *   (`succeededCount > 0 && failedCount > 0`).
 * - `failed`: All child jobs finished, every child failed
 *   (`succeededCount === 0 && failedCount > 0`).
 *
 * The terminal status (`completed | partially-failed | failed`) is derived
 * once `succeededCount + failedCount === totalCount`. That derivation lives
 * in the bulk-batch progress service in #736 per architecture-overview.md
 * § 7 — not in the repository port, and not in worker handlers.
 */
export const BulkBatchStatusValues = [
  'pending',
  'running',
  'completed',
  'partially-failed',
  'failed',
] as const;

export type BulkBatchStatus = (typeof BulkBatchStatusValues)[number];

/**
 * Named-constant map for the bulk-batch lifecycle status (mirrors the
 * `OFFER_CREATION_STATUS` pattern in `offer-creation-record.types.ts`).
 *
 * Lets call sites reference status values by name
 * (`BULK_BATCH_STATUS.PartiallyFailed`) rather than repeating bare
 * `'partially-failed'` literals. The `as const satisfies` keeps the map in
 * lockstep with the union on both axes — drop an entry → TS errors because
 * the key domain is `Capitalize<CamelCase<BulkBatchStatus>>`; type a value
 * to a non-member literal → TS errors because the value domain is
 * `BulkBatchStatus`.
 */
export const BULK_BATCH_STATUS = {
  Pending: 'pending',
  Running: 'running',
  Completed: 'completed',
  PartiallyFailed: 'partially-failed',
  Failed: 'failed',
} as const satisfies Record<
  'Pending' | 'Running' | 'Completed' | 'PartiallyFailed' | 'Failed',
  BulkBatchStatus
>;

/**
 * Input contract for `BulkOfferCreationBatchRepositoryPort.create`.
 *
 * Dedicated input type (not `Omit<BulkOfferCreationBatch, ...>`) so the
 * write contract is decoupled from the entity's readonly shape and future
 * entity changes (added fields, derived behavior) don't silently affect
 * callers.
 *
 * Bulk batches always start at `'pending'` with both counters at zero;
 * those defaults are applied by the repository at write time so the input
 * type captures the invariant.
 */
export interface CreateBulkOfferCreationBatchInput {
  /** Target marketplace connection id. */
  connectionId: string;
  /** Operator user id that submitted the bulk request. Required — bulk is
   * always operator-initiated per the #726 spec (US-1); no
   * system-triggered path exists in v1. */
  initiatedBy: string;
  /** Total number of child offer-creation attempts in the batch. */
  totalCount: number;
  /**
   * Per-batch shared submission config (e.g. shipping-rate-package id,
   * publish-immediately flag, Smart-eligibility hint). Shape is owned by
   * the bulk-submission service in #736; persisted as `Record<string,
   * unknown>` here so this foundation slice can ship without committing
   * to the final schema.
   */
  sharedConfig: Record<string, unknown>;
}
