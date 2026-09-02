/**
 * Inventory API Client
 *
 * Thin API module for the inventory feature. Provides typed methods for
 * listing inventory items and batch availability lookups.
 *
 * @module apps/web/src/features/inventory/api
 */
import type {
  InventoryFilters,
  InventoryPagination,
  PaginatedInventory,
  InventoryAvailabilityResponse,
} from './inventory.types';
import type {
  LocationBootstrapResult,
  PaginatedInventoryLocations,
} from './inventory-locations.types';

export interface InventoryApi {
  list: (filters?: InventoryFilters, pagination?: InventoryPagination) => Promise<PaginatedInventory>;
  /**
   * Batch lookup of per-variant availability (#792 PR 2). Caller is
   * responsible for deduping (the hook does this) and chunking when the
   * list exceeds the server-side cap (200 IDs per request).
   */
  availability: (productVariantIds: readonly string[]) => Promise<InventoryAvailabilityResponse>;
  /**
   * Active inventory locations (#2407). Only `total` is read — `limit: 1`
   * bounds the payload while `total` answers the question, so a hundred
   * locations cost the same round trip as one.
   */
  listActiveLocations: () => Promise<PaginatedInventoryLocations>;
  /**
   * Mint the first-run location, idempotently. Safe to call repeatedly: a code
   * that already exists comes back in `existingCodes` untouched.
   */
  bootstrapLocations: () => Promise<LocationBootstrapResult>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: InventoryFilters, pagination?: InventoryPagination): string {
  const params = new URLSearchParams();
  if (filters?.productId) params.set('productId', filters.productId);
  if (filters?.productVariantId) params.set('productVariantId', filters.productVariantId);
  if (filters?.locationId) params.set('locationId', filters.locationId);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createInventoryApi(request: ApiRequest): InventoryApi {
  return {
    list(filters, pagination): Promise<PaginatedInventory> {
      return request<PaginatedInventory>(`/inventory${buildQuery(filters, pagination)}`);
    },
    availability(productVariantIds): Promise<InventoryAvailabilityResponse> {
      const params = new URLSearchParams({ productVariantIds: productVariantIds.join(',') });
      return request<InventoryAvailabilityResponse>(`/inventory/availability?${params.toString()}`);
    },
    listActiveLocations(): Promise<PaginatedInventoryLocations> {
      return request<PaginatedInventoryLocations>('/inventory/locations?status=active&limit=1');
    },
    bootstrapLocations(): Promise<LocationBootstrapResult> {
      return request<LocationBootstrapResult>('/inventory/locations/bootstrap', { method: 'POST' });
    },
  };
}
