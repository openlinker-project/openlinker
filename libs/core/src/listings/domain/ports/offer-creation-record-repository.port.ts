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
   * Update status (and optionally errors) for an existing record.
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
}
