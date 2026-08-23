/**
 * `useMarkPackedMutation` unit tests (#2288).
 *
 * The hook's contract is two facts: the boolean picks the verb, and BOTH verbs
 * invalidate the whole orders domain. The second is what keeps the row tick, the
 * detail control and the timeline entry from disagreeing, so it is asserted for
 * each direction rather than once.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useMarkPackedMutation } from './use-mark-packed-mutation';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { ordersQueryKeys } from '../api/orders.query-keys';

const ORDER_ID = 'ol_order_1';

function setup() {
  const orders = {
    markPacked: vi.fn().mockResolvedValue({ internalOrderId: ORDER_ID }),
    unmarkPacked: vi.fn().mockResolvedValue({ internalOrderId: ORDER_ID }),
  };
  const apiClient = createMockApiClient({ orders });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );

  const { result } = renderHook(() => useMarkPackedMutation(), { wrapper });
  return { orders, invalidateSpy, result };
}

describe('useMarkPackedMutation (#2288)', () => {
  it('marks packed and invalidates the whole orders domain', async () => {
    const { orders, invalidateSpy, result } = setup();

    result.current.mutate({ internalOrderId: ORDER_ID, packed: true });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(orders.markPacked).toHaveBeenCalledWith(ORDER_ID);
    expect(orders.unmarkPacked).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ordersQueryKeys.all });
  });

  it('clears the mark and invalidates the same domain', async () => {
    const { orders, invalidateSpy, result } = setup();

    result.current.mutate({ internalOrderId: ORDER_ID, packed: false });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(orders.unmarkPacked).toHaveBeenCalledWith(ORDER_ID);
    expect(orders.markPacked).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ordersQueryKeys.all });
  });
});
