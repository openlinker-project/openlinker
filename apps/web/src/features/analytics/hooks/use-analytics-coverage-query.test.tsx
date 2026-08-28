import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useAnalyticsCoverageQuery } from './use-analytics-coverage-query';
import type { AnalyticsCoverage } from '../api/analytics-coverage.types';

const FILTERS = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' };

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>
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

function coverage(overrides: Partial<AnalyticsCoverage> = {}): AnalyticsCoverage {
  return {
    categories: [
      { category: 'currency', status: 'open', affectedCount: 0, sampleOrderIds: [] },
      { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
      { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
      { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
      { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
    ],
    ...overrides,
  };
}

describe('useAnalyticsCoverageQuery (#2475)', () => {
  it('should keep polling disabled when no category is in-progress', async () => {
    const apiClient = createMockApiClient({
      analytics: { getCoverage: vi.fn().mockResolvedValue(coverage()) },
    });

    const { result } = renderHook(() => useAnalyticsCoverageQuery(FILTERS), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // @tanstack/react-query resolves a function `refetchInterval` internally;
    // asserting the OBSERVABLE effect (no scheduled refetch) is what the AC
    // actually cares about, not the private option shape.
    expect(apiClient.analytics.getCoverage).toHaveBeenCalledTimes(1);
  });

  it('should poll while the currency category is in-progress and stop once it resolves', async () => {
    const inProgress = coverage({
      categories: [
        { category: 'currency', status: 'in-progress', affectedCount: 5, sampleOrderIds: [], activeRunId: 'ol_remrun_1' },
        { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
        { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
        { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
        { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
      ],
    });
    const resolved = coverage();
    const getCoverage = vi.fn().mockResolvedValueOnce(inProgress).mockResolvedValue(resolved);
    const apiClient = createMockApiClient({ analytics: { getCoverage } });

    const { result } = renderHook(() => useAnalyticsCoverageQuery(FILTERS), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.data?.categories[0].status).toBe('in-progress'));

    await waitFor(() => expect(result.current.data?.categories[0].status).toBe('open'), {
      timeout: 8000,
    });

    // Polling actually happened (more than the initial fetch) and then stopped
    // — a further wait sees no additional call once every category is 'open'.
    expect(getCoverage.mock.calls.length).toBeGreaterThan(1);
    const callsAfterResolve = getCoverage.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(getCoverage.mock.calls.length).toBe(callsAfterResolve);
  });
});
