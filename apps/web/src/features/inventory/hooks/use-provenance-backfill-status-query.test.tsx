/**
 * useProvenanceBackfillStatusQuery tests (#3072)
 *
 * Covers the axis-free query key, the `latchedAt` field round-tripping
 * through the hook, and that a rejected request surfaces as an error.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useProvenanceBackfillStatusQuery } from './use-provenance-backfill-status-query';
import type { ProvenanceBackfillStatus } from '../api/inventory.types';

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>,
): ({ children }: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  };
}

describe('useProvenanceBackfillStatusQuery', () => {
  it('should call the api client with no arguments', async () => {
    const status: ProvenanceBackfillStatus = { remainingNull: 0, completed: true, latchedAt: null };
    const getProvenanceBackfillStatus = vi.fn().mockResolvedValue(status);
    const apiClient = createMockApiClient({ inventory: { getProvenanceBackfillStatus } });

    const { result } = renderHook(() => useProvenanceBackfillStatusQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getProvenanceBackfillStatus).toHaveBeenCalledWith();
    expect(result.current.data).toEqual(status);
  });

  it('should surface a latched, still-draining status untouched', async () => {
    const status: ProvenanceBackfillStatus = {
      remainingNull: 37,
      completed: false,
      latchedAt: '2026-08-01T00:00:00.000Z',
    };
    const apiClient = createMockApiClient({
      inventory: { getProvenanceBackfillStatus: vi.fn().mockResolvedValue(status) },
    });

    const { result } = renderHook(() => useProvenanceBackfillStatusQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.latchedAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('should surface an error when the request rejects', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getProvenanceBackfillStatus: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    });

    const { result } = renderHook(() => useProvenanceBackfillStatusQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});
