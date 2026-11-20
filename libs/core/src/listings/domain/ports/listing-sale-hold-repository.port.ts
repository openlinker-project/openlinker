/**
 * Listing Sale Hold Repository Port (#3962)
 *
 * Persistence contract for `ListingSaleHold`. At most one ACTIVE hold exists
 * per listing `(connectionId, entityType, externalId)`; recording again
 * updates that row, so the deletion trigger and the hourly sweep can both run
 * without creating duplicates.
 *
 * @module libs/core/src/listings/domain/ports
 */
import type { ListingSaleHold } from '../entities/listing-sale-hold.entity';
import type { ListingRef, RecordListingSaleHoldInput } from '../types/listing-sale-hold.types';

export interface ListingSaleHoldRepositoryPort {
  /** Insert the listing's active hold, or update it in place if one exists. */
  recordActive(input: RecordListingSaleHoldInput): Promise<ListingSaleHold>;

  /** Active holds among the given listings (one query, any number of refs). */
  findActiveByListings(refs: readonly ListingRef[]): Promise<ListingSaleHold[]>;

  /** Active holds for one product, across every connection. */
  findActiveByProductId(internalProductId: string): Promise<ListingSaleHold[]>;

  /** Holds by id, active or not, scoped to one product. */
  findByIdsForProduct(internalProductId: string, ids: readonly string[]): Promise<ListingSaleHold[]>;

  /** Mark the given holds released. Already-released holds are left as they are. */
  release(ids: readonly string[], releasedBy: string, releasedAt: Date): Promise<number>;

  /** Number of products with at least one active hold that did not stop the sale. */
  countProductsNeedingAttention(): Promise<number>;
}
