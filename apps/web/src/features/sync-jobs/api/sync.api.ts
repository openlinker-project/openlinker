export interface EnqueueSyncJobInput {
  connectionId: string;
  syncType: string;
  payload?: Record<string, unknown>;
}

export interface SyncJobResponse {
  jobId: string;
  status: string;
}

export interface SyncJobsApi {
  enqueue: (input: EnqueueSyncJobInput) => Promise<SyncJobResponse>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createSyncJobsApi(request: ApiRequest): SyncJobsApi {
  return {
    enqueue(input) {
      return request<SyncJobResponse>('/sync/jobs', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
  };
}
