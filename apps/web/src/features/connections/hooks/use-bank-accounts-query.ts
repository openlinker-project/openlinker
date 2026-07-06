import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { BankAccount } from '../api/connections.types';

/**
 * Live bank-account list for a connection (#1303 follow-up). Only meaningful
 * once the connection exists — pass `enabled: false` (or an undefined
 * `connectionId`) before that. Retries disabled: a 501 (adapter doesn't
 * support bank accounts) or a transient inFakt failure both resolve to the
 * same "Cash only" UI fallback, not a retry loop.
 */
export function useBankAccountsQuery(
  connectionId: string | undefined,
  options?: { enabled?: boolean },
): UseQueryResult<BankAccount[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionsQueryKeys.bankAccounts(connectionId ?? ''),
    queryFn: () => apiClient.connections.getBankAccounts(connectionId!),
    enabled: (options?.enabled ?? true) && connectionId !== undefined && connectionId.length > 0,
    retry: false,
  });
}
