/**
 * Release cursor mutation (#4146)
 *
 * Advances `lastSeenVersion` and/or sets `skipDialog`. A rejected write is
 * swallowed here on purpose: it is recorded in module memory (so the dialog
 * does not loop) and it never reaches the `MutationCache` `onError`, which
 * would otherwise send a consent-required 403 to `/consent` over a bookkeeping
 * write. Resolves to `null` when the write was rejected or not permitted.
 *
 * @module features/release-center/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { releaseStateQueryKeys } from '../api/release-state.query-keys';
import type {
  ReleaseState,
  UpdateReleaseCursorInput,
  UpdateReleaseCursorResult,
} from '../api/release-state.types';
import { markCursorWriteRejected } from './release-cursor-write-memory';
import { useReleaseCenterAccess } from './use-release-center-access';

export function useReleaseCursorMutation(): UseMutationResult<
  UpdateReleaseCursorResult | null,
  Error,
  UpdateReleaseCursorInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { canRead } = useReleaseCenterAccess();

  return useMutation({
    mutationKey: ['release-state', 'cursor'],
    mutationFn: async (input: UpdateReleaseCursorInput) => {
      if (!canRead) return null;
      try {
        const result = await apiClient.releaseState.updateCursor(input);
        queryClient.setQueryData<ReleaseState>(releaseStateQueryKeys.state(), (prev) =>
          prev ? { ...prev, cursor: result.cursor ?? prev.cursor } : prev
        );
        return result;
      } catch {
        if (input.version) markCursorWriteRejected(input.version);
        return null;
      }
    },
  });
}
