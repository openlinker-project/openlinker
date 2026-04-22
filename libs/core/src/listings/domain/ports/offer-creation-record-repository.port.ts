/**
 * Offer Creation Record Repository Port
 *
 * Persistence contract for OfferCreationRecord. Implemented in the listings
 * infrastructure layer. Returns domain entities only — ORM mapping stays inside
 * the repository.
 *
 * @module libs/core/src/listings/domain/ports
 */

import { OfferCreationRecord } from '../entities/offer-creation-record.entity';
import {
  CreateOfferCreationRecordInput,
  OfferCreationError,
  OfferCreationStatus,
} from '../types/offer-creation-record.types';

export interface OfferCreationRecordRepositoryPort {
  /**
   * Persist a new offer creation record.
   *
   * `id`, `createdAt`, and `updatedAt` are assigned by the repository.
   */
  create(input: CreateOfferCreationRecordInput): Promise<OfferCreationRecord>;

  /**
   * Look up a record by primary key. Returns null when not found.
   */
  findById(id: string): Promise<OfferCreationRecord | null>;

  /**
   * Return the most-recently-created record for a given (internalVariantId, connectionId)
   * pair, ordered by `createdAt DESC`. Returns null when no record exists.
   *
   * Multiple records for the same pair are expected (retry attempts after failures);
   * callers that want the current state should always use this rather than a generic
   * "find by variant + connection".
   */
  findLatestByVariantAndConnection(
    variantId: string,
    connectionId: string,
  ): Promise<OfferCreationRecord | null>;

  /**
   * Look up the record that produced a given marketplace offer. Matches by
   * (externalOfferId, connectionId) so cross-connection collisions do not
   * return a false positive. Returns null when no record has been linked to
   * the offer — i.e. the mapping was synced-in rather than OL-created, or the
   * offer's creation record was never written.
   *
   * External offer ids are only assigned once the adapter returns successfully,
   * so pre-creation rows (status `pending` with null externalOfferId) are
   * never returned by this method.
   */
  findByExternalOfferIdAndConnectionId(
    externalOfferId: string,
    connectionId: string,
  ): Promise<OfferCreationRecord | null>;

  /**
   * Update status (and optionally errors) for an existing record.
   *
   * `errors` semantics:
   * - Omit the argument to preserve any previously-recorded errors.
   * - Pass `null` to explicitly clear previously-recorded errors.
   * - Pass an array to replace previously-recorded errors.
   *
   * Throws `OfferCreationRecordNotFoundException` if the record does not exist.
   */
  updateStatus(
    id: string,
    status: OfferCreationStatus,
    errors?: OfferCreationError[] | null,
  ): Promise<OfferCreationRecord>;

  /**
   * Assign the marketplace-native offer id to an existing record.
   *
   * Throws `OfferCreationRecordNotFoundException` if the record does not exist.
   */
  updateExternalOfferId(id: string, externalOfferId: string): Promise<OfferCreationRecord>;

  /**
   * Atomically set externalOfferId, status, and errors in a single write.
   *
   * Used when the platform create call succeeds and the caller needs the three
   * fields to land together (avoids the `externalOfferId set but status still
   * 'pending'` intermediate state that two separate updates would create if
   * the process died between them).
   *
   * `errors` follows the same three-valued semantics as `updateStatus`:
   * - omit to preserve previously-recorded errors
   * - pass `null` to explicitly clear them
   * - pass an array to replace them
   *
   * Throws `OfferCreationRecordNotFoundException` if the record does not exist.
   */
  updateExternalIdAndStatus(
    id: string,
    externalOfferId: string,
    status: OfferCreationStatus,
    errors?: OfferCreationError[] | null,
  ): Promise<OfferCreationRecord>;
}
