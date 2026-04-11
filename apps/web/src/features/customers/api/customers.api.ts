/**
 * Customers API Client
 *
 * Thin API module for the customers feature. Provides typed methods for
 * listing customer projections and fetching individual customer details
 * with addresses.
 *
 * @module apps/web/src/features/customers/api
 */
import type {
  CustomerFilters,
  CustomerPagination,
  CustomerProjectionDetail,
  PaginatedCustomers,
} from './customers.types';

export interface CustomersApi {
  list: (filters?: CustomerFilters, pagination?: CustomerPagination) => Promise<PaginatedCustomers>;
  getById: (id: string) => Promise<CustomerProjectionDetail>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: CustomerFilters, pagination?: CustomerPagination): string {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.lastSourceConnectionId) params.set('lastSourceConnectionId', filters.lastSourceConnectionId);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createCustomersApi(request: ApiRequest): CustomersApi {
  return {
    list(filters, pagination): Promise<PaginatedCustomers> {
      return request<PaginatedCustomers>(`/customers${buildQuery(filters, pagination)}`);
    },
    getById(id): Promise<CustomerProjectionDetail> {
      return request<CustomerProjectionDetail>(`/customers/${id}`);
    },
  };
}
