/**
 * Orders API Client
 *
 * Thin API module for the orders feature. Provides typed methods for
 * listing orders and fetching individual order details.
 *
 * @module apps/web/src/features/orders/api
 */
import type {
  OrderFilters,
  OrderPagination,
  PaginatedOrders,
  OrderRecord,
} from './orders.types';

export interface OrdersApi {
  list: (filters?: OrderFilters, pagination?: OrderPagination) => Promise<PaginatedOrders>;
  getById: (internalOrderId: string) => Promise<OrderRecord>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: OrderFilters, pagination?: OrderPagination): string {
  const params = new URLSearchParams();
  if (filters?.sourceConnectionId) params.set('sourceConnectionId', filters.sourceConnectionId);
  if (filters?.syncStatus) params.set('syncStatus', filters.syncStatus);
  if (filters?.customerId) params.set('customerId', filters.customerId);
  if (filters?.createdFrom) params.set('createdFrom', filters.createdFrom);
  if (filters?.createdTo) params.set('createdTo', filters.createdTo);
  if (filters?.recordStatus) params.set('recordStatus', filters.recordStatus);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createOrdersApi(request: ApiRequest): OrdersApi {
  return {
    list(filters, pagination): Promise<PaginatedOrders> {
      return request<PaginatedOrders>(`/orders${buildQuery(filters, pagination)}`);
    },
    getById(internalOrderId): Promise<OrderRecord> {
      return request<OrderRecord>(`/orders/${internalOrderId}`);
    },
  };
}
