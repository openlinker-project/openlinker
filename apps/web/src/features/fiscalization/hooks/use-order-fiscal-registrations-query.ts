/**
 * useOrderFiscalRegistrationsQuery (#1909)
 *
 * Fetches every fiscal registration record held by an order. Unlike invoicing's
 * 404-to-null pattern, the BE endpoint returns an empty list for a never-asked
 * order — there is no absent-record 404 to remap, because OpenLinker never
 * asserts that an order requires a registration.
 *
 * Polls while the newest record is `pending` / `registering`, so the manual
 * "Register receipt" action's in-flight state resolves on its own.
 *
 * @module apps/web/src/features/fiscalization/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { fiscalizationQueryKeys } from '../api/fiscalization.query-keys';
import type { FiscalRegistrationRecord } from '../api/fiscalization.types';

const FISCAL_POLL_MS = 5000;

export function useOrderFiscalRegistrationsQuery(
  orderId: string,
): UseQueryResult<FiscalRegistrationRecord[]> {
  const apiClient = useApiClient();

  return useQuery<FiscalRegistrationRecord[]>({
    queryKey: fiscalizationQueryKeys.forOrder(orderId),
    enabled: Boolean(orderId),
    queryFn: (): Promise<FiscalRegistrationRecord[]> =>
      apiClient.fiscalization.listForOrder(orderId),
    refetchInterval: (query) => {
      const newest = query.state.data?.[0];
      const s = newest?.status;
      return s === 'pending' || s === 'registering' ? FISCAL_POLL_MS : false;
    },
  });
}
