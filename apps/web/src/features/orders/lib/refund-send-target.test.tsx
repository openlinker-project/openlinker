import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../connections';
import { createMockApiClient, sampleConnection } from '../../../test/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { useRefundSendTarget } from './refund-send-target';

function shopify(publicConfig: Record<string, boolean>): Connection {
  return { ...sampleConnection, platformType: 'shopify', config: {}, publicConfig };
}

function amazon(publicConfig: Record<string, boolean>): Connection {
  return { ...sampleConnection, platformType: 'amazon', config: {}, publicConfig };
}

describe('useRefundSendTarget', () => {
  it('should be false without a connection id', () => {
    const { result } = renderHook(() => useRefundSendTarget(null), { wrapper: wrap(sampleConnection) });
    expect(result.current).toBeNull();
  });

  it('should be true when the adapter reports the opt-in in publicConfig, even with an empty config', async () => {
    const { result } = renderHook(() => useRefundSendTarget('c1'), {
      wrapper: wrap(shopify({ refundsThroughShopify: true })),
    });
    await waitFor(() => expect(result.current).toBe('shopify'));
  });

  it('should name Amazon when its connection opted in to refunds, and not on a platform that has no such key', async () => {
    const opted = renderHook(() => useRefundSendTarget('c1'), {
      wrapper: wrap(amazon({ refundsEnabled: true })),
    });
    await waitFor(() => expect(opted.result.current).toBe('amazon'));

    const other = renderHook(() => useRefundSendTarget('c1'), {
      wrapper: wrap({ ...shopify({}), platformType: 'prestashop', publicConfig: { refundsEnabled: true } }),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(other.result.current).toBeNull();
  });

  it('should stay false when publicConfig does not report the opt-in', async () => {
    const getById = vi.fn<(connectionId: string) => Promise<Connection>>().mockResolvedValue(shopify({}));
    const { result } = renderHook(() => useRefundSendTarget('c1'), { wrapper: wrapWith(getById) });
    await waitFor(() => expect(getById).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});

function wrap(connection: Connection): (props: { children: ReactNode }) => ReactNode {
  return wrapWith(vi.fn().mockResolvedValue(connection));
}
function wrapWith(getById: (connectionId: string) => Promise<Connection>): (props: { children: ReactNode }) => ReactNode {
  const apiClient = createMockApiClient({ connections: { getById } });
  return function Wrapper({ children }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  };
}
