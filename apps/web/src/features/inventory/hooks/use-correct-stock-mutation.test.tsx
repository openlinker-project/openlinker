import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { productsQueryKeys } from '../../products/api/products.query-keys';
import { useCorrectStockMutation } from './use-correct-stock-mutation';

describe('useCorrectStockMutation', () => {
  it('should invalidate the products list and detail caches when a correction settles', async () => {
    const apiClient = createMockApiClient({
      inventory: { correctStock: vi.fn().mockResolvedValue({ status: 'applied' }) },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(productsQueryKeys.list(), { items: [] });
    queryClient.setQueryData(productsQueryKeys.detail('p1'), { id: 'p1' });
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );

    const { result } = renderHook(() => useCorrectStockMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        productVariantId: 'v1',
        input: { mode: 'set', quantity: 3, operatorReason: 'count_correction' },
      });
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(productsQueryKeys.list())?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(productsQueryKeys.detail('p1'))?.isInvalidated).toBe(true);
    });
  });
});
