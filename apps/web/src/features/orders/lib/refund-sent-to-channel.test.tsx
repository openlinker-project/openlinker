import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../connections';
import { createMockApiClient, sampleConnection } from '../../../test/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { useRefundSentToChannel } from './refund-sent-to-channel';

function withPublicConfig(name: string, publicConfig: Record<string, boolean>): Connection {
  return { ...sampleConnection, name, config: {}, publicConfig };
}

describe('useRefundSentToChannel', () => {
  it('should be null without a connection id', () => {
    const { result } = renderHook(() => useRefundSentToChannel(null), { wrapper: wrap(sampleConnection) });
    expect(result.current).toBeNull();
  });

  it('should name the Shopify connection when it reports the opt-in in publicConfig', async () => {
    const { result } = renderHook(() => useRefundSentToChannel('c1'), {
      wrapper: wrap(withPublicConfig('My Shopify', { refundsThroughShopify: true })),
    });
    await waitFor(() => expect(result.current).toBe('My Shopify'));
  });

  it('should name the marketplace connection when it reports the opt-in in publicConfig', async () => {
    const { result } = renderHook(() => useRefundSentToChannel('c1'), {
      wrapper: wrap(withPublicConfig('Empik', { refundsThroughMarketplace: true })),
    });
    await waitFor(() => expect(result.current).toBe('Empik'));
  });

  it('should stay null when publicConfig does not report an opt-in', async () => {
    const getById = vi
      .fn<(connectionId: string) => Promise<Connection>>()
      .mockResolvedValue(withPublicConfig('Shop', { refundsThroughMarketplace: false }));
    const { result } = renderHook(() => useRefundSentToChannel('c1'), { wrapper: wrapWith(getById) });
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
