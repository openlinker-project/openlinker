/**
 * Customers list - the two-stage total (#2947)
 *
 * `customer_projections` is searched with an `ILIKE` across four columns, so
 * its `COUNT` cannot stop early however small the page is. The rows come from
 * `useCustomerRowsQuery`; this fetches the number beside them.
 *
 * @module features/customers/hooks
 */
import { customersQueryKeys } from '../api/customers.query-keys';
import type { CustomerFilters, CustomerProjection } from '../api/customers.types';
import type { RowsPage } from '../../../shared/api/paginated-total.types';
import {
  inferTotalFromLoadedPage,
  usePaginatedTotal,
  type PaginatedTotalResult,
} from '../../../shared/hooks/use-paginated-total';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * @param page the rows the list has already rendered. A SHORT page carries its
 *   own exact total, so the count is then never requested at all - which is
 *   what keeps this change invisible on an install whose list fits one page.
 *   Waiting for the page costs the total the rows query's own latency
 *   (measured at ~7 ms), against a count measured in the hundreds.
 */
export function useCustomersTotal(
  filters: CustomerFilters,
  page: RowsPage<CustomerProjection> | undefined
): PaginatedTotalResult {
  const apiClient = useApiClient();

  return usePaginatedTotal({
    queryKey: customersQueryKeys.count(filters),
    queryFn: ({ signal }) => apiClient.customers.count(filters, { signal }),
    selectTotal: (data) => data.total,
    knownTotal: inferTotalFromLoadedPage(page),
    enabled: page !== undefined,
  });
}
