/**
 * Offer Mapping Repository Port
 *
 * Defines the contract for offer mapping read operations. Queries the
 * identifier_mappings table scoped to entityType = 'Offer'.
 *
 * @module libs/core/src/listings/domain/ports
 */
import type { IdentifierMapping } from '@openlinker/core/identifier-mapping';
import type { OfferLifecycleCounts } from '../types/offer-lifecycle.types';
import type {
  OfferMappingCountFilters,
  OfferMappingFilters,
  OfferMappingPagination,
  PaginatedIdentifierMappings,
  PaginatedOfferMappings,
  ProductListingsCoverage,
  StaleMappedVariant,
} from '../types/offer-mapping.types';

export interface OfferMappingRepositoryPort {
  /**
   * Find offer mapping by ID (primary key of identifier_mappings row)
   */
  findById(id: string): Promise<IdentifierMapping | null>;

  /**
   * Find offer mappings matching filters with offset pagination.
   * Always scoped to entityType = 'Offer'. Results ordered by createdAt DESC
   * (id DESC as tiebreaker, so paging is total).
   *
   * Each item carries the mapping plus three read-model projections resolved
   * in the SAME query via reporting joins (#2025): catalog `identity`
   * (product/variant, `null` when the mapping outlived its variant),
   * `channelStatus` (the `offer_status_snapshots` row and the lifecycle bucket
   * derived from it - ALWAYS present, carrying `lifecycle: 'Unsynced'` when no
   * status has been read yet, so every row has a bucket) and `commercial` (the
   * `offer_commercial_snapshots` price/quantity together with their freshness
   * timestamp, `null` when none has been persisted). Callers that only need
   * the mapping fields read them off the item directly and can ignore all
   * three.
   *
   * `filters.search` is trimmed and matched case-insensitively across product
   * name, product SKU, variant SKU, variant EAN, variant GTIN, the variant's
   * attribute VALUES and the external offer ID.
   *
   * `filters.lifecycle` (#2026) narrows to one bucket; `total` then reports
   * that bucket's size, so paging stays correct inside a selected tab.
   */
  /**
   * `skipTotal` (#2032 review thread 3): when the caller already knows the
   * total from a `countByLifecycle` call under the same filters (the ONE
   * caller that requests both), running `findMany`'s own `getCount()` too is
   * a provably-redundant second full scan of the same join. Returns `total:
   * -1` as a sentinel when set - the caller MUST supply the real value from
   * elsewhere. Omitted or `false` preserves the original behaviour.
   */
  findMany(
    filters: OfferMappingFilters,
    pagination: OfferMappingPagination,
    options?: { skipTotal?: boolean }
  ): Promise<PaginatedOfferMappings>;

  /**
   * Find Offer mappings matching filters with offset pagination, WITHOUT the
   * read-model reporting joins `findMany` carries (#2032 review thread 11).
   *
   * For a caller that only ever reads `.externalId` / `.internalId` off the
   * mapping - `OfferStatusSyncService` (100 rows/tick, continuously) and
   * `OfferStockRestoreService` - `findMany`'s four LEFT JOINs, 14-column
   * projection and separate `COUNT(DISTINCT)` are pure overhead: the
   * write/sync path would pay for the listings-page read model on every tick.
   * Mirrors `findMany`'s pre-#2025 shape: one table, `externalId` search only,
   * `getManyAndCount()`.
   */
  findMappingPage(
    filters: OfferMappingFilters,
    pagination: OfferMappingPagination
  ): Promise<PaginatedIdentifierMappings>;

  /**
   * Count Offer mappings per lifecycle bucket under the SAME filters
   * `findMany` applies (#2026) - the tab-bar counts.
   *
   * Every bucket is present, zeroed when empty. The counts partition the
   * filtered set, so they sum to the `total` `findMany` reports for the same
   * filters WITHOUT a `lifecycle` narrowing - which is why the filter type
   * excludes `lifecycle` outright rather than ignoring it.
   *
   * The query never encodes the lifecycle rule: it groups by the raw snapshot
   * facts and the caller folds each group through `resolveOfferLifecycle`, the
   * same function that classifies each list row.
   */
  countByLifecycle(filters: OfferMappingCountFilters): Promise<OfferLifecycleCounts>;

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

  /**
   * Count DISTINCT listed variants per (product, connection) for the given
   * product IDs (#1720). Joins the products-context `product_variants` table
   * as a read-model reporting query to resolve each Offer mapping's variant
   * back to its parent product. Pairs with zero listed variants are omitted.
   * Empty input returns [] without a storage round-trip.
   */
  countListedVariantsByProducts(
    productIds: readonly string[]
  ): Promise<readonly ProductListingsCoverage[]>;

  /**
   * Find Offer mappings on a connection whose mapped variant is currently
   * stale (#1689) — the read-model backing the stale-offer-pause reconcile
   * sweep. Joins the products-context `product_variants` table by name (a
   * read-model reporting join, not a cross-context ORM-entity import — same
   * pattern as `countListedVariantsByProducts`), filtered to
   * `isStale = true AND staleAt >= staleSince`, ordered by `staleAt DESC`,
   * capped at `limit`.
   */
  findStaleMappedVariants(
    connectionId: string,
    options: { limit: number; staleSince: Date }
  ): Promise<readonly StaleMappedVariant[]>;
}
