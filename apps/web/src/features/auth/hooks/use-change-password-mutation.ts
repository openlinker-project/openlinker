/**
 * useChangePasswordMutation Hook
 *
 * Replaces the account's password (#3456). On success it re-mints the access
 * token before re-reading the session, for the same reason the analytics-consent
 * mutation does: the API's `PasswordChangeRequiredGuard` reads a claim baked into
 * the token, so `refreshSession()` alone would keep presenting a token that still
 * says a change is owed and every route would keep answering 403.
 *
 * @module features/auth/hooks
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import type { ChangePasswordRequest, OkResponse } from '../api/auth.types';

export function useChangePasswordMutation(): UseMutationResult<
  OkResponse,
  Error,
  ChangePasswordRequest
> {
  const apiClient = useApiClient();
  const { adapter, refreshSession } = useSession();

  return useMutation({
    mutationFn: async (input: ChangePasswordRequest) => {
      const response = await apiClient.auth.changePassword(input);
      // Optional per the SessionAdapter contract: an adapter with no
      // refresh-token flow omits it, and there is no stale claim to heal there.
      await adapter.refresh?.();
      await refreshSession();
      return response;
    },
  });
}
