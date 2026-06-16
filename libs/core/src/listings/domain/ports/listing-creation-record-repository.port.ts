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
   * Atomically set externalProductId, status, and errors in a single write
   * (avoids the `externalProductId set but status still 'pending'` intermediate
   * state two separate updates would leave on a mid-write crash). `errors`
   * follows the same three-valued semantics as `updateStatus`. Throws
   * `ListingCreationRecordNotFoundException` if the record does not exist.
   */
  updateExternalIdAndStatus(
    id: string,
    externalProductId: string,
    status: ListingCreationStatus,
    errors?: ListingCreationError[] | null,
  ): Promise<ListingCreationRecord>;
}
