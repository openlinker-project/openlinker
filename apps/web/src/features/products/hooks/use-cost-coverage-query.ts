/**
 * Cost coverage reads (#3588, M30)
 *
 * The 30-day "sold without a cost" picture and the all-time variant counts
 * behind the Cost prices screens and the reminders on Products, Analytics and
 * the operations overview. A failed read costs the reminder, never the page.
 *
 * @module features/products/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { productsQueryKeys } from '../api/products.query-keys';
import type { CostCoverage, CostSummary } from '../api/products.types';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';

export const COST_COVERAGE_DAYS = 30;

export function useCostCoverageQuery(
  options?: { enabled?: boolean }
): UseQueryResult<CostCoverage, ApiError> {
  const apiClient = useApiClient();
  return useQuery<CostCoverage, ApiError>({
    queryKey: productsQueryKeys.costCoverage(COST_COVERAGE_DAYS),
    queryFn: () => apiClient.products.getCostCoverage(COST_COVERAGE_DAYS),
    enabled: options?.enabled ?? true,
    retry: false,
    staleTime: 30_000,
  });
}

export function useCostSummaryQuery(
  options?: { enabled?: boolean }
): UseQueryResult<CostSummary, ApiError> {
  const apiClient = useApiClient();
  return useQuery<CostSummary, ApiError>({
    queryKey: productsQueryKeys.costSummary,
    queryFn: () => apiClient.products.getCostSummary(),
    enabled: options?.enabled ?? true,
    retry: false,
    staleTime: 30_000,
  });
}
