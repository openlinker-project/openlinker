import { CATEGORY_PARAMETERS_SCHEMA_VERSION } from './listings.types';
import type { ListingsFilters, ListingsPagination } from './listings.types';

export const listingsQueryKeys = {
  all: ['listings'] as const,
  // Matches every `list(...)` key as a prefix — use for cross-cutting invalidation
  // after mutations that may add new rows without invalidating polling / cached queries.
  lists: () => ['listings', 'list'] as const,
  list: (filters?: ListingsFilters, pagination?: ListingsPagination) =>
    ['listings', 'list', filters ?? {}, pagination ?? {}] as const,
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
};
