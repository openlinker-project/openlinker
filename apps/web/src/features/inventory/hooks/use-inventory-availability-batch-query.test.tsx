/**
 * useInventoryAvailabilityBatchQuery tests (#1709)
 *
 * Covers the optional retry passthrough added for the bulk-wizard resolve step:
 * the shared hook keeps its no-retry default for every existing caller, and
 * honours a caller-supplied retry policy when one is provided.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { useInventoryAvailabilityBatchQuery } from './use-inventory-availability-batch-query';

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>,
): ({ children }: PropsWithChildren) => ReactElement {
  // App-wide default is `retry: false`; a per-query retry option must win over it.
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

describe('useInventoryAvailabilityBatchQuery', () => {
  it('keeps the no-retry default when no retry option is supplied', async () => {
    const availability = vi.fn().mockRejectedValue(new ApiError('boom', 503, null));
    const apiClient = createMockApiClient({ inventory: { availability } });

    const { result } = renderHook(() => useInventoryAvailabilityBatchQuery(['var_1']), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    // No retry override -> a single call, matching the app-wide default.
    expect(availability).toHaveBeenCalledTimes(1);
  });

  it('retries per the supplied policy when a retry option is provided', async () => {
    const availability = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('boom', 503, null))
      .mockResolvedValue({ items: [{ productVariantId: 'var_1', totalAvailable: 3, locationCount: 1 }] });
    const apiClient = createMockApiClient({ inventory: { availability } });

    const { result } = renderHook(
      () => useInventoryAvailabilityBatchQuery(['var_1'], { retry: 1, retryDelay: 0 }),
      { wrapper: createWrapper(apiClient) },
    );

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); }, { timeout: 4000 });
    expect(availability).toHaveBeenCalledTimes(2);
  });

  it('does not fire a request when the deduped id list is empty', () => {
    const availability = vi.fn().mockResolvedValue({ items: [] });
    const apiClient = createMockApiClient({ inventory: { availability } });

    renderHook(() => useInventoryAvailabilityBatchQuery([], { retry: 3 }), {
      wrapper: createWrapper(apiClient),
    });

    expect(availability).not.toHaveBeenCalled();
  });
});
