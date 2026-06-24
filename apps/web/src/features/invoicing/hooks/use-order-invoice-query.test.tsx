/**
 * useOrderInvoiceQuery — hook tests (#757)
 *
 * Covers the 404→null (not-issued) mapping, non-404 propagation, the
 * pending-only poll interval, and the connectionId-null disable.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient } from '../../../test/test-utils';
import { useOrderInvoiceQuery } from './use-order-invoice-query';
import type { InvoiceRecord } from '../api/invoicing.types';

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>,
): ({ children }: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  };
}

const invoice = (over: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id: 'inv_1',
  connectionId: 'c1',
  orderId: 'o1',
  providerType: 'subiekt',
  documentType: 'invoice',
  status: 'issued',
  providerInvoiceId: 'pi',
  providerInvoiceNumber: 'FV/1',
  regulatoryStatus: 'not-applicable',
  clearanceReference: null,
  pdfUrl: null,
  issuedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

describe('useOrderInvoiceQuery', () => {
  it('maps an invoice-absent 404 to null (not-issued)', async () => {
    const apiClient = createMockApiClient({
      invoicing: {
        getForOrder: vi
          .fn()
          .mockRejectedValue(new ApiError('No invoice for order', 404, { message: 'x' })),
      },
    });
    const { result } = renderHook(() => useOrderInvoiceQuery('o1', 'c1'), {
      wrapper: createWrapper(apiClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('re-throws a non-404 ApiError as query.error', async () => {
    const apiClient = createMockApiClient({
      invoicing: {
        getForOrder: vi.fn().mockRejectedValue(new ApiError('boom', 500, null)),
      },
    });
    const { result } = renderHook(() => useOrderInvoiceQuery('o1', 'c1'), {
      wrapper: createWrapper(apiClient),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).status).toBe(500);
  });

  it('polls while status === "pending" (refetches after the interval)', async () => {
    vi.useFakeTimers();
    try {
      const getForOrder = vi.fn().mockResolvedValue(invoice({ status: 'pending' }));
      const apiClient = createMockApiClient({ invoicing: { getForOrder } });
      const { result } = renderHook(() => useOrderInvoiceQuery('o1', 'c1'), {
        wrapper: createWrapper(apiClient),
      });
      await vi.waitFor(() => expect(result.current.data?.status).toBe('pending'));
      const callsAfterFirst = getForOrder.mock.calls.length;
      // Advance past the 5s poll interval — a pending status must trigger a refetch.
      await vi.advanceTimersByTimeAsync(5000);
      await vi.waitFor(() =>
        expect(getForOrder.mock.calls.length).toBeGreaterThan(callsAfterFirst),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling on a terminal status (no refetch after the interval)', async () => {
    vi.useFakeTimers();
    try {
      const getForOrder = vi.fn().mockResolvedValue(invoice({ status: 'issued' }));
      const apiClient = createMockApiClient({ invoicing: { getForOrder } });
      const { result } = renderHook(() => useOrderInvoiceQuery('o1', 'c1'), {
        wrapper: createWrapper(apiClient),
      });
      await vi.waitFor(() => expect(result.current.data?.status).toBe('issued'));
      const callsAfterFirst = getForOrder.mock.calls.length;
      await vi.advanceTimersByTimeAsync(15000);
      expect(getForOrder.mock.calls.length).toBe(callsAfterFirst);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is disabled when connectionId is null', async () => {
    const getForOrder = vi.fn();
    const apiClient = createMockApiClient({ invoicing: { getForOrder } });
    const { result } = renderHook(() => useOrderInvoiceQuery('o1', null), {
      wrapper: createWrapper(apiClient),
    });
    // Disabled query never fetches.
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(getForOrder).not.toHaveBeenCalled();
  });
});
