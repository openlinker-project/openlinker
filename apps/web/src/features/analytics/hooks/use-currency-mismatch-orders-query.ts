/**
 * Currency Mismatch Orders Query Hook
 *
 * Backs the `detail-currency` modal's real pagination (#2474 Phase 7) —
 * `GET /analytics/coverage/currency/orders`.
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { analyticsRemediationQueryKeys } from '../api/analytics-remediation.query-keys';
import type {
  CurrencyMismatchOrdersPage,
  GetCurrencyMismatchOrdersInput,
} from '../api/analytics-remediation.types';

export function useCurrencyMismatchOrdersQuery(
  input: GetCurrencyMismatchOrdersInput,
  options?: { enabled?: boolean }
): UseQueryResult<CurrencyMismatchOrdersPage> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: analyticsRemediationQueryKeys.currencyOrders(input),
    queryFn: () => apiClient.analytics.getCurrencyMismatchOrders(input),
    enabled: options?.enabled,
  });
}
