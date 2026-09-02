/**
 * useWhoDecidesStatusQuery
 *
 * The seven who-decides rows, the inert states and the preset catalogue.
 *
 * The read is authorised for a read-only role (#2353), so this hook is called
 * unconditionally — it is the write control that `useWriteAccess` gates, never
 * the page.
 *
 * @module apps/web/src/features/fulfillment-authority/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { whoDecidesQueryKeys } from '../api/who-decides.query-keys';
import type { AuthorityStatus } from '../api/who-decides.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useWhoDecidesStatusQuery(): UseQueryResult<AuthorityStatus | null> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: whoDecidesQueryKeys.status(),
    queryFn: () => apiClient.fulfillmentAuthority.getStatus(),
  });
}
