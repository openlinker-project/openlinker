import type { InventoryFilters, InventoryPagination } from './inventory.types';
import type {
  InventoryMovementFilters,
  InventoryMovementPagination,
} from './inventory-movements.types';
import type { InventoryLocationFilters, InventoryLocationListPagination } from './inventory-locations.types';

export const inventoryQueryKeys = {
  all: ['inventory'] as const,
  list: (filters?: InventoryFilters, pagination?: InventoryPagination) =>
    ['inventory', 'list', filters ?? {}, pagination ?? {}] as const,
  detail: (id: string) => ['inventory', 'detail', id] as const,
  // #3569 - one product's stock view; a sibling of `list`, not a child, so the
  // locations/list invalidations do not drop it.
  stockView: (productId: string) => ['inventory', 'stock-view', productId] as const,
  // #2407 — install-wide, so no connection axis: the active-location count is
  // a property of the deployment, not of the connection whose page renders it.
  activeLocations: () => ['inventory', 'locations', 'active'] as const,
  // Sorted-join makes the cache key stable across call-site orderings of
  // the same ID set — so two callers requesting [a, b] and [b, a] hit the
  // same cache entry. The empty-list case is encoded as the empty string,
  // but the hook never fires for empty input so it's never used.
  availability: (variantIds: readonly string[]) =>
    ['inventory', 'availability', [...variantIds].sort().join(',')] as const,
  /**
   * The shared prefix of every locations-registry key below (`activeLocations`
   * included, since it shares the `['inventory', 'locations']` root) — the
   * one key a create/update/delete mutation invalidates against (#3065), the
   * `sales-document-rules` `all` shape applied to this sub-domain rather than
   * the whole `inventory` root, which would also drop the unrelated stock
   * list/detail/availability caches.
   */
  locationsAll: () => ['inventory', 'locations'] as const,
  locations: (filters?: InventoryLocationFilters, pagination?: InventoryLocationListPagination) =>
    ['inventory', 'locations', 'list', filters ?? {}, pagination ?? {}] as const,
  locationDetail: (id: string) => ['inventory', 'locations', 'detail', id] as const,
  // #2319/#3072 — the diagnostic reads only `maxGroups`, no connection axis
  // (the readiness gate is install-wide, not per connection).
  duplicatePositions: (maxGroups?: number) =>
    ['inventory', 'duplicate-positions', maxGroups ?? null] as const,
  // #3240 — install-wide live read, same axis-free shape as duplicatePositions.
  provenanceBackfillStatus: () => ['inventory', 'provenance-backfill-status'] as const,
  // #3568 - rows and the count are keyed apart so a count is cached per filter
  // set and never shared across pages.
  movementsAll: () => ['inventory', 'movements'] as const,
  movements: (filters?: InventoryMovementFilters, pagination?: InventoryMovementPagination) =>
    ['inventory', 'movements', 'rows', filters ?? {}, pagination ?? {}] as const,
  movementsCount: (filters?: InventoryMovementFilters) =>
    ['inventory', 'movements', 'count', filters ?? {}] as const,
};
