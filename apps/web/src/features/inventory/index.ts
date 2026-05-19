/**
 * Inventory feature public surface.
 *
 * Cross-feature and plugin consumers import only the symbols re-exported
 * here — never deep paths into api/ / hooks/ / components/. See
 * docs/frontend-architecture.md § Feature Public Surface.
 *
 * Existing list/detail hooks (`useInventoryQuery`, `useInventoryItemQuery`)
 * are intentionally not re-exported because they have no cross-feature
 * consumer today; they can be added in a one-line edit when a need arises.
 *
 * @module apps/web/src/features/inventory
 */
export type {
  InventoryAvailability,
  InventoryAvailabilityResponse,
  InventoryItem,
  PaginatedInventory,
  InventoryFilters,
  InventoryPagination,
} from './api/inventory.types';

export { useInventoryAvailabilityBatchQuery } from './hooks/use-inventory-availability-batch-query';
