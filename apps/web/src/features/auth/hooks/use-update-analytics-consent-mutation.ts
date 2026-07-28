/**
 * useUpdateAnalyticsConsentMutation Hook
 *
 * Provides a mutation for updating the user's analytics consent preference.
 * On success, refreshes the session to update the JWT with the new consent value.
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
  const { refreshSession } = useSession();

  return useMutation({
    mutationFn: async (input: UpdateAnalyticsConsentRequest) => {
      const response = await apiClient.auth.updateAnalyticsConsent(input);
      await refreshSession();
      return response;
    },
  });
}
