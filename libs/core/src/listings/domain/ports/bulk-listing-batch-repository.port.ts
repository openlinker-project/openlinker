/**
 * Bulk Offer Creation Batch Repository Port
 *
 * Persistence contract for BulkListingBatch. Implemented in the
 * listings infrastructure layer. Returns domain entities only — ORM
 * mapping stays inside the repository.
 *
 * Intentionally narrow: only the methods needed by callers in scope
 * (#734 foundation + #736 submission service). The "list batches for a
 * connection" surface is deferred until #736 supplies a real caller with
 * concrete query shape (paginated history vs. active-only vs. metrics).
 *
 * @module libs/core/src/listings/domain/ports
 */

import type { BulkListingBatch } from '../entities/bulk-listing-batch.entity';
import type {
  BulkBatchStatus,
  CreateBulkListingBatchInput,
} from '../types/bulk-listing-batch.types';

export interface BulkListingBatchRepositoryPort {
  /**
   * Persist a new bulk batch.
   *
   * Initial `status` is `'pending'` and both counters default to `0` —
   * the repository owns those defaults so the input type captures the
   * invariant. `id`, `createdAt`, and `updatedAt` are assigned by the
   * repository.
   */
  create(input: CreateBulkListingBatchInput): Promise<BulkListingBatch>;

  /**
   * Look up a batch by primary key. Returns null when not found.
   */
  findById(id: string): Promise<BulkListingBatch | null>;

  /**
   * Atomically apply counter deltas via single-column `UPDATE` statements
   * (`UPDATE … SET succeededCount = succeededCount + N WHERE id = $1`).
   * Each non-zero delta runs as its own statement so concurrent worker
   * callbacks race-safely.
   *
   * Deltas are permissive (negative values allowed) so future admin
   * compensation flows can decrement without an extra method. Zero or
   * undefined deltas skip the `UPDATE` for that column — the row is
   * still re-read and returned (and the not-found check still fires),
   * so `incrementCounters(id, { succeeded: 0, failed: 0 })` is
   * equivalent to a strict `findById` that throws on miss.
   *
   * Returns the post-update entity (a follow-up SELECT) so callers can
   * decide whether the batch has reached its terminal state without an
   * additional `findById`.
   *
   * Throws `BulkListingBatchNotFoundException` if the row is
   * missing.
   */
  incrementCounters(
    id: string,
    deltas: { succeeded?: number; failed?: number },
  ): Promise<BulkListingBatch>;

  /**
   * Update batch lifecycle status. Idempotent at the same status value.
   *
   * The port does not validate transitions — orchestration rules
   * (`pending → running`, terminal-status derivation when
   * `succeededCount + failedCount === totalCount`) live in the
   * application service in #736 per architecture-overview.md § 7.
   *
   * Throws `BulkListingBatchNotFoundException` if the row is
   * missing.
   */
  updateStatus(id: string, status: BulkBatchStatus): Promise<BulkListingBatch>;

  /**
   * Reconcile the batch's `totalCount` to a new value (#1741).
   *
   * Used only by the partial-submit atomicity path: when a mid-fan-out enqueue
   * fails after N jobs already reached the stream, `totalCount` is reconciled
   * down to N so the #737 counter gate
   * (`succeededCount + failedCount === totalCount`) can still terminate the
   * batch instead of it lingering forever waiting on un-enqueued children.
   *
   * The port does not validate the value against the current counters -
   * reconciliation is an orchestration decision owned by the submit service.
   *
   * Throws `BulkListingBatchNotFoundException` if the row is missing.
   */
  updateTotalCount(id: string, totalCount: number): Promise<BulkListingBatch>;
}
