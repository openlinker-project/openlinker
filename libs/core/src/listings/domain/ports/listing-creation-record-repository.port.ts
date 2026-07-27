/**
 * Listing Creation Record Repository Port
 *
 * Persistence contract for `ListingCreationRecord` (shop publish lifecycle,
 * #1042). Implemented in the listings infrastructure layer. Returns domain
 * entities only — ORM mapping stays inside the repository. The method set is
 * the subset the shop publish execution service actually uses (no bulk /
 * classification / retry methods — those are marketplace-offer-only today).
 *
 * @module libs/core/src/listings/domain/ports
 */

import type { ListingCreationRecord } from '../entities/listing-creation-record.entity';
import type {
  CreateListingCreationRecordInput,
  ListingCreationError,
  ListingCreationStatus,
} from '../types/listing-creation-record.types';

export interface ListingCreationRecordRepositoryPort {
  /**
   * Persist a new listing creation record. `id`, `createdAt`, and `updatedAt`
   * are assigned by the repository.
   */
  create(input: CreateListingCreationRecordInput): Promise<ListingCreationRecord>;

  /** Look up a record by primary key. Returns null when not found. */
  findById(id: string): Promise<ListingCreationRecord | null>;

  /**
   * Return every child record belonging to a bulk-publish batch (#1044),
   * ordered `createdAt ASC`. Empty array when none exist. Backs the bulk-batch
   * summary read.
   */
  findByBulkBatchId(bulkBatchId: string): Promise<ListingCreationRecord[]>;

  /**
   * Return the most-recently-created record for a (internalVariantId,
   * connectionId) pair, ordered `createdAt DESC`. Null when none exists.
   * Multiple records per pair are expected (retry attempts after failures).
   */
  findLatestByVariantAndConnection(
    variantId: string,
    connectionId: string,
  ): Promise<ListingCreationRecord | null>;

  /**
   * Look up the record that produced a given shop product. Matches by
   * (externalProductId, connectionId) so cross-connection collisions do not
   * return a false positive. Returns null when no record has been linked.
   */
  findByExternalProductIdAndConnectionId(
    externalProductId: string,
    connectionId: string,
  ): Promise<ListingCreationRecord | null>;

  /**
   * Return one page of the connection's records whose status is `published` or
   * `draft` and that carry a non-null `externalProductId`, ordered
   * `createdAt ASC` for a stable rolling scan. Backs the steady-state shop
   * status reconcile (#1845) — the shop-side counterpart to the offer path's
   * `offer_mappings` enumeration. Returns `{ items, total }` so the sync can
   * wrap its scan offset at the end of the set.
   */
  findPublishedByConnection(
    connectionId: string,
    options: { limit: number; offset: number },
  ): Promise<{ items: ListingCreationRecord[]; total: number }>;

  /**
   * Delete a record by id. Idempotent - deleting an unknown id is a no-op.
   * Used to clean up an orphaned pre-created record whose enqueue failed
   * mid-fan-out so the bulk batch's persisted-record set matches its
   * reconciled `totalCount` (#1845 partial-submit atomicity, mirrors the offer
   * path's `OfferCreationRecordRepositoryPort.deleteById`).
   */
  deleteById(id: string): Promise<void>;

  /**
   * Reset a record for retry (#1845): atomically set `status='pending'` and
   * clear `externalProductId`, `errors`, and `warnings`. The `request` snapshot
   * is intentionally preserved so the retry can reconstruct the original publish
   * payload. Idempotent at `pending`. Throws
   * `ListingCreationRecordNotFoundException` if the record does not exist.
   */
  resetForRetry(id: string): Promise<ListingCreationRecord>;

  /**
   * Update status (and optionally errors). `errors` semantics: omit to
   * preserve, `null` to clear, array to replace. Throws
   * `ListingCreationRecordNotFoundException` if the record does not exist.
   */
  updateStatus(
    id: string,
    status: ListingCreationStatus,
    errors?: ListingCreationError[] | null,
  ): Promise<ListingCreationRecord>;

  /**
   * Atomically set externalProductId, status, errors, and warnings in a single
   * write (avoids the `externalProductId set but status still 'pending'`
   * intermediate state two separate updates would leave on a mid-write crash).
   * `errors` and `warnings` follow the same three-valued semantics as
   * `updateStatus`. Throws `ListingCreationRecordNotFoundException` if the
   * record does not exist.
   */
  updateExternalIdAndStatus(
    id: string,
    externalProductId: string,
    status: ListingCreationStatus,
    errors?: ListingCreationError[] | null,
    warnings?: string[] | null,
  ): Promise<ListingCreationRecord>;
}
