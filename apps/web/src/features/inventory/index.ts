/**
 * Inventory feature public surface.
 *
 * Cross-feature and plugin consumers import only the symbols re-exported
 * here — never deep paths into api/ / hooks/ / components/. See
 * docs/frontend-architecture.md § Feature Public Surface.
 *
 * `useInventoryQuery` is intentionally not re-exported here — its only
 * cross-feature consumer (`pages/products/product-detail-page.tsx`) deep-imports
 * it directly, the same page-level pattern the removed Inventory detail page
 * used for `useListingsQuery`. Add it to the barrel in a one-line edit if a
 * second consumer needs it.
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
