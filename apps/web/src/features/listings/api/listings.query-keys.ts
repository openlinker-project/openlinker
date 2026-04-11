import type { ListingsFilters, ListingsPagination } from './listings.types';

export const listingsQueryKeys = {
  all: ['listings'] as const,
  list: (filters?: ListingsFilters, pagination?: ListingsPagination) =>
    ['listings', 'list', filters ?? {}, pagination ?? {}] as const,
  detail: (id: string) => ['listings', 'detail', id] as const,
};
