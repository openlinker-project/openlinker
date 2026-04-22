import type { ListingsFilters, ListingsPagination } from './listings.types';

export const listingsQueryKeys = {
  all: ['listings'] as const,
  // Matches every `list(...)` key as a prefix — use for cross-cutting invalidation
  // after mutations that may add new rows without invalidating polling / cached queries.
  lists: () => ['listings', 'list'] as const,
  list: (filters?: ListingsFilters, pagination?: ListingsPagination) =>
    ['listings', 'list', filters ?? {}, pagination ?? {}] as const,
  detail: (id: string) => ['listings', 'detail', id] as const,
  offerCreationStatus: (connectionId: string, offerCreationRecordId: string) =>
    ['listings', 'offerCreationStatus', connectionId, offerCreationRecordId] as const,
  sellerPolicies: (connectionId: string) =>
    ['listings', 'sellerPolicies', connectionId] as const,
};
