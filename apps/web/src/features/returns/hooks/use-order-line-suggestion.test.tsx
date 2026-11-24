/**
 * Confirming an order line invalidates every returns read (#3520): the list's
 * stage counters and the correction proposal read the line it just resolved.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useConfirmOrderLineMutation } from './use-order-line-suggestion';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { returnsQueryKeys } from '../api/returns.query-keys';

describe('useConfirmOrderLineMutation (#3520)', () => {
  it('should invalidate every returns query after confirming', async () => {
    const returns = { confirmOrderLine: vi.fn().mockResolvedValue({ claimed: true }) };
    const apiClient = createMockApiClient({ returns });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useConfirmOrderLineMutation('r1', 'l1'), { wrapper });

    result.current.mutate('order-line-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: returnsQueryKeys.all });
  });
});
