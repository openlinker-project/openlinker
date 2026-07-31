/**
 * Offer Mapping Types
 *
 * Type definitions for offer mapping read operations. Defines filters,
 * pagination, and paginated result types for querying offer-to-variant
 * mappings stored in the identifier_mappings table.
 *
 * @module libs/core/src/listings/domain/types
 */
import type { IdentifierMapping } from '@openlinker/core/identifier-mapping';

/**
 * Offer mapping list filters
 * Criteria for querying offer mappings. All fields are optional.
 */
export interface OfferMappingFilters {
  /** Filter by connection ID */
  connectionId?: string;
  /** Filter by platform type (e.g. 'allegro') */
  platformType?: string;
  /** Filter by linked internal ID (variant ID) */
  internalId?: string;
  /** Case-insensitive search on external ID */
  search?: string;
}

/**
 * Offset-based pagination parameters for offer mappings
 */
export interface OfferMappingPagination {
  /** Number of items to return (1–100) */
  limit: number;
  /** Number of items to skip */
  offset: number;
}

/**
 * Paginated offer mappings result
 */
export interface PaginatedOfferMappings {
  items: IdentifierMapping[];
  total: number;
}

/**
 * Per-product, per-connection listed-variant count (#1720 - products catalog
 * cockpit coverage pills).
 *
 * One row per (product, connection) pair that has at least one variant with
 * an Offer mapping; `listedVariants` is the count of DISTINCT variants of the
 * product that carry at least one Offer mapping on that connection. Products
 * or connections with zero listed variants are simply absent from the result.
 */
export interface ProductListingsCoverage {
  productId: string;
  connectionId: string;
  platformType: string;
  listedVariants: number;
}

/**
 * A variant with an Offer mapping on a connection whose canonical
 * `product_variants.isStale` flag is currently `true` (#1689). Backs the
 * stale-offer-pause reconcile sweep — see
 * `OfferMappingRepositoryPort.findStaleMappedVariants` for the cross-context
 * join this is read from.
 */
export interface StaleMappedVariant {
  variantId: string;
  externalOfferId: string;
  staleAt: Date;
}
