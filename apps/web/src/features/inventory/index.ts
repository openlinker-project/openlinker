/**
 * Inventory feature public surface.
 *
 * Cross-feature and plugin consumers import only the symbols re-exported
 * here — never deep paths into api/ / hooks/ / components/. See
 * docs/frontend-architecture.md § Feature Public Surface.
 *
 * `useInventoryQuery` is intentionally not re-exported here — its consumers
 * (`pages/products/product-detail-page.tsx` and the products cockpit's
 * `ProductRowDetail`, which absorbed the removed `/inventory` list page in
 * #1720) deep-import it directly, the same page-level pattern the removed
 * Inventory detail page used for `useListingsQuery`. Add it to the barrel in
 * a one-line edit if a cross-feature (non-page) consumer needs it.
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

export type {
  CreateInventoryLocationInput,
  InventoryLocation,
  InventoryLocationFilters,
  InventoryLocationKind,
  InventoryLocationListPagination,
  InventoryLocationStatus,
  InventoryLocationSummary,
  LocationBootstrapResult,
  PaginatedInventoryLocations,
  UpdateInventoryLocationInput,
} from './api/inventory-locations.types';
export { InventoryLocationKindValues, InventoryLocationStatusValues } from './api/inventory-locations.types';

// #2407 — consumed by the connection detail page's routing-readiness panel,
// which lives in `features/connections` and so must reach these through the
// barrel rather than by a deep path.
export { useActiveLocationCountQuery } from './hooks/use-active-location-count-query';
export { useBootstrapLocationsMutation } from './hooks/use-bootstrap-locations-mutation';

// #2316 / #3065 — the full CRUD surface, consumed by the (upcoming) locations
// list page in `pages/inventory/`, which is a page rather than a feature and
// so must reach these through the barrel per the dependency rule.
export { useInventoryLocationsQuery } from './hooks/use-inventory-locations-query';
export { useInventoryLocationQuery } from './hooks/use-inventory-location-query';
export { useCreateInventoryLocationMutation } from './hooks/use-create-inventory-location-mutation';
export {
  useUpdateInventoryLocationMutation,
  type UpdateInventoryLocationMutationInput,
} from './hooks/use-update-inventory-location-mutation';
export { useDeleteInventoryLocationMutation } from './hooks/use-delete-inventory-location-mutation';

export { useInventoryAvailabilityBatchQuery } from './hooks/use-inventory-availability-batch-query';
// Query-key factory re-exported so the bulk wizard's chunked per-variant
// availability fan-out (#1741) shares cache entries with the batch hook above.
export { inventoryQueryKeys } from './api/inventory.query-keys';
