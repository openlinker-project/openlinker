import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { EnqueueSyncJobInput, SyncJobResponse } from '../api/sync.api';
import { syncJobsQueryKeys } from '../api/sync.query-keys';

export function useEnqueueSyncJobMutation(): UseMutationResult<SyncJobResponse, Error, EnqueueSyncJobInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: EnqueueSyncJobInput) => apiClient.syncJobs.enqueue(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: syncJobsQueryKeys.all });
    },
  });
}
