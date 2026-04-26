import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useSyncJobsQuery } from './use-sync-jobs-query';
import type { PaginatedSyncJobs } from '../api/sync-jobs.types';

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

const mockResult: PaginatedSyncJobs = {
  items: [
    {
      id: 'job-1',
      jobType: 'marketplace.orders.poll',
      connectionId: 'conn-1',
      status: 'queued',
      outcome: null,
      attempts: 0,
      maxAttempts: 10,
      nextRunAt: '2026-01-01T00:00:00.000Z',
      lastError: null,
      payloadJson: null,
      idempotencyKey: 'key-1',
      lockedAt: null,
      lockedBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

describe('useSyncJobsQuery', () => {
  it('should return paginated jobs on success', async () => {
    const apiClient = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue(mockResult) },
    });

    const { result } = renderHook(() => useSyncJobsQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.items).toHaveLength(1);
    expect(result.current.data?.total).toBe(1);
    expect(apiClient.syncJobs.list).toHaveBeenCalledWith(undefined, undefined);
  });

  it('should pass filters to the API client', async () => {
    const apiClient = createMockApiClient({
      syncJobs: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 10, offset: 20 }),
      },
    });

    renderHook(() => useSyncJobsQuery({ status: 'dead' }, { limit: 10, offset: 20 }), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() =>
      expect(apiClient.syncJobs.list).toHaveBeenCalledWith(
        { status: 'dead' },
        { limit: 10, offset: 20 },
      ),
    );
  });
});
