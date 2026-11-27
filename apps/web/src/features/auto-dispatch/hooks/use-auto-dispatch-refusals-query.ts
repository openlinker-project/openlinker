/**
 * Recent automatic-label refusals for one connection (#2729)
 *
 * @module apps/web/src/features/auto-dispatch/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { autoDispatchQueryKeys } from '../api/auto-dispatch.query-keys';
import type { AutoDispatchRefusals } from '../api/auto-dispatch.types';

const REFUSALS_LIMIT = 20;

export function useAutoDispatchRefusalsQuery(
  connectionId: string
): UseQueryResult<AutoDispatchRefusals | null> {
  const apiClient = useApiClient();
  return useQuery({
    enabled: connectionId.length > 0,
    queryKey: autoDispatchQueryKeys.refusals(connectionId),
    queryFn: () => apiClient.autoDispatch.getRefusals(connectionId, REFUSALS_LIMIT),
  });
}
