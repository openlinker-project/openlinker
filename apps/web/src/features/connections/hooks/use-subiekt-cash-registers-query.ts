import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { SubiektCashRegister } from '../api/connections.types';

/**
 * Cash-register (Stanowisko Kasowe) list for a Subiekt connection (#1324) — a
 * real, working per-document selector. Unfiltered: the Oddział axis is not
 * selectable (bound to the bridge's Sfera session, decision 8b), so there is
 * nothing to filter by; each register's `oddzialId` is an informational tag.
 * Retries disabled — a failure resolves to the "no registers" UI fallback.
 */
export function useSubiektCashRegistersQuery(
  connectionId: string | undefined,
  options?: { enabled?: boolean },
): UseQueryResult<SubiektCashRegister[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionsQueryKeys.subiektCashRegisters(connectionId ?? ''),
    queryFn: () => apiClient.connections.getSubiektCashRegisters(connectionId!),
    enabled: (options?.enabled ?? true) && connectionId !== undefined && connectionId.length > 0,
    retry: false,
  });
}
