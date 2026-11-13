/**
 * useOrderShipmentsQuery (#4104) - a status change between two reads re-reads
 * the order too; an unchanged read does not.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ordersQueryKeys } from '../../orders';
import { shipmentsQueryKeys } from '../api/shipments.query-keys';
import { useOrderShipmentsQuery } from './use-order-shipments-query';

const list = vi.fn();

vi.mock('../../../app/api/api-client-provider', () => ({
  useApiClient: () => ({ shipments: { list } }),
}));

function page(status: string): unknown {
  return { items: [{ id: 's1', status }], total: 1, limit: 20, offset: 0 };
}

function setup(): { client: QueryClient; invalidate: ReturnType<typeof vi.spyOn> } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  return { client, invalidate };
}

describe('useOrderShipmentsQuery', () => {
  beforeEach(() => list.mockReset());

  it('should re-read the order when a shipment status changes between reads', async () => {
    list.mockResolvedValueOnce(page('generated')).mockResolvedValueOnce(page('dispatched'));
    const { client, invalidate } = setup();
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useOrderShipmentsQuery('ol_order_1'), { wrapper });
    await waitFor(() => expect(result.current.data?.items[0]?.status).toBe('generated'));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ordersQueryKeys.all });

    await client.refetchQueries({ queryKey: shipmentsQueryKeys.list({ orderId: 'ol_order_1' }) });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ordersQueryKeys.all }),
    );
  });

  it('should not re-read the order when the status is unchanged', async () => {
    list.mockResolvedValue(page('generated'));
    const { client, invalidate } = setup();
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useOrderShipmentsQuery('ol_order_1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    await client.refetchQueries({ queryKey: shipmentsQueryKeys.list({ orderId: 'ol_order_1' }) });

    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ordersQueryKeys.all });
  });
});
