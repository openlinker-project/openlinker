/**
 * Listings Feature Types
 *
 * Frontend transport types for the listings (offer mapping) API. Mirrors the
 * backend OfferMappingResponseDto and PaginatedOfferMappingsResponseDto contracts.
 * All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/listings/api
 */

export interface OfferMapping {
  id: string;
  entityType: string;
  internalId: string;
  externalId: string;
  platformType: string;
  connectionId: string;
  context: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListingsFilters {
  connectionId?: string;
  platformType?: string;
  internalId?: string;
  search?: string;
}

export interface ListingsPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedOfferMappings {
  items: OfferMapping[];
  total: number;
  limit: number;
  offset: number;
}
