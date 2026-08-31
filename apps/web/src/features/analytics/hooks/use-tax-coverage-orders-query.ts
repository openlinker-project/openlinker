/**
 * Tax Coverage Orders Query Hook
 *
 * Backs the `detail-tax` / `detail-novat` / `detail-postrollout` modals'
 * real pagination (#2474 Phase 7) — `GET /analytics/coverage/tax/orders`.
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { analyticsTaxCoverageQueryKeys } from '../api/analytics-tax-coverage.query-keys';
import type { GetTaxCoverageOrdersInput, TaxCoverageOrdersPage } from '../api/analytics-tax-coverage.types';

export function useTaxCoverageOrdersQuery(
  input: GetTaxCoverageOrdersInput,
  options?: { enabled?: boolean }
): UseQueryResult<TaxCoverageOrdersPage> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: analyticsTaxCoverageQueryKeys.orders(input),
    queryFn: () => apiClient.analytics.getTaxCoverageOrders(input),
    enabled: options?.enabled,
  });
}
