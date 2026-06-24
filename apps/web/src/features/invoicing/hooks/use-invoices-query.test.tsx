/**
 * useInvoicesQuery — hook tests (#758)
 *
 * Mirrors `use-order-invoice-query.test.tsx`: a mocked api client + renderHook
 * with providers. Asserts the query key, that `apiClient.invoicing.list` is
 * called with the passed filters/pagination, and the resolved
 * `PaginatedInvoices` shape.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import { useInvoicesQuery } from './use-invoices-query';
import type {
  InvoiceFilters,
  InvoicePagination,
  PaginatedInvoices,
} from '../api/invoicing.types';

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

const envelope: PaginatedInvoices = {
  items: [],
  total: 0,
  limit: 20,
  offset: 0,
};

const filters: InvoiceFilters = {
  status: 'failed',
  connectionId: 'conn_1',
  regulatoryStatus: 'rejected',
  issuedFrom: '2026-06-01T00:00:00.000Z',
  issuedTo: '2026-06-30T23:59:59.999Z',
};
const pagination: InvoicePagination = { limit: 20, offset: 20 };

describe('useInvoicesQuery', () => {
  it('calls apiClient.invoicing.list with the passed filters and pagination', async () => {
    const list = vi.fn().mockResolvedValue(envelope);
    const apiClient = createMockApiClient({ invoicing: { list } });
    const { result } = renderHook(() => useInvoicesQuery(filters, pagination), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(list).toHaveBeenCalledWith(filters, pagination);
  });

  it('uses invoicingQueryKeys.list(filters, pagination) as the query key', () => {
    expect(invoicingQueryKeys.list(filters, pagination)).toEqual([
      'invoicing',
      'list',
      filters,
      pagination,
    ]);
  });

  it('returns the resolved PaginatedInvoices envelope on success', async () => {
    const resolved: PaginatedInvoices = {
      items: [],
      total: 3,
      limit: 20,
      offset: 0,
    };
    const list = vi.fn().mockResolvedValue(resolved);
    const apiClient = createMockApiClient({ invoicing: { list } });
    const { result } = renderHook(() => useInvoicesQuery(undefined, { limit: 20, offset: 0 }), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(resolved);
  });

  it('surfaces a list rejection as query.isError', async () => {
    const list = vi.fn().mockRejectedValue(new Error('boom'));
    const apiClient = createMockApiClient({ invoicing: { list } });
    const { result } = renderHook(() => useInvoicesQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('boom');
  });
});
