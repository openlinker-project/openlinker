/**
 * Inventory feature public surface.
 *
 * Cross-feature and plugin consumers import only the symbols re-exported
 * here — never deep paths into api/ / hooks/ / components/. See
 * docs/frontend-architecture.md § Feature Public Surface.
 *
 * `useInventoryQuery` is intentionally not re-exported here — its two
 * consumers (`pages/inventory/inventory-list-page.tsx`, the cross-product
 * stock-overview page, and `pages/products/product-detail-page.tsx`) both
 * deep-import it directly, the same page-level pattern the removed Inventory
 * detail page used for `useListingsQuery`. Add it to the barrel in a
 * one-line edit if a cross-feature (non-page) consumer needs it.
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
