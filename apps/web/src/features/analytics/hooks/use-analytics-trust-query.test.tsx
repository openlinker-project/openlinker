import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useAnalyticsTrustQuery } from './use-analytics-trust-query';
import type { AnalyticsTrustSnapshot } from '../api/analytics-trust.types';

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

const mockSnapshot: AnalyticsTrustSnapshot = {
  generatedAt: '2026-08-14T14:32:00.000Z',
  worstStatus: 'fresh',
  connections: [
    {
      connectionId: 'conn-1',
      connectionName: 'Allegro — main',
      platformType: 'allegro',
      connectionStatus: 'active',
      status: 'fresh',
      lastPollAt: '2026-08-14T14:32:00.000Z',
      lastOrderIngestedAt: '2026-08-14T12:00:00.000Z',
      connectionCreatedAt: '2026-01-01T00:00:00.000Z',
      earliestOrderDate: '2026-01-05T00:00:00.000Z',
      expectedIntervalMs: 300000,
      staleAfterMs: 900000,
    },
  ],
};

describe('useAnalyticsTrustQuery', () => {
  it('should return the trust snapshot on success', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: { getTrust: vi.fn().mockResolvedValue(mockSnapshot) },
    });

    const { result } = renderHook(() => useAnalyticsTrustQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.connections).toHaveLength(1);
    expect(apiClient.analyticsTrust.getTrust).toHaveBeenCalledTimes(1);
  });

  it('should report isLoading before the request resolves', () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getTrust: vi.fn(() => new Promise<AnalyticsTrustSnapshot>(() => {})),
      },
    });

    const { result } = renderHook(() => useAnalyticsTrustQuery(), {
      wrapper: createWrapper(apiClient),
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('should surface an error when the request rejects', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: { getTrust: vi.fn().mockRejectedValue(new Error('Network error')) },
    });

    const { result } = renderHook(() => useAnalyticsTrustQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});
