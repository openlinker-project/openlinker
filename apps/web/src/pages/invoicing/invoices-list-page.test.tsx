/**
 * InvoicesListPage — component tests (#758, #1240 A1+C2+C3)
 *
 * Mirrors the webhook deliveries page test: loading / error / empty / data
 * states + "filter drives query" assertions via a mocked api client.
 *
 * New #1240 assertions:
 *   - rowHref is `/invoices/:id` (was `/orders/:orderId`)
 *   - taxId filter drives the query
 *   - BulkActionBar appears on row selection
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { InvoicesListPage } from './invoices-list-page';
import type { InvoicingApi } from '../../features/invoicing/api/invoicing.api';
import type { InvoiceRecord, PaginatedInvoices } from '../../features/invoicing/api/invoicing.types';
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

function makeInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv_1',
    connectionId: 'conn_1',
    orderId: 'order_1',
    providerType: 'subiekt',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: 'pi_1',
    providerInvoiceNumber: 'FV/2026/001',
    regulatoryStatus: 'accepted',
    clearanceReference: null,
    pdfUrl: 'https://example.com/invoice.pdf',
    failureMode: null,
    failureCode: null,
    failureReason: null,
    issuedAt: '2026-06-01T10:00:00.000Z',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    orderSummary: null,
    ...overrides,
  };
}

function makeEnvelope(overrides: Partial<PaginatedInvoices> = {}): PaginatedInvoices {
  return { items: [], total: 0, limit: 20, offset: 0, ...overrides };
}

/** Mock api client with the two namespaces the page touches. */
function mockApi(
  list: InvoicingApi['list'],
  connections: Connection[] = [makeConnection()],
  bulkIssue?: InvoicingApi['bulkIssue'],
): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    invoicing: { list, ...(bulkIssue ? { bulkIssue } : {}) },
    connections: { list: vi.fn().mockResolvedValue(connections) },
  });
}

describe('InvoicesListPage', () => {
  afterEach(cleanup);

  it('renders the loading skeleton while the list query is pending', () => {
    const list = vi.fn().mockReturnValue(new Promise<PaginatedInvoices>(() => undefined));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the error state with a Retry action when the list query fails', async () => {
    const list = vi.fn().mockRejectedValue(new Error('Network error'));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    expect(await screen.findByText('Unable to load invoices')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders the empty state when the list returns zero items', async () => {
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [], total: 0 }));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    expect(await screen.findByText('No invoices found')).toBeInTheDocument();
  });

  it('renders rows with order id, invoice number, status + regulatory badges, issued date', async () => {
    const invoice = makeInvoice();
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [invoice], total: 1 }));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    expect(await screen.findByText('order_1')).toBeInTheDocument();
    // Invoice number is an anchor to the (safe https) pdfUrl.
    const link = await screen.findByRole('link', { name: /open invoice pdf/i });
    expect(link).toHaveAttribute('href', 'https://example.com/invoice.pdf');
    expect(within(link).getByText('FV/2026/001')).toBeInTheDocument();
    // Status badge (issued) renders in both the desktop table cell and the
    // mobile card-view meta. The regulatory label "KSeF: accepted" now appears
    // both as the row badge AND as a filter <option> (the filter reuses the badge
    // label map, #1585 F7), so assert the non-option badge element specifically.
    expect(screen.getAllByText('Issued').length).toBeGreaterThan(0);
    const accepted = screen.getAllByText('KSeF: accepted');
    expect(accepted.some((el) => el.tagName !== 'OPTION')).toBe(true);
  });

  it('links each row to /invoices/:id (not /orders/:orderId)', async () => {
    const user = userEvent.setup();
    const invoice = makeInvoice();
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [invoice], total: 1 }));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    await screen.findByText('order_1');
    // Row href must point to the invoice detail page.
    const rowLink = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '/invoices/inv_1');
    expect(rowLink).toBeDefined();

    // Status filter still drives the query.
    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter by status/i }),
      'failed',
    );

    await waitFor(() => {
      expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'failed' });
    });
  });

  it('merges the document number and type into one column, keeping the PDF link (#2090)', async () => {
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [makeInvoice()], total: 1 }));
    const { container } = renderWithProviders(<InvoicesListPage />, {
      apiClient: mockApi(list),
      route: '/invoices',
    });

    await screen.findByRole('link', { name: /open invoice pdf/i });
    const cell = container.querySelector('.invoice-document-cell');
    expect(cell).not.toBeNull();
    // Number on line 1 (still the PDF anchor), type on line 2.
    expect(within(cell as HTMLElement).getByText('FV/2026/001')).toBeInTheDocument();
    expect(within(cell as HTMLElement).getByText('invoice')).toBeInTheDocument();

    // The separate "Invoice no." column is gone; the list is 8 columns wide.
    const headers = container.querySelectorAll('thead th');
    expect(headers).toHaveLength(8);
    expect(screen.queryByText('Invoice no.')).toBeNull();
  });

  it('renders the em dash over the document type for a receipt with no provider number', async () => {
    // Expected shape, not an error state: the type on line 2 still identifies it.
    const list = vi.fn().mockResolvedValue(
      makeEnvelope({
        items: [makeInvoice({ documentType: 'receipt', providerInvoiceNumber: null })],
        total: 1,
      }),
    );
    const { container } = renderWithProviders(<InvoicesListPage />, {
      apiClient: mockApi(list),
      route: '/invoices',
    });

    await screen.findByText('receipt');
    const cell = container.querySelector('.invoice-document-cell') as HTMLElement;
    expect(within(cell).getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open invoice pdf/i })).toBeNull();
  });

  it('renders the Order column from the orderSummary projection, linking to the order (#2090)', async () => {
    const list = vi.fn().mockResolvedValue(
      makeEnvelope({
        items: [
          makeInvoice({
            orderId: 'ol_order_a4f3b9c1d8e2f0a9b6c3d4e5f6a7b8c9',
            orderSummary: {
              orderNumber: '6839-2911-4402',
              firstItemName: 'Terra Wool Coat',
              firstItemImageUrl: null,
              itemCount: 3,
            },
          }),
        ],
        total: 1,
      }),
    );
    const { container } = renderWithProviders(<InvoicesListPage />, {
      apiClient: mockApi(list),
      route: '/invoices',
    });

    // Was the raw 41-character orderId in a mono span — no link, no Copy.
    expect(await screen.findByRole('link', { name: '6839-2911-4402' })).toHaveAttribute(
      'href',
      '/orders/ol_order_a4f3b9c1d8e2f0a9b6c3d4e5f6a7b8c9',
    );
    expect(screen.getByText('Terra Wool Coat')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(
      screen.queryByText('ol_order_a4f3b9c1d8e2f0a9b6c3d4e5f6a7b8c9'),
    ).toBeNull();

    // The row still navigates to the INVOICE; the in-cell order link is nested in
    // no anchor, since `DataTable` linkifies the first cell only.
    expect(
      screen.getAllByRole('link').some((a) => a.getAttribute('href') === '/invoices/inv_1'),
    ).toBe(true);
    expect(container.querySelector('a a')).toBeNull();
  });

  it('copies the full internal order id from the Order cell (#2090)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const list = vi.fn().mockResolvedValue(
      makeEnvelope({
        items: [
          makeInvoice({
            orderId: 'ol_order_a4f3b9c1d8e2f0a9b6c3d4e5f6a7b8c9',
            orderSummary: {
              orderNumber: '6839-2911-4402',
              firstItemName: null,
              firstItemImageUrl: null,
              itemCount: 1,
            },
          }),
        ],
        total: 1,
      }),
    );
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    const copy = await screen.findByRole('button', {
      name: 'Copy internal order ID for order 6839-2911-4402',
    });
    copy.click();

    expect(writeText).toHaveBeenCalledWith('ol_order_a4f3b9c1d8e2f0a9b6c3d4e5f6a7b8c9');
    vi.unstubAllGlobals();
  });

  it('links the shortened internal order id when no order summary resolves', async () => {
    // #2090's AC asked for `–`; the shared cell deliberately renders a link
    // instead, because `buildOrderSummary` also returns null for "the snapshot
    // carried no parseable items" — a live order. What the issue actually removes
    // is the raw 41-character UUID, and a shortened link removes it.
    const list = vi.fn().mockResolvedValue(
      makeEnvelope({
        items: [
          makeInvoice({
            orderId: 'ol_order_a4f3b9c1d8e2f0a9b6c3d4e5f6a7b8c9',
            orderSummary: null,
          }),
        ],
        total: 1,
      }),
    );
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    expect(await screen.findByRole('link', { name: 'ol_order_a4f3…c9' })).toHaveAttribute(
      'href',
      '/orders/ol_order_a4f3b9c1d8e2f0a9b6c3d4e5f6a7b8c9',
    );
    // The raw untruncated id — what this issue removes — is nowhere on the row.
    expect(
      screen.queryByText('ol_order_a4f3b9c1d8e2f0a9b6c3d4e5f6a7b8c9'),
    ).toBeNull();
  });

  it('renders the connection as the shared cell, not an id hidden in a title attribute (#2090)', async () => {
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [makeInvoice()], total: 1 }));
    const { container } = renderWithProviders(<InvoicesListPage />, {
      apiClient: mockApi(list),
      route: '/invoices',
    });

    await screen.findByText('order_1');
    const cell = container.querySelector('.connection-cell') as HTMLElement;
    expect(cell).not.toBeNull();
    expect(within(cell).getByRole('link', { name: 'PrestaShop Main' })).toHaveAttribute(
      'href',
      '/connections/conn_1',
    );
    // The id is now readable and copyable text, not a `title` on a muted span.
    expect(within(cell).getByText('conn_1')).toBeInTheDocument();
    expect(
      within(cell).getByRole('button', { name: 'Copy connection ID for PrestaShop Main' }),
    ).toBeInTheDocument();
    // No adornment on this page — an invoice's connection IS its issuing provider.
    expect(cell.querySelector('.connection-cell__adornment')).toBeNull();
  });

  it('issues one connections request for the whole page, never one per row', async () => {
    const connectionsList = vi.fn().mockResolvedValue([makeConnection()]);
    const getById = vi.fn();
    const list = vi.fn().mockResolvedValue(
      makeEnvelope({
        items: [
          makeInvoice({ id: 'inv_1', connectionId: 'conn_1' }),
          makeInvoice({ id: 'inv_2', connectionId: 'conn_1' }),
          makeInvoice({ id: 'inv_3', connectionId: 'conn_missing' }),
        ],
        total: 3,
      }),
    );
    renderWithProviders(<InvoicesListPage />, {
      apiClient: createMockApiClient({
        invoicing: { list },
        connections: { list: connectionsList, getById },
      }),
      route: '/invoices',
    });

    // Two rows share conn_1, so this is intentionally findAll.
    await screen.findAllByText('PrestaShop Main');
    expect(connectionsList).toHaveBeenCalledTimes(1);
    expect(getById).not.toHaveBeenCalled();
  });

  it('drives the query with the regulatoryStatus filter', async () => {
    const user = userEvent.setup();
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [], total: 0 }));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    await screen.findByText('No invoices found');
    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter by regulatory status/i }),
      'rejected',
    );

    await waitFor(() => {
      expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ regulatoryStatus: 'rejected' });
    });
  });

  it('drives the query with the connection filter', async () => {
    const user = userEvent.setup();
    const connection = makeConnection();
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [], total: 0 }));
    renderWithProviders(<InvoicesListPage />, {
      apiClient: mockApi(list, [connection]),
      route: '/invoices',
    });

    await screen.findByRole('option', { name: 'PrestaShop Main' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter by connection/i }),
      connection.id,
    );

    await waitFor(() => {
      expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ connectionId: connection.id });
    });
  });

  it('drives the query with the taxId filter (with/without)', async () => {
    const user = userEvent.setup();
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [], total: 0 }));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    await screen.findByText('No invoices found');
    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter by buyer tax id/i }),
      'with',
    );

    await waitFor(() => {
      expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ taxId: 'with' });
    });
  });

  it('widens the issued date range to UTC bounds (issuedFrom T00:00:00.000Z / issuedTo T23:59:59.999Z) in the query', async () => {
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [], total: 0 }));
    renderWithProviders(<InvoicesListPage />, {
      apiClient: mockApi(list),
      route: '/invoices?issuedFrom=2026-06-01&issuedTo=2026-06-30',
    });

    await waitFor(() => {
      expect(list.mock.calls.at(-1)?.[0]).toMatchObject({
        issuedFrom: '2026-06-01T00:00:00.000Z',
        issuedTo: '2026-06-30T23:59:59.999Z',
      });
    });
  });

  it('paginates with limit=20 and offset, disabling Previous/Next at the bounds', async () => {
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [makeInvoice()], total: 1 }));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    await screen.findByText('order_1');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(list.mock.calls.at(-1)?.[1]).toMatchObject({ limit: 20, offset: 0 });
  });

  it('enables Next and advances the offset by the page size when more pages exist', async () => {
    const user = userEvent.setup();
    const list = vi
      .fn()
      .mockResolvedValue(makeEnvelope({ items: [makeInvoice()], total: 45, limit: 20, offset: 0 }));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    await screen.findByText('order_1');
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toBeEnabled();
    await user.click(next);

    await waitFor(() => {
      expect(list.mock.calls.at(-1)?.[1]).toMatchObject({ limit: 20, offset: 20 });
    });
  });

  it('renders providerInvoiceNumber as plain text (not an anchor) when pdfUrl is a non-http(s) scheme', async () => {
    const invoice = makeInvoice({ pdfUrl: 'javascript:alert(1)' });
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [invoice], total: 1 }));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    expect(await screen.findByText('FV/2026/001')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open invoice pdf/i })).not.toBeInTheDocument();
  });

  it('renders the "N/A" regulatory badge for a not-applicable row (not a blank cell)', async () => {
    const invoice = makeInvoice({ regulatoryStatus: 'not-applicable' });
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [invoice], total: 1 }));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    expect(await screen.findByText('N/A')).toBeInTheDocument();
  });

  it('falls back to "All" for an out-of-enum status/regulatoryStatus URL param (calls list with undefined, not the raw value)', async () => {
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [], total: 0 }));
    renderWithProviders(<InvoicesListPage />, {
      apiClient: mockApi(list),
      route: '/invoices?status=bogus&regulatoryStatus=nope',
    });

    await waitFor(() => expect(list).toHaveBeenCalled());
    const filters = list.mock.calls.at(-1)?.[0];
    expect(filters?.status).toBeUndefined();
    expect(filters?.regulatoryStatus).toBeUndefined();
  });

  it('BulkActionBar appears after checking a row and hides when selection cleared', async () => {
    const user = userEvent.setup();
    const invoice = makeInvoice();
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [invoice], total: 1 }));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    await screen.findByText('order_1');

    const checkbox = screen.getByRole('checkbox', { name: /select invoice/i });
    await user.click(checkbox);

    // BulkActionBar renders when count > 0
    expect(screen.getByRole('button', { name: /retry selected/i })).toBeInTheDocument();

    // Clear selection: count returns to 0, bar is aria-hidden
    await user.click(screen.getByRole('button', { name: /clear selection/i }));
    await waitFor(() => {
      // BulkActionBar sets aria-hidden when count=0; the button is still in
      // DOM but the container is hidden (aria-hidden). Use the aria-hidden
      // attribute on the wrapper to assert the bar is collapsed.
      const bar = document.querySelector('.bulk-action-bar');
      expect(bar?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('fans out one bulkIssue call per connectionId when selected rows span connections (#1355)', async () => {
    const user = userEvent.setup();
    const connA = makeConnection({ id: 'conn_a', name: 'Connection A' });
    const connB = makeConnection({ id: 'conn_b', name: 'Connection B' });
    const invoiceA = makeInvoice({ id: 'inv_a', orderId: 'order_a', connectionId: 'conn_a' });
    const invoiceB = makeInvoice({ id: 'inv_b', orderId: 'order_b', connectionId: 'conn_b' });
    const list = vi
      .fn()
      .mockResolvedValue(makeEnvelope({ items: [invoiceA, invoiceB], total: 2 }));
    const bulkIssue = vi
      .fn()
      .mockResolvedValueOnce({ issued: 1, skipped: 0, failed: 0, results: [] })
      .mockResolvedValueOnce({ issued: 0, skipped: 1, failed: 0, results: [] });

    renderWithProviders(<InvoicesListPage />, {
      apiClient: mockApi(list, [connA, connB], bulkIssue),
      route: '/invoices',
    });

    await screen.findByText('order_a');
    const checkboxes = screen.getAllByRole('checkbox', { name: /select invoice/i });
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);

    await user.click(screen.getByRole('button', { name: /issue invoices/i }));
    await user.click(screen.getByRole('button', { name: 'Issue' }));

    await waitFor(() => {
      expect(bulkIssue).toHaveBeenCalledTimes(2);
    });
    expect(bulkIssue).toHaveBeenCalledWith({ connectionId: 'conn_a', orderIds: ['order_a'] });
    expect(bulkIssue).toHaveBeenCalledWith({ connectionId: 'conn_b', orderIds: ['order_b'] });

    // Banner sums issued/skipped/failed across both connection groups. Query by
    // the banner's own text (robust to the Alert component's internal markup /
    // CSS class names) rather than the `alert__description` implementation class.
    const banner = await screen.findByText(/Bulk issue complete\./);
    expect(banner.textContent).toContain('1 issued.');
    expect(banner.textContent).toContain('1 skipped (already issued or in progress).');
  });

  it('renders the clearanceReference (KSeF number) column when present', async () => {
    const invoice = makeInvoice({ clearanceReference: '5260001246-20260625-A1B2-3D' });
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [invoice], total: 1 }));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    expect(await screen.findByText('5260001246-20260625-A1B2-3D')).toBeInTheDocument();
  });
});
