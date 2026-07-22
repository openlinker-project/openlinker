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

export interface InventoryApi {
  list: (filters?: InventoryFilters, pagination?: InventoryPagination) => Promise<PaginatedInventory>;
  /**
   * Batch lookup of per-variant availability (#792 PR 2). Caller is
   * responsible for deduping (the hook does this) and chunking when the
   * list exceeds the server-side cap (200 IDs per request).
   */
  availability: (productVariantIds: readonly string[]) => Promise<InventoryAvailabilityResponse>;
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
  };
}
