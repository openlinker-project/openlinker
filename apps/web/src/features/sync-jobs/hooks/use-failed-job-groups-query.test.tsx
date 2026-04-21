import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useFailedJobGroupsQuery } from './use-failed-job-groups-query';
import type { SyncJobGroupsResponse } from '../api/sync-jobs.types';

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>,
): ({ children }: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  };
}

const mockResult: SyncJobGroupsResponse = {
  groups: [
    {
      connectionId: 'conn-1',
      jobType: 'master.inventory.syncByExternalId',
      count: 3,
      latestUpdatedAt: '2026-01-01T00:00:00.000Z',
      representativeJobId: 'job-3',
      lastError: 'foreign key violation',
    },
  ],
  totalGroups: 1,
  totalJobs: 3,
};

describe('useFailedJobGroupsQuery', () => {
  it('should default to status=dead when no filter is provided', async () => {
    const apiClient = createMockApiClient({
      syncJobs: { listGrouped: vi.fn().mockResolvedValue(mockResult) },
    });

    const { result } = renderHook(() => useFailedJobGroupsQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.totalJobs).toBe(3);
    expect(apiClient.syncJobs.listGrouped).toHaveBeenCalledWith({ status: 'dead' });
  });

  it('should pass explicit filters to the API client', async () => {
    const apiClient = createMockApiClient({
      syncJobs: {
        listGrouped: vi.fn().mockResolvedValue({ groups: [], totalGroups: 0, totalJobs: 0 }),
      },
    });

    renderHook(
      () => useFailedJobGroupsQuery({ status: 'dead', connectionId: 'conn-1', limit: 50 }),
      {
        wrapper: createWrapper(apiClient),
      },
    );

    await waitFor(() =>
      expect(apiClient.syncJobs.listGrouped).toHaveBeenCalledWith({
        status: 'dead',
        connectionId: 'conn-1',
        limit: 50,
      }),
    );
  });
});
