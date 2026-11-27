/**
 * Per-user item state mutation (#4146)
 *
 * `PUT /release-state/items`: archive, snooze, delete, reopen and "mark all"
 * (one batch of up to 50). Optimistic: the bell reflects the change at once and
 * rolls back to the snapshot if the write fails. Open to every role that may
 * read, since these are the caller's own rows.
 *
 * @module features/release-center/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { releaseStateQueryKeys } from '../api/release-state.query-keys';
import type {
  ReleaseItemState,
  ReleaseState,
  UserReleaseItemChange,
} from '../api/release-state.types';
import { applyUserChanges } from '../lib/release-state-merge';
import { useReleaseCenterAccess } from './use-release-center-access';

interface Context {
  previous: ReleaseState | undefined;
}

export function useReleaseItemStatesMutation(): UseMutationResult<
  ReleaseItemState[],
  Error,
  readonly UserReleaseItemChange[],
  Context
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { canRead } = useReleaseCenterAccess();
  const key = releaseStateQueryKeys.state();

  return useMutation<ReleaseItemState[], Error, readonly UserReleaseItemChange[], Context>({
    mutationKey: ['release-state', 'items'],
    mutationFn: async (changes) => {
      if (!canRead || changes.length === 0) return [];
      return apiClient.releaseState.updateItems(changes);
    },
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ReleaseState>(key);
      if (previous) {
        queryClient.setQueryData<ReleaseState>(
          key,
          applyUserChanges(previous, changes, new Date().toISOString())
        );
      }
      return { previous };
    },
    onError: (_error, _changes, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: releaseStateQueryKeys.all }),
  });
}
