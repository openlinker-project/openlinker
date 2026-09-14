/**
 * Customers API Client
 *
 * Thin API module for the customers feature. Provides typed methods for
 * listing customer projections and fetching individual customer details
 * with addresses.
 *
 * @module apps/web/src/features/customers/api
 */
import type { PaginatedTotal, RowsPage } from '../../../shared/api/paginated-total.types';
import type {
  CustomerFilters,
  CustomerPagination,
  CustomerProjection,
  CustomerProjectionDetail,
  PaginatedCustomers,
} from './customers.types';

export interface CustomersApi {
  list: (filters?: CustomerFilters, pagination?: CustomerPagination) => Promise<PaginatedCustomers>;
  /**
   * The page WITHOUT its total (#2947). Pair with {@link CustomersApi.count} -
   * the `ILIKE` search means the count cannot stop early, so the rows must not
   * wait for it.
   */
  listRows: (
    filters?: CustomerFilters,
    pagination?: CustomerPagination,
  ) => Promise<RowsPage<CustomerProjection>>;
  /** The total WITHOUT its page (#2947). Takes the filters alone. */
  count: (filters?: CustomerFilters, init?: RequestInit) => Promise<PaginatedTotal>;
  getById: (id: string) => Promise<CustomerProjectionDetail>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(
  filters?: CustomerFilters,
  pagination?: CustomerPagination,
  options?: { withTotal?: false },
): string {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.lastSourceConnectionId) params.set('lastSourceConnectionId', filters.lastSourceConnectionId);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  if (options?.withTotal === false) params.set('withTotal', 'false');
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createCustomersApi(request: ApiRequest): CustomersApi {
  return {
    list(filters, pagination): Promise<PaginatedCustomers> {
      return request<PaginatedCustomers>(`/customers${buildQuery(filters, pagination)}`);
    },
    listRows(filters, pagination): Promise<RowsPage<CustomerProjection>> {
      return request<RowsPage<CustomerProjection>>(
        `/customers${buildQuery(filters, pagination, { withTotal: false })}`,
      );
    },
    count(filters, init): Promise<PaginatedTotal> {
      // No pagination: the answer depends on the filters alone, which is what
      // lets one cached count serve every page of a result set.
      return request<PaginatedTotal>(`/customers/count${buildQuery(filters)}`, init);
    },
    getById(id): Promise<CustomerProjectionDetail> {
      return request<CustomerProjectionDetail>(`/customers/${id}`);
    },
  };
}
