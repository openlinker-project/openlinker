/**
 * useAuthorizeReturnMutation (#2372/#2376)
 *
 * Authorize an operator-authored return. The mutation takes no input beyond
 * the return id — the write itself carries nothing else (§3080).
 *
 * `onSettled`, matching `useDeclineReturnMutation`: a refused attempt
 * (`source-ingested`) touches nothing, but the caller cannot assume that from
 * the shape of the error alone, so a re-read is the honest way to state
 * whatever the record now says.
 *
 * @module apps/web/src/features/returns/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { AuthorizeReturnResult } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useAuthorizeReturnMutation(
  returnId: string
): UseMutationResult<AuthorizeReturnResult, Error, void> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<AuthorizeReturnResult, Error, void>({
    mutationFn: () => apiClient.returns.authorize(returnId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: returnsQueryKeys.detail(returnId) });
      await queryClient.invalidateQueries({ queryKey: returnsQueryKeys.all });
    },
  });
}
