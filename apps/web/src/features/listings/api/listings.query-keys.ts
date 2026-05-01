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
  marketplaceOffer: (mappingId: string) =>
    ['listings', 'marketplaceOffer', mappingId] as const,
  offerCreationStatus: (connectionId: string, offerCreationRecordId: string) =>
    ['listings', 'offerCreationStatus', connectionId, offerCreationRecordId] as const,
  sellerPolicies: (connectionId: string) =>
    ['listings', 'sellerPolicies', connectionId] as const,
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
};
