/**
 * useUpdateAnalyticsConsentMutation Hook
 *
 * Provides a mutation for updating the user's analytics consent preference.
 *
 * On success it re-mints the access token before re-reading the session (#1938).
 * `refreshSession()` alone would not do: `getSession()` reuses the cached
 * in-memory token, so the account would keep presenting a token whose
 * `analyticsConsent` claim still says `false` and the API's global guard would
 * keep answering 403.
 *
 * @module features/auth/hooks
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import type { MeResponse, UpdateAnalyticsConsentRequest } from '../api/auth.types';

export function useUpdateAnalyticsConsentMutation(): UseMutationResult<
  MeResponse,
  Error,
  UpdateAnalyticsConsentRequest
> {
  const apiClient = useApiClient();
  const { adapter, refreshSession } = useSession();

  return useMutation({
    mutationFn: async (input: UpdateAnalyticsConsentRequest) => {
      const response = await apiClient.auth.updateAnalyticsConsent(input);
      // Optional per the SessionAdapter contract: an adapter with no
      // refresh-token flow omits it, and there is no stale claim to heal there.
      await adapter.refresh?.();
      await refreshSession();
      return response;
    },
  });
}
