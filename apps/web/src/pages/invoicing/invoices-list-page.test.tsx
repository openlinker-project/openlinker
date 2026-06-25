/**
 * InvoicesListPage — component tests (#758)
 *
 * Mirrors the webhook deliveries page test: loading / error / empty / data
 * states + "filter drives query" assertions via a mocked api client
 * (`createMockApiClient({ invoicing: { list: listMock }, connections: { list: connMock } })`)
 * and `listMock.mock.calls.at(-1)?.[0]` matchers. The page reads filter +
 * pagination state from the URL, so each case renders with the appropriate
 * `route` (test-utils seeds the MemoryRouter from it).
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
    regulatoryStatus: 'cleared',
    clearanceReference: null,
    pdfUrl: 'https://example.com/invoice.pdf',
    issuedAt: '2026-06-01T10:00:00.000Z',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
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
): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    invoicing: { list },
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
    // mobile card-view meta; regulatory badge (KSeF: cleared) only in the table.
    expect(screen.getAllByText('Issued').length).toBeGreaterThan(0);
    expect(screen.getByText('KSeF: cleared')).toBeInTheDocument();
  });

  it('drives the query with status filter (and links each row to /orders/:orderId)', async () => {
    const user = userEvent.setup();
    const invoice = makeInvoice();
    const list = vi.fn().mockResolvedValue(makeEnvelope({ items: [invoice], total: 1 }));
    renderWithProviders(<InvoicesListPage />, { apiClient: mockApi(list), route: '/invoices' });

    await screen.findByText('order_1');
    // Each row links to /orders/:orderId.
    const rowLink = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '/orders/order_1');
    expect(rowLink).toBeDefined();

    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter by status/i }),
      'failed',
    );

    await waitFor(() => {
      expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'failed' });
    });
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
    // Page 1 of a single-page result: both bounds disabled, limit=20/offset=0.
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
});
