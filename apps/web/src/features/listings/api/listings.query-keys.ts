import { CATEGORY_PARAMETERS_SCHEMA_VERSION } from './listings.types';
import type { ListingsFilters, ListingsPagination } from './listings.types';

export const listingsQueryKeys = {
  all: ['listings'] as const,
  // Matches every `list(...)` key as a prefix — use for cross-cutting invalidation
  // after mutations that may add new rows without invalidating polling / cached queries.
  lists: () => ['listings', 'list'] as const,
  list: (filters?: ListingsFilters, pagination?: ListingsPagination) =>
    ['listings', 'list', filters ?? {}, pagination ?? {}] as const,
  /**
   * The rows-only page (#2947) - a different response shape, so a different key.
   *
   * `includeLifecycleCounts` is stripped (#2957 review, S3): the buckets are
   * `count()`'s job now and the rows route declines the flag, so leaving it in
   * would split one page's cache across two keys over a parameter that changes
   * nothing about the response.
   */
  rows: (filters?: ListingsFilters, pagination?: ListingsPagination) =>
    ['listings', 'rows', listingRowFilters(filters), pagination ?? {}] as const,
  /**
   * The two-stage total, and the tab-bar buckets it is derived from (#2947).
   *
   * Carries no pagination - the answer depends on the filters alone - and the
   * caller additionally keys it without `lifecycle`, so switching tabs is a
   * cache hit rather than a refetch that blanks the tab bar (#2029).
   */
  count: (filters?: ListingsFilters) => ['listings', 'count', filters ?? {}] as const,
  detail: (id: string) => ['listings', 'detail', id] as const,
  marketplaceOffer: (mappingId: string) => ['listings', 'marketplaceOffer', mappingId] as const,
  offerCreationStatus: (connectionId: string, offerCreationRecordId: string) =>
    ['listings', 'offerCreationStatus', connectionId, offerCreationRecordId] as const,
  /** #1760 — live publication status of a product's offers (per snapshot). */
  offerPublicationStatus: (productId: string, connectionId?: string) =>
    ['listings', 'offerPublicationStatus', productId, connectionId ?? ''] as const,
  sellerPolicies: (connectionId: string) => ['listings', 'sellerPolicies', connectionId] as const,
  responsibleProducers: (connectionId: string) =>
    ['listings', 'responsibleProducers', connectionId] as const,
  deliveryPriceLists: (connectionId: string) =>
    ['listings', 'deliveryPriceLists', connectionId] as const,
  // The version constant at index 2 cache-busts every browser's in-flight
  // TanStack Query cache when the response shape changes. See #423 + the
  // CATEGORY_PARAMETERS_SCHEMA_VERSION JSDoc in listings.types.ts.
  categoryParameters: (connectionId: string, categoryId: string) =>
    [
      'listings',
      'categoryParameters',
      CATEGORY_PARAMETERS_SCHEMA_VERSION,
      connectionId,
      categoryId,
    ] as const,
  // #1752 — category breadcrumb resolution for the listing-detail drawer.
  categoryPath: (connectionId: string, categoryId: string) =>
    ['listings', 'categoryPath', connectionId, categoryId] as const,
  catalogProductMatch: (connectionId: string, barcode: string, categoryId: string) =>
    ['listings', 'catalogProductMatch', connectionId, barcode, categoryId] as const,
  catalogProduct: (connectionId: string, productId: string) =>
    ['listings', 'catalogProduct', connectionId, productId] as const,
  // #631 / #632 — EAN → Allegro category resolution. `sourceCategoryIds` is
  // included in the key so a future caller plumbing source-category info
  // doesn't share a cache entry with the wizard's barcode-only call.
  resolveCategory: (connectionId: string, barcode: string | null, sourceCategoryIds?: string[]) =>
    ['listings', 'resolveCategory', connectionId, barcode ?? '', sourceCategoryIds ?? []] as const,
  // #795 — batch EAN → Allegro category resolution for the bulk wizard.
  // Keyed on the variant-id set so a different selection doesn't share a
  // cache entry; distinct prefix from the single-row `resolveCategory` key.
  resolveCategoryBatch: (connectionId: string, variantIds: string[]) =>
    ['listings', 'resolveCategoryBatch', connectionId, variantIds] as const,
  /** #741 — bulk batch progress polling. */
  bulkBatch: (batchId: string) => ['listings', 'bulkBatch', batchId] as const,
  /** #1044 — single shop-publish record status polling. */
  shopPublishStatus: (connectionId: string, recordId: string) =>
    ['listings', 'shopPublishStatus', connectionId, recordId] as const,
  /** #1044 — bulk shop-publish batch progress polling. */
  bulkShopPublishBatch: (batchId: string) => ['listings', 'bulkShopPublishBatch', batchId] as const,
  /** #1834 — shop destination category tree, one parent level at a time. */
  shopCategories: (connectionId: string, parentId?: string) =>
    ['listings', 'shopCategories', connectionId, parentId ?? ''] as const,
  /** #1835 — shop destination global attributes. */
  shopAttributes: (connectionId: string) =>
    ['listings', 'shopAttributes', connectionId] as const,

  /** ADR-046: a destination's description contract, per connection. */
  descriptionFormat: (connectionId: string) =>
    ['listings', 'descriptionFormat', connectionId] as const,
  /** #1835 — predefined terms of one global attribute. */
  shopAttributeTerms: (connectionId: string, attributeId: string) =>
    ['listings', 'shopAttributeTerms', connectionId, attributeId] as const,
  /**
   * #1837 — destination-aware duplicate guard. Keyed on the connection + the
   * sorted variant-id set so a different destination or selection never shares
   * a cache entry.
   */
  publishedVariants: (connectionId: string, variantIds: readonly string[]) =>
    ['listings', 'publishedVariants', connectionId, [...variantIds].sort()] as const,
};

/**
 * A rows-only request's filters: everything except `includeLifecycleCounts`.
 *
 * The buckets moved to `count()` in #2943 and the rows route declines the flag
 * under `?withTotal=false`, so carrying it splits one page's cache across two
 * keys over a parameter that changes nothing about the response (#2957 review,
 * S3). Exported so the key and the URL narrow through one function.
 */
export function listingRowFilters(
  filters?: ListingsFilters,
): Omit<ListingsFilters, 'includeLifecycleCounts'> {
  if (!filters) return {};
  const rowFilters: Omit<ListingsFilters, 'includeLifecycleCounts'> = { ...filters };
  delete (rowFilters as Partial<ListingsFilters>).includeLifecycleCounts;
  return rowFilters;
}

/**
 * A COUNT request's filters: everything that decides membership, plus the
 * buckets, minus the tab.
 *
 * `lifecycle` is omitted so switching tabs is a cache hit rather than a
 * refetch that blanks the tab bar (#2029), and `includeLifecycleCounts` is
 * forced on because this one request answers both aggregates.
 *
 * Written as OMISSION rather than enumeration (#2957 review round 3, I5).
 * Every field of `ListingsFilters` is optional, so an enumerating version
 * compiles cleanly when a fifth membership filter is added and silently drops
 * it from the count - the pager and the whole tab bar would then answer for a
 * broader set, presented as `known`. That is the authoritative-wrong-number
 * failure this epic exists to prevent.
 */
export function listingCountFilters(filters: ListingsFilters): ListingsFilters {
  const countFilters: ListingsFilters = { ...filters, includeLifecycleCounts: true };
  delete countFilters.lifecycle;
  return countFilters;
}
