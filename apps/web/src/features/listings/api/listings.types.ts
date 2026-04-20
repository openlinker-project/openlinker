/**
 * Listings Feature Types
 *
 * Frontend transport types for the listings (offer mapping) API. Mirrors the
 * backend OfferMappingResponseDto and PaginatedOfferMappingsResponseDto contracts.
 * All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/listings/api
 */

/**
 * Known mapping entity types. The wire value is a plain string — unknown
 * values pass through unchanged (UI falls back to non-linkified text) so this
 * list stays forward-compatible with new backend entity kinds.
 */
export const KNOWN_MAPPING_ENTITY_TYPES = ['Product', 'ProductVariant', 'InventoryItem'] as const;
export type KnownMappingEntityType = (typeof KNOWN_MAPPING_ENTITY_TYPES)[number];

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

export interface UpdateOfferDescriptionSectionItem {
  type: 'TEXT';
  content: string;
}

export interface UpdateOfferDescriptionSection {
  items: UpdateOfferDescriptionSectionItem[];
}

export interface UpdateOfferFieldsPayload {
  price?: { amount: string; currency: string };
  title?: string;
  description?: { sections: UpdateOfferDescriptionSection[] };
}

export interface UpdateOfferFieldsResult {
  jobId: string;
}
