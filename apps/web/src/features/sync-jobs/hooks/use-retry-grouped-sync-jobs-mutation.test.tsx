import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useRetryGroupedSyncJobsMutation } from './use-retry-grouped-sync-jobs-mutation';
import { syncJobsQueryKeys } from '../api/sync.query-keys';

function createWrapperAndClient(
  apiClient: ReturnType<typeof createMockApiClient>,
): {
  wrapper: ({ children }: PropsWithChildren) => ReactElement;
  queryClient: QueryClient;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  };
  return { wrapper, queryClient };
}

describe('useRetryGroupedSyncJobsMutation', () => {
  it('should call retryGrouped and return the result', async () => {
    const apiClient = createMockApiClient({
      syncJobs: {
        retryGrouped: vi.fn().mockResolvedValue({
          requeuedJobIds: ['job-1', 'job-2'],
          count: 2,
          skipped: 1,
        }),
      },
    });

    const { wrapper } = createWrapperAndClient(apiClient);
    const { result } = renderHook(() => useRetryGroupedSyncJobsMutation(), { wrapper });

    result.current.mutate({ connectionId: 'conn-1', jobType: 'master.inventory.syncByExternalId' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.syncJobs.retryGrouped).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      jobType: 'master.inventory.syncByExternalId',
    });
    expect(result.current.data).toEqual({
      requeuedJobIds: ['job-1', 'job-2'],
      count: 2,
      skipped: 1,
    });
  });

  it('should invalidate sync-jobs queries on success', async () => {
    const apiClient = createMockApiClient({
      syncJobs: {
        retryGrouped: vi.fn().mockResolvedValue({ requeuedJobIds: [], count: 0, skipped: 0 }),
      },
    });

    const { wrapper, queryClient } = createWrapperAndClient(apiClient);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useRetryGroupedSyncJobsMutation(), { wrapper });

    result.current.mutate({ connectionId: 'conn-1', jobType: 'master.inventory.syncByExternalId' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: syncJobsQueryKeys.all });
  });
});
