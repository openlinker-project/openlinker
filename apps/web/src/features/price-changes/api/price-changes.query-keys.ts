/**
 * Price Changes Query Keys (#3147)
 *
 * @module apps/web/src/features/price-changes/api
 */
import type { ListPriceChangesFilters } from './price-changes.types';

export const priceChangesQueryKeys = {
  all: ['price-changes'] as const,
  list: (filters?: ListPriceChangesFilters) =>
    [
      'price-changes',
      'list',
      filters?.connectionId ?? 'all',
      filters?.direction ?? 'all',
      filters?.magnitudeLarge ?? false,
      filters?.limit ?? 'default-limit',
      filters?.offset ?? 0,
    ] as const,
  autoApplied: () => ['price-changes', 'auto-applied'] as const,
};
