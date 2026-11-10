/**
 * useProductCountProbes tests (#4027)
 *
 * The probes must read the count endpoint under the count key (shared with
 * `useProductsTotal`), honour a per-probe gate, and report an unknown count as
 * `undefined` rather than 0.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { productsQueryKeys } from '../api/products.query-keys';
import {
  PRODUCT_COUNT_PROBE_STALE_TIME_MS,
  useProductCountProbes,
  type ProductCountProbe,
} from './use-product-count-probes';

function setup(apiClient: ReturnType<typeof createMockApiClient>): {
  queryClient: QueryClient;
  wrapper: ({ children }: PropsWithChildren) => ReactElement;
} {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  };
  return { queryClient, wrapper };
}

describe('useProductCountProbes', () => {
  it('should read each count from the count endpoint, never a list page', async () => {
    const list = vi.fn();
    const count = vi
      .fn()
      .mockImplementation((filters?: { stock?: string }) =>
        Promise.resolve({ total: filters?.stock === 'out' ? 3 : 10 }),
      );
    const apiClient = createMockApiClient({ products: { list, count } });
    const probes: ProductCountProbe[] = [{ filters: undefined }, { filters: { stock: 'out' } }];

    const { result } = renderHook(() => useProductCountProbes(probes), {
      wrapper: setup(apiClient).wrapper,
    });

    await waitFor(() => {
      expect(result.current).toEqual([10, 3]);
    });
    expect(count).toHaveBeenCalledWith({ stock: 'out' }, expect.objectContaining({ signal: expect.anything() }));
    expect(list).not.toHaveBeenCalled();
  });

  it('should cache under the count key with the probe staleTime when the probe settles', async () => {
    const count = vi.fn().mockResolvedValue({ total: 4 });
    const apiClient = createMockApiClient({ products: { count } });
    const { queryClient, wrapper } = setup(apiClient);
    const probes: ProductCountProbe[] = [{ filters: { connectionId: 'conn_a' } }];

    const { result } = renderHook(() => useProductCountProbes(probes), { wrapper });

    await waitFor(() => {
      expect(result.current).toEqual([4]);
    });
    const cached = queryClient.getQueryCache().find({
      queryKey: productsQueryKeys.count({ connectionId: 'conn_a' }),
      exact: true,
    });
    expect(cached?.state.data).toEqual({ total: 4 });
    expect(queryClient.getQueryCache().findAll({ queryKey: ['products', 'list'] })).toHaveLength(0);
    expect(PRODUCT_COUNT_PROBE_STALE_TIME_MS).toBeGreaterThan(0);
  });

  it('should not request a disabled probe and report it as unknown', async () => {
    const count = vi.fn().mockResolvedValue({ total: 7 });
    const apiClient = createMockApiClient({ products: { count } });
    const probes: ProductCountProbe[] = [
      { filters: { stock: 'low' } },
      { filters: { unlistedOn: ['conn_a'] }, enabled: false },
    ];

    const { result } = renderHook(() => useProductCountProbes(probes), {
      wrapper: setup(apiClient).wrapper,
    });

    await waitFor(() => {
      expect(result.current[0]).toBe(7);
    });
    expect(result.current[1]).toBeUndefined();
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('should report a failed count as undefined, never 0', async () => {
    const count = vi.fn().mockRejectedValue(new Error('count blew up'));
    const apiClient = createMockApiClient({ products: { count } });
    const probes: ProductCountProbe[] = [{ filters: { stock: 'oversold' } }];

    const { result } = renderHook(() => useProductCountProbes(probes), {
      wrapper: setup(apiClient).wrapper,
    });

    await waitFor(() => {
      expect(count).toHaveBeenCalled();
    });
    expect(result.current).toEqual([undefined]);
  });
});
