/**
 * Offer Mappings Service Interface
 *
 * Cross-context read seam (#718) over `OfferMappingRepositoryPort` — exposes
 * the offer-mapping query shapes sibling contexts actually consume so they
 * never need to value-import the repository port directly.
 *
 * @module libs/core/src/listings/application/services
 */
import type {
  OfferMappingPagination,
  PaginatedOfferMappings,
  ProductListingsCoverage,
} from '../../domain/types/offer-mapping.types';

export interface IOfferMappingsService {
  /**
   * Page of offer mappings for one variant on one connection. Defaults to
   * `{ limit: 100, offset: 0 }` — comfortably above the realistic per-variant
   * offer count (typically 1–3). Always scoped to `entityType = 'Offer'`.
   */
  findForVariant(
    connectionId: string,
    variantId: string,
    pagination?: OfferMappingPagination
  ): Promise<PaginatedOfferMappings>;

  /**
   * Count offer mappings grouped by `internalId` for a connection. Returns
   * `Map<internalId, count>`; keys with zero mappings are omitted. Empty
   * input returns an empty Map without hitting the database.
   */
  countForVariants(
    connectionId: string,
    variantIds: ReadonlyArray<string>
  ): Promise<Map<string, number>>;

  /**
   * Count DISTINCT listed variants per (product, connection) for the given
   * product IDs (#1720 - products catalog cockpit coverage pills). Pairs
   * with zero listed variants are omitted; the caller decides how to render
   * absent products. Empty input returns [] without hitting the database;
   * input is capped at 200 IDs per call.
   */
  countListedVariantsByProducts(
    productIds: readonly string[]
  ): Promise<readonly ProductListingsCoverage[]>;
}
