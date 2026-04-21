/**
 * Retry Grouped Sync Jobs Mutation Hook
 *
 * Bulk re-queue of every dead job matching a `(connectionId, jobType)`
 * group. Invalidates the sync jobs query cache on success so both the
 * grouped view and raw-list views refresh.
 *
 * @module apps/web/src/features/sync-jobs/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { syncJobsQueryKeys } from '../api/sync.query-keys';
import type {
  RetryGroupedSyncJobsInput,
  RetryGroupedSyncJobsResult,
} from '../api/sync-jobs.types';

export function useRetryGroupedSyncJobsMutation(): UseMutationResult<
  RetryGroupedSyncJobsResult,
  Error,
  RetryGroupedSyncJobsInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RetryGroupedSyncJobsInput) => apiClient.syncJobs.retryGrouped(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: syncJobsQueryKeys.all });
    },
  });
}
