/**
 * Cost work list - rows and the two-stage total (#3588, M30)
 *
 * The rows arrive without a total and the number follows from `/count`, the
 * same split the products list uses (`docs/frontend-architecture.md` § Paginated
 * Totals As A Second Stage).
 *
 * Rows are deliberately NOT refetched on window focus or after a save: a row
 * the operator just priced would otherwise vanish from the "no cost" tab under
 * their cursor. The page keeps a local "saved" marker instead.
 *
 * @module features/products/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { productsQueryKeys } from '../api/products.query-keys';
import type {
  CostWorklistFilters,
  CostWorklistPage,
  CostWorklistPagination,
} from '../api/products.types';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';
import {
  inferTotalFromLoadedPage,
  usePaginatedTotal,
  type PaginatedTotalResult,
} from '../../../shared/hooks/use-paginated-total';

export function useCostWorklistRowsQuery(
  filters: CostWorklistFilters,
  pagination: CostWorklistPagination
): UseQueryResult<CostWorklistPage, ApiError> {
  const apiClient = useApiClient();
  return useQuery<CostWorklistPage, ApiError>({
    queryKey: productsQueryKeys.costWorklistRows(filters, pagination),
    queryFn: () => apiClient.products.getCostWorklist(filters, pagination),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}

export function useCostWorklistTotal(
  filters: CostWorklistFilters,
  page: CostWorklistPage | undefined
): PaginatedTotalResult {
  const apiClient = useApiClient();
  return usePaginatedTotal({
    queryKey: productsQueryKeys.costWorklistCount(filters),
    queryFn: ({ signal }) => apiClient.products.countCostWorklist(filters, { signal }),
    selectTotal: (data) => data.total,
    knownTotal: inferTotalFromLoadedPage(page),
    enabled: page !== undefined,
  });
}
