/**
 * Shipments API Client
 *
 * Thin API module for the shipments feature (#770). Read-only list of
 * shipments across orders + connections, consuming the `GET /shipments`
 * paginated + filtered endpoint (#846 + #770 customer enrichment).
 *
 * @module apps/web/src/features/shipments/api
 */
import type {
  PaginatedShipments,
  ShipmentFilters,
  ShipmentPagination,
} from './shipments.types';

export interface ShipmentsApi {
  /**
   * List shipments with optional filters + pagination.
   *
   * NOTE: the backend enforces `pagination.limit` <= `SHIPMENTS_MAX_LIMIT`
   * (100); higher values return HTTP 400. Page via `offset`.
   */
  list: (filters?: ShipmentFilters, pagination?: ShipmentPagination) => Promise<PaginatedShipments>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: ShipmentFilters, pagination?: ShipmentPagination): string {
  const params = new URLSearchParams();
  if (filters?.orderId) params.set('orderId', filters.orderId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (filters?.shippingMethod) params.set('shippingMethod', filters.shippingMethod);
  if (filters?.hasTracking !== undefined) params.set('hasTracking', String(filters.hasTracking));
  if (filters?.createdFrom) params.set('createdFrom', filters.createdFrom);
  if (filters?.createdTo) params.set('createdTo', filters.createdTo);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createShipmentsApi(request: ApiRequest): ShipmentsApi {
  return {
    list(filters, pagination): Promise<PaginatedShipments> {
      return request<PaginatedShipments>(`/shipments${buildQuery(filters, pagination)}`);
    },
  };
}
