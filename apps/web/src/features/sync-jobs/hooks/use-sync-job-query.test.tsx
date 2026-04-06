import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useSyncJobQuery } from './use-sync-job-query';
import type { SyncJob } from '../api/sync-jobs.types';

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

const mockJob: SyncJob = {
  id: 'job-1',
  jobType: 'marketplace.orders.poll',
  connectionId: 'conn-1',
  status: 'succeeded',
  attempts: 1,
  maxAttempts: 10,
  nextRunAt: '2026-01-01T00:00:00.000Z',
  lastError: null,
  payloadJson: { key: 'value' },
  idempotencyKey: 'key-1',
  lockedAt: null,
  lockedBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('useSyncJobQuery', () => {
  it('should return job data on success', async () => {
    const apiClient = createMockApiClient({
      syncJobs: { getById: vi.fn().mockResolvedValue(mockJob) },
    });

    const { result } = renderHook(() => useSyncJobQuery('job-1'), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.id).toBe('job-1');
    expect(result.current.data?.status).toBe('succeeded');
    expect(apiClient.syncJobs.getById).toHaveBeenCalledWith('job-1');
  });

  it('should be disabled when id is empty', () => {
    const apiClient = createMockApiClient({
      syncJobs: { getById: vi.fn() },
    });

    const { result } = renderHook(() => useSyncJobQuery(''), {
      wrapper: createWrapper(apiClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(apiClient.syncJobs.getById).not.toHaveBeenCalled();
  });
});
