/**
 * Retry Sync Job Mutation Hook
 *
 * Provides a mutation for retrying a dead sync job. Invalidates the sync jobs
 * query cache on success so lists refresh automatically.
 *
 * @module apps/web/src/features/sync-jobs/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { syncJobsQueryKeys } from '../api/sync.query-keys';
import type { SyncJob } from '../api/sync-jobs.types';

export function useRetrySyncJobMutation(): UseMutationResult<SyncJob, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.syncJobs.retry(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: syncJobsQueryKeys.all });
    },
  });
}
