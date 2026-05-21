import type { InventoryFilters, InventoryPagination } from './inventory.types';

export const inventoryQueryKeys = {
  all: ['inventory'] as const,
  list: (filters?: InventoryFilters, pagination?: InventoryPagination) =>
    ['inventory', 'list', filters ?? {}, pagination ?? {}] as const,
  detail: (id: string) => ['inventory', 'detail', id] as const,
  // Sorted-join makes the cache key stable across call-site orderings of
  // the same ID set — so two callers requesting [a, b] and [b, a] hit the
  // same cache entry. The empty-list case is encoded as the empty string,
  // but the hook never fires for empty input so it's never used.
  availability: (variantIds: readonly string[]) =>
    ['inventory', 'availability', [...variantIds].sort().join(',')] as const,
};
