import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../connections';
import { createMockApiClient, sampleConnection } from '../../../test/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { useRefundSentToShopify } from './refund-sent-to-shopify';

function shopify(config: Record<string, unknown>): Connection {
  return { ...sampleConnection, platformType: 'shopify', config };
}

describe('useRefundSentToShopify', () => {
  it('should be false without a connection id', () => {
    const { result } = renderHook(() => useRefundSentToShopify(null), { wrapper: wrap(sampleConnection) });
    expect(result.current).toBe(false);
  });

  it('should be true only for a Shopify connection that opted in', async () => {
    const { result } = renderHook(() => useRefundSentToShopify('c1'), {
      wrapper: wrap(shopify({ refundsThroughShopify: true })),
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('should stay false for a Shopify connection that did not opt in', async () => {
    const getById = vi.fn().mockResolvedValue(shopify({}));
    const { result } = renderHook(() => useRefundSentToShopify('c1'), { wrapper: wrapWith(getById) });
    await waitFor(() => expect(getById).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});

function wrap(connection: Connection): (props: { children: ReactNode }) => ReactNode {
  return wrapWith(vi.fn().mockResolvedValue(connection));
}
function wrapWith(getById: ReturnType<typeof vi.fn>): (props: { children: ReactNode }) => ReactNode {
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
