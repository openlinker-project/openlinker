import type { InventoryFilters, InventoryPagination } from './inventory.types';

export const inventoryQueryKeys = {
  all: ['inventory'] as const,
  list: (filters?: InventoryFilters, pagination?: InventoryPagination) =>
    ['inventory', 'list', filters ?? {}, pagination ?? {}] as const,
  detail: (id: string) => ['inventory', 'detail', id] as const,
};
