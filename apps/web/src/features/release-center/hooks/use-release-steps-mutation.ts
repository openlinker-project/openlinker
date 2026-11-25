/**
 * Installation step mutation (#4146)
 *
 * `PUT /release-state/steps` (admin only). For anyone else it resolves to `[]`
 * without issuing a request, so an operator or viewer save never produces a
 * call or an error. Optimistic with rollback; the release-state query is
 * invalidated afterwards so the bell refreshes.
 *
 * Use `doneVia: 'manual'` for the explicit "Looks right, no change needed"
 * action and `'auto'` for completions observed from a real save.
 *
 * @module features/release-center/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { releaseStateQueryKeys } from '../api/release-state.query-keys';
import type {
  InstallationReleaseItemChange,
  ReleaseItemState,
  ReleaseState,
} from '../api/release-state.types';
import { applyInstallationChanges } from '../lib/release-state-merge';
import { useReleaseCenterAccess } from './use-release-center-access';

interface Context {
  previous: ReleaseState | undefined;
}

export function useReleaseStepsMutation(): UseMutationResult<
  ReleaseItemState[],
  Error,
  readonly InstallationReleaseItemChange[],
  Context
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { canWriteSteps } = useReleaseCenterAccess();
  const key = releaseStateQueryKeys.state();

  return useMutation<ReleaseItemState[], Error, readonly InstallationReleaseItemChange[], Context>({
    mutationKey: ['release-state', 'steps'],
    mutationFn: async (changes) => {
      if (!canWriteSteps || changes.length === 0) return [];
      return apiClient.releaseState.updateSteps(changes);
    },
    onMutate: async (changes) => {
      if (!canWriteSteps) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ReleaseState>(key);
      if (previous) {
        queryClient.setQueryData<ReleaseState>(
          key,
          applyInstallationChanges(previous, changes, new Date().toISOString())
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
