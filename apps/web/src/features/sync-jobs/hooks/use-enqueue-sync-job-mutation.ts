import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { EnqueueSyncJobInput, SyncJobResponse } from '../api/sync.api';

export function useEnqueueSyncJobMutation(): UseMutationResult<SyncJobResponse, Error, EnqueueSyncJobInput> {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (input: EnqueueSyncJobInput) => apiClient.syncJobs.enqueue(input),
  });
}
