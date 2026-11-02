/**
 * Order changes query tests (#3541, C-49).
 *
 * The poll sees an open cancel request confirmed by itself; the order record
 * (header badge) is a separate read and must be refetched when that happens.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useOrderChangesQuery } from './use-order-changes-query';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderChangeView } from '../api/order-cancel.types';

function cancelRequest(open: boolean): OrderChangeView {
  return {
    id: 'change_1',
    kind: 'order.cancel_request',
    status: open ? 'requested' : 'confirmed',
    open,
    requestedAt: '2026-04-20T10:00:00.000Z',
    confirmedAt: open ? null : '2026-04-20T10:01:00.000Z',
    declinedReason: null,
    payload: { cancelRequest: { reason: 'buyer-request', note: null }, correction: null },
  };
}

describe('useOrderChangesQuery', () => {
  it('should invalidate the orders domain when an open cancel request is confirmed (C-49)', async () => {
    const listOrderChanges = vi
      .fn()
      .mockResolvedValueOnce([cancelRequest(true)])
      .mockResolvedValue([cancelRequest(false)]);
    const apiClient = createMockApiClient({ orders: { listOrderChanges } as never });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useOrderChangesQuery('ol_order_1'), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.[0]?.open).toBe(true);
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    await queryClient.refetchQueries({ queryKey: ordersQueryKeys.changes('ol_order_1') });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ordersQueryKeys.all });
    });
  });
});
