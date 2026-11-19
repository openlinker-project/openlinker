import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../connections';
import { createMockApiClient, sampleConnection } from '../../../test/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { useRefundSentToShopify } from './refund-sent-to-shopify';

function shopify(publicConfig: Record<string, boolean>): Connection {
  return { ...sampleConnection, platformType: 'shopify', config: {}, publicConfig };
}

describe('useRefundSentToShopify', () => {
  it('should be false without a connection id', () => {
    const { result } = renderHook(() => useRefundSentToShopify(null), { wrapper: wrap(sampleConnection) });
    expect(result.current).toBe(false);
  });

  it('should be true when the adapter reports the opt-in in publicConfig, even with an empty config', async () => {
    const { result } = renderHook(() => useRefundSentToShopify('c1'), {
      wrapper: wrap(shopify({ refundsThroughShopify: true })),
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('should stay false when publicConfig does not report the opt-in', async () => {
    const getById = vi.fn<(connectionId: string) => Promise<Connection>>().mockResolvedValue(shopify({}));
    const { result } = renderHook(() => useRefundSentToShopify('c1'), { wrapper: wrapWith(getById) });
    await waitFor(() => expect(getById).toHaveBeenCalled());
    expect(result.current).toBe(false);
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
