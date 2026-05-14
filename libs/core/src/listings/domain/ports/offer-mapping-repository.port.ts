/**
 * Offer Mapping Repository Port
 *
 * Defines the contract for offer mapping read operations. Queries the
 * identifier_mappings table scoped to entityType = 'Offer'.
 *
 * @module libs/core/src/listings/domain/ports
 */
import type { IdentifierMapping } from '@openlinker/core/identifier-mapping';
import type {
  OfferMappingFilters,
  OfferMappingPagination,
  PaginatedOfferMappings,
} from '../types/offer-mapping.types';

export interface OfferMappingRepositoryPort {
  /**
   * Find offer mapping by ID (primary key of identifier_mappings row)
   */
  findById(id: string): Promise<IdentifierMapping | null>;

  /**
   * Find offer mappings matching filters with offset pagination.
   * Always scoped to entityType = 'Offer'. Results ordered by createdAt DESC.
   */
  findMany(
    filters: OfferMappingFilters,
    pagination: OfferMappingPagination
  ): Promise<PaginatedOfferMappings>;

  /**
   * Count Offer mappings grouped by `internalId` for a connection.
   * Returns a `Map<internalId, count>`. Keys with zero mappings are omitted.
   * Intended for bulk "how many offers does each variant have" queries that
   * would otherwise fan out to one `findMany` per variant.
   */
  countByConnectionAndVariants(
    connectionId: string,
    internalIds: ReadonlyArray<string>
  ): Promise<Map<string, number>>;
}
