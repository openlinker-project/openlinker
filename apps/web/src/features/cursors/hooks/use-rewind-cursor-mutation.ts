/**
 * useRewindCursorMutation (#4024)
 *
 * Moves a cursor back to a named target via POST /cursors/:connectionId/rewind.
 *
 * @module apps/web/src/features/cursors/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { cursorsQueryKeys } from '../api/cursors.query-keys';
import type { RewindCursorInput, RewindCursorResult } from '../api/cursors.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useRewindCursorMutation(): UseMutationResult<RewindCursorResult, Error, RewindCursorInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.cursors.rewind(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: cursorsQueryKeys.all });
    },
  });
}
