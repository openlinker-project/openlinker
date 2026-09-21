/**
 * SalesDocumentsListPage — component tests (#3307, review fix #3309)
 *
 * Covers the two BLOCKING findings from the #3309 review (a non-first empty
 * page must never render the "never issued" copy; `/invoices` stays reachable
 * for bulk actions) and the cursor-stack / debounced-search machinery the
 * review flagged as shipped with zero tests.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { SalesDocumentsListPage } from './sales-documents-list-page';
import type { SalesDocumentListApi } from '../../features/sales-documents/api/sales-document-list.api';
import type {
  PaginatedSalesDocuments,
  SalesDocumentListItem,
} from '../../features/sales-documents/api/sales-document-list.types';
import type { SalesDocumentInvoiceView } from '../../features/orders/api/orders.types';
import type { Connection } from '../../features/connections/api/connections.types';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn_1',
    name: 'PrestaShop Main',
    platformType: 'prestashop',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDocument(overrides: Partial<SalesDocumentInvoiceView> = {}): SalesDocumentInvoiceView {
  return {
    kind: 'invoice',
    documentType: 'invoice',
    status: 'issued',
    failureMode: null,
    failureCode: null,
    failureReason: null,
    regulatoryStatus: 'accepted',
    clearanceReference: null,
    identity: {
      recordId: 'inv_1',
      connectionId: 'conn_1',
      providerType: 'subiekt',
      documentNumber: 'FV/2026/001',
      createdAt: '2026-06-01T10:00:00.000Z',
      completedAt: '2026-06-01T10:05:00.000Z',
      inFlightUntil: null,
    },
    ...overrides,
  };
}

function makeItem(overrides: Partial<SalesDocumentListItem> = {}): SalesDocumentListItem {
  return {
    orderId: 'order_1',
    connectionId: 'conn_1',
    document: makeDocument(),
    amount: { value: 199.99, currency: 'PLN' },
    otherRecordCount: 0,
    ...overrides,
  };
}

function mockApi(
  list: SalesDocumentListApi['list'],
  connections: Connection[] = [makeConnection()],
): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    salesDocumentList: { list },
    connections: { list: vi.fn().mockResolvedValue(connections) },
  });
}

describe('SalesDocumentsListPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the loading skeleton while the list query is pending', () => {
    const list = vi.fn().mockReturnValue(new Promise<PaginatedSalesDocuments>(() => undefined));
    renderWithProviders(<SalesDocumentsListPage />, { apiClient: mockApi(list), route: '/sales-documents' });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the error state with a Retry action when the list query fails', async () => {
    const list = vi.fn().mockRejectedValue(new Error('Network error'));
    renderWithProviders(<SalesDocumentsListPage />, { apiClient: mockApi(list), route: '/sales-documents' });

    expect(await screen.findByText('Unable to load sales documents')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // #3309 review, BLOCKING 2 — an empty non-first page must never assert
  // "no documents exist", because it is reached on every walk that ends
  // exactly on a page boundary.
  // ---------------------------------------------------------------------
  describe('empty states', () => {
    it('renders the never-issued copy on a virgin first page', async () => {
      const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
      renderWithProviders(<SalesDocumentsListPage />, { apiClient: mockApi(list), route: '/sales-documents' });

      expect(await screen.findByText('No invoices or fiscal receipts have been issued yet.')).toBeInTheDocument();
    });

    it('renders the filtered-empty copy when filters are active and the first page is empty', async () => {
      const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
      renderWithProviders(<SalesDocumentsListPage />, {
        apiClient: mockApi(list),
        route: '/sales-documents?kind=invoice',
      });

      expect(
        await screen.findByText('No documents match the current filters. Try clearing some filters.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('No invoices or fiscal receipts have been issued yet.')).not.toBeInTheDocument();
    });

    it('never renders the never-issued copy on a non-first page — it renders "No more documents" instead', async () => {
      const firstPage: PaginatedSalesDocuments = { items: [makeItem()], nextCursor: 'cursor-2' };
      const secondPage: PaginatedSalesDocuments = { items: [], nextCursor: null };
      const list = vi
        .fn()
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage)
        // Re-fetched when Back returns to `cursor: undefined` (query-cache is
        // configured with `gcTime: 0` in test, see `renderWithProviders`).
        .mockResolvedValueOnce(firstPage);
      renderWithProviders(<SalesDocumentsListPage />, { apiClient: mockApi(list), route: '/sales-documents' });

      const nextButton = await screen.findByRole('button', { name: 'Next' });
      fireEvent.click(nextButton);

      expect(await screen.findByText('No more documents')).toBeInTheDocument();
      expect(screen.queryByText('No invoices or fiscal receipts have been issued yet.')).not.toBeInTheDocument();
      expect(screen.queryByText('No documents match the current filters. Try clearing some filters.')).not
        .toBeInTheDocument();

      // The recovery action returns to the last loaded (non-empty) page.
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(await screen.findByText('order_1')).toBeInTheDocument();
    });
  });

  it('renders rows with order id, kind, and the currency-formatted amount', async () => {
    const item = makeItem({ amount: { value: 1000, currency: 'JPY' } });
    const list = vi.fn().mockResolvedValue({ items: [item], nextCursor: null });
    renderWithProviders(<SalesDocumentsListPage />, { apiClient: mockApi(list), route: '/sales-documents' });

    const row = (await screen.findByText('order_1')).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Invoice')).toBeInTheDocument();
    // JPY has zero decimal digits — `formatAmount` must not print "1000.00 JPY".
    expect(screen.queryByText(/1000\.00/)).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Cursor stack: Next/Prev, and the filter-change reset invariant.
  // ---------------------------------------------------------------------
  describe('pagination', () => {
    it('walks forward with the cursor Next returned, and back to no cursor with Prev', async () => {
      const page1: PaginatedSalesDocuments = { items: [makeItem({ orderId: 'order_1' })], nextCursor: 'cursor-2' };
      const page2: PaginatedSalesDocuments = { items: [makeItem({ orderId: 'order_2' })], nextCursor: null };
      const list = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
      renderWithProviders(<SalesDocumentsListPage />, { apiClient: mockApi(list), route: '/sales-documents' });

      expect(await screen.findByText('order_1')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(await screen.findByText('order_2')).toBeInTheDocument();
      expect(list).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ cursor: 'cursor-2' }));
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
      await waitFor(() => {
        expect(list).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ cursor: undefined }));
      });
    });

    it('resets the cursor stack when a filter changes', async () => {
      const page1: PaginatedSalesDocuments = { items: [makeItem()], nextCursor: 'cursor-2' };
      const page2: PaginatedSalesDocuments = { items: [makeItem()], nextCursor: null };
      const filtered: PaginatedSalesDocuments = { items: [makeItem()], nextCursor: null };
      const list = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2).mockResolvedValueOnce(filtered);
      renderWithProviders(<SalesDocumentsListPage />, { apiClient: mockApi(list), route: '/sales-documents' });

      await screen.findByText('order_1');
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

      fireEvent.change(screen.getByLabelText('Filter by kind'), { target: { value: 'invoice' } });

      await waitFor(() => {
        expect(list).toHaveBeenLastCalledWith(
          expect.objectContaining({ kind: 'invoice' }),
          expect.objectContaining({ cursor: undefined }),
        );
      });
    });
  });

  // ---------------------------------------------------------------------
  // #3309 review, IMPORTANT — the search input must not fire one request
  // per keystroke.
  // ---------------------------------------------------------------------
  it('debounces the search input instead of querying on every keystroke', async () => {
    vi.useFakeTimers();
    try {
      const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
      renderWithProviders(<SalesDocumentsListPage />, { apiClient: mockApi(list), route: '/sales-documents' });

      await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));

      const input = screen.getByLabelText('Search');
      fireEvent.change(input, { target: { value: 'o' } });
      fireEvent.change(input, { target: { value: 'or' } });
      fireEvent.change(input, { target: { value: 'ord' } });

      // Still just the one initial call — typing alone must not have fired.
      expect(list).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(400);
      await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ord' }), expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  // ---------------------------------------------------------------------
  // #3309 review, BLOCKING 1 — bulk actions live only on /invoices; this
  // page must keep it reachable rather than silently drop the capability.
  // ---------------------------------------------------------------------
  it('links out to /invoices for bulk actions', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    renderWithProviders(<SalesDocumentsListPage />, { apiClient: mockApi(list), route: '/sales-documents' });

    const link = await screen.findByRole('link', { name: 'Manage invoices' });
    expect(link).toHaveAttribute('href', '/invoices');
  });

  it('renders the "already on another connection" duplicate-record hint via the status popover', async () => {
    const item = makeItem({ otherRecordCount: 1 });
    const list = vi.fn().mockResolvedValue({ items: [item], nextCursor: null });
    renderWithProviders(<SalesDocumentsListPage />, { apiClient: mockApi(list), route: '/sales-documents' });

    const row = (await screen.findByText('order_1')).closest('tr');
    expect(row).not.toBeNull();
    const trigger = within(row as HTMLElement).getByRole('button', { name: /Invoice: Issued/ });
    expect(trigger).toHaveAccessibleName(/A second document exists for this order/);
  });
});
