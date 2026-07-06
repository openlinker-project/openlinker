import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { SubiektBankAccount } from '../api/connections.types';

/**
 * Owner-aware bank-account list for a Subiekt connection (#1324). Unlike the
 * generic {@link useBankAccountsQuery} (neutral shape, no owner info), this hits
 * the Subiekt-specific route so the structured section can group accounts by
 * owning Podmiot and show the payer-routing warning only when >1 owner exists
 * (decision 6). Only meaningful once the connection exists and Transfer is the
 * selected payment method — pass `enabled: false` otherwise. Retries disabled:
 * a failure resolves to the same "no accounts" UI fallback, not a retry loop.
 */
export function useSubiektBankAccountsQuery(
  connectionId: string | undefined,
  options?: { enabled?: boolean },
): UseQueryResult<SubiektBankAccount[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionsQueryKeys.subiektBankAccounts(connectionId ?? ''),
    queryFn: () => apiClient.connections.getSubiektBankAccounts(connectionId!),
    enabled: (options?.enabled ?? true) && connectionId !== undefined && connectionId.length > 0,
    retry: false,
  });
}
