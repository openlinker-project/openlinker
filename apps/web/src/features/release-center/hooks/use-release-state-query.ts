/**
 * Release state query (#4146)
 *
 * Fires only when the session is ready AND the role may read. The server's
 * `enabled` flag (kill switch) is part of the data: use `useReleaseCenterEnabled`
 * to combine the two. A 404/5xx resolves to a disabled state, not an error.
 *
 * @module features/release-center/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { releaseStateQueryKeys } from '../api/release-state.query-keys';
import type { ReleaseState } from '../api/release-state.types';
import { useReleaseCenterAccess } from './use-release-center-access';

export function useReleaseStateQuery(): UseQueryResult<ReleaseState> {
  const apiClient = useApiClient();
  const { canRead } = useReleaseCenterAccess();
  return useQuery({
    enabled: canRead,
    queryKey: releaseStateQueryKeys.state(),
    queryFn: () => apiClient.releaseState.getState(),
    staleTime: 60_000,
  });
}

/** True only when access is granted AND the server reports the feature on. */
export function useReleaseCenterEnabled(): boolean {
  const { canRead } = useReleaseCenterAccess();
  const query = useReleaseStateQuery();
  return canRead && query.data?.enabled === true;
}
