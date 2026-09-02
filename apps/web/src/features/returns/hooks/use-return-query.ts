/**
 * useReturnQuery (#2336)
 *
 * Reads one return with its lines. Disabled for an empty id so a malformed URL
 * asks the server nothing.
 *
 * @module apps/web/src/features/returns/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { ReturnDetail } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useReturnQuery(returnId: string): UseQueryResult<ReturnDetail> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: returnsQueryKeys.detail(returnId),
    queryFn: () => apiClient.returns.get(returnId),
    enabled: returnId !== '',
  });
}
