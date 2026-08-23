/**
 * OrderInvoicePanel — component tests (#757, redesign #1240)
 *
 * Drives the panel through a mocked API client. Asserts the capability +
 * operator-toggle gate, per-status rendering, the issue flow (payload shape +
 * success/error toasts), the security-critical PII-non-leak on the
 * capability-disabled toast, the document-type override, and the data-driven
 * regulatory badge gate.
 *
 * New #1240 assertions:
 *   - in-doubt: NO Retry, shows Check/Mark-resolved
 *   - issuing: NO action, locked notice
 *   - failed+rejected: Retry present, canRetryInvoice gate
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  sampleConnection,
  findToastDescription,
  createAuthenticatedSessionAdapter,
} from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { formatAmount } from '../../../shared/format/format-amount';
import type { Connection } from '../../connections';
import type { OrderRecord } from '../../orders';
import type { InvoiceRecord } from '../api/invoicing.types';
import { OrderInvoicePanel } from './order-invoice-panel';

const captureDemoEvent = vi.fn();
vi.mock('../../demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));

beforeEach(() => {
  captureDemoEvent.mockClear();
});

afterEach(cleanup);

const ORDER_ID = 'ord_1';
const CONN_ID = 'conn_inv';

/** Authenticated admin session — holds `invoices:write` (#1613). */
const adminSession = { sessionAdapter: createAuthenticatedSessionAdapter() };

/** Authenticated viewer session — read-only, no `invoices:write` (#1613). */
const viewerSession = {
  sessionAdapter: createAuthenticatedSessionAdapter({
    id: 'u2',
    username: 'viewer',
    email: null,
    role: 'viewer',
    permissions: ['orders:read', 'invoices:read'],
  }),
};

function demoApiClient(overrides: Parameters<typeof createMockApiClient>[0] = {}): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
    ...overrides,
  });
}

const order: OrderRecord = {
  internalOrderId: ORDER_ID,
  customerId: null,
  sourceConnectionId: 'conn_src',
  sourceEventId: null,
  orderSnapshot: {},
  syncStatus: [],
  syncAttempts: [],
  recordStatus: 'ready',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

/** An active connection that DECLARES + ENABLES Invoicing. */
const invoicingConnection: Connection = {
  ...sampleConnection,
  id: CONN_ID,
  name: 'Subiekt GT',
  status: 'active',
  enabledCapabilities: ['Invoicing'],
  supportedCapabilities: ['Invoicing'],
};

function makeInvoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv_1',
    connectionId: CONN_ID,
    orderId: ORDER_ID,
    providerType: 'subiekt',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: 'pi_1',
    providerInvoiceNumber: 'FV/2026/06/001',
    regulatoryStatus: 'not-applicable',
    clearanceReference: null,
    pdfUrl: 'https://subiekt.example/inv/1.pdf',
    failureMode: null,
    failureCode: null,
    failureReason: null,
    issuedAt: '2026-06-02T00:00:00.000Z',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    orderSummary: null,
    ...over,
  };
}

const notFound = (): ApiError =>
  new ApiError('No invoice for order', 404, { message: 'No invoice for order' });

describe('OrderInvoicePanel — capability/toggle gate', () => {
  async function expectGatedOut(container: HTMLElement): Promise<void> {
    await waitFor(() =>
      expect(container.querySelector('.order-invoice-panel--loading')).toBeNull(),
    );
    expect(container.querySelector('.order-invoice-panel')).toBeNull();
  }

  it('renders nothing when Invoicing is supported but NOT enabled', async () => {
    const conn = { ...invoicingConnection, enabledCapabilities: [], supportedCapabilities: ['Invoicing'] };
    const { container } = renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([conn]) } }),
    });
    await expectGatedOut(container);
  });

  it('renders nothing when no connection declares Invoicing', async () => {
    const { container } = renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([sampleConnection]) } }),
    });
    await expectGatedOut(container);
  });

  it('does NOT select a non-active connection even when Invoicing is enabled', async () => {
    const conn = { ...invoicingConnection, status: 'disabled' as Connection['status'] };
    const { container } = renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([conn]) } }),
    });
    await expectGatedOut(container);
  });

  it('renders when an active connection has Invoicing enabled', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) } }),
      ...adminSession,
    });
    expect(await screen.findByRole('button', { name: /issue invoice/i })).toBeInTheDocument();
  });

  it('with >1 candidate and NO primary: warns that auto-issue did nothing and disables Issue (#2047)', async () => {
    const a = { ...invoicingConnection, id: 'conn_aaa', name: 'Alpha' };
    const b = { ...invoicingConnection, id: 'conn_zzz', name: 'Zeta' };
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([b, a]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
      }),
      ...adminSession,
    });
    const picker = await screen.findByRole('combobox', { name: /issue on/i });
    expect(picker).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByText(/Automatic invoicing is off for this order/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /issue invoice/i })).toBeDisabled();
    // The link has to land where the flag can actually be set: the connection
    // EDIT form. Neither `/connections` (a list) nor the connection detail page
    // (overview + roles only) carries the toggle.
    expect(screen.getByRole('link', { name: /set a primary/i })).toHaveAttribute(
      'href',
      '/connections/conn_aaa/edit',
    );
  });

  it('keeps the lock warning after a pick even when NO connection is primary (#2047)', async () => {
    // Picking clears the "auto-issue is off" warning, which is exactly the
    // moment the operator most needs to be told the pick is one-way.
    const user = userEvent.setup();
    const a = { ...invoicingConnection, id: 'conn_aaa', name: 'Alpha' };
    const b = { ...invoicingConnection, id: 'conn_zzz', name: 'Zeta' };
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([b, a]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
      }),
      ...adminSession,
    });
    const picker = await screen.findByRole('combobox', { name: /issue on/i });
    expect(screen.queryByText(/The order locks to whichever connection you pick/i)).toBeNull();

    await user.selectOptions(picker, 'conn_zzz');

    expect(screen.queryByText(/Automatic invoicing is off/i)).toBeNull();
    expect(
      screen.getByText(/The order locks to whichever connection you pick/i),
    ).toBeInTheDocument();
  });

  it('names the other connections when one order carries documents on several (#2047)', async () => {
    // The guard makes this unreachable for new documents, but rows that predate
    // it exist — and the panel shows only the latest, so it must say so.
    const a = { ...invoicingConnection, id: CONN_ID, name: 'Subiekt GT' };
    const b = { ...invoicingConnection, id: 'conn_ksef', name: 'KSeF production' };
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([a, b]) },
        invoicing: {
          getForOrder: vi
            .fn()
            .mockResolvedValue(makeInvoice({ otherInvoicingConnectionIds: ['conn_ksef'] })),
        },
      }),
      ...adminSession,
    });

    expect(
      await screen.findByText(/documents on more than one connection/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/KSeF production/)).toBeInTheDocument();
  });

  it('stays silent about duplicates when the order has only one issuing connection', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockResolvedValue(makeInvoice()) },
      }),
      ...adminSession,
    });

    await screen.findByText(/Issued by/i);
    expect(screen.queryByText(/documents on more than one connection/i)).toBeNull();
  });

  it('with >1 candidate and a configured primary: preselects + labels it, Issue enabled (#2047)', async () => {
    const a = { ...invoicingConnection, id: 'conn_aaa', name: 'Alpha' };
    const b = {
      ...invoicingConnection,
      id: 'conn_zzz',
      name: 'Zeta',
      config: { invoicing: { isPrimary: true } },
    };
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([b, a]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
      }),
      ...adminSession,
    });
    const picker = await screen.findByRole('combobox', { name: /issue on/i });
    expect(picker).toHaveValue('conn_zzz');
    expect(screen.getByRole('option', { name: /Zeta - primary/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /issue invoice/i })).toBeEnabled();
    expect(screen.queryByText(/Automatic invoicing is off/i)).toBeNull();
  });

  it('with >1 candidate: the picked connection is the one Issue targets', async () => {
    const user = userEvent.setup();
    const a = { ...invoicingConnection, id: 'conn_aaa', name: 'Alpha' };
    const b = { ...invoicingConnection, id: 'conn_zzz', name: 'Zeta' };
    const issue = vi.fn().mockResolvedValue(makeInvoice({ connectionId: 'conn_zzz' }));
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([b, a]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()), issue },
      }),
      ...adminSession,
    });
    const picker = await screen.findByRole('combobox', { name: /issue on/i });
    await user.selectOptions(picker, 'conn_zzz');
    await user.click(await screen.findByRole('button', { name: /issue invoice/i }));
    await waitFor(() =>
      expect(issue).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'conn_zzz', orderId: ORDER_ID }),
      ),
    );
  });

  it('reads the invoice WITHOUT a connectionId, so >1 candidate no longer blocks the read (#2047)', async () => {
    const a = { ...invoicingConnection, id: 'conn_aaa', name: 'Alpha' };
    const b = { ...invoicingConnection, id: 'conn_zzz', name: 'Zeta' };
    const getForOrder = vi.fn().mockRejectedValue(notFound());
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([b, a]) },
        invoicing: { getForOrder },
      }),
      ...adminSession,
    });
    await screen.findByRole('combobox', { name: /issue on/i });
    await waitFor(() => expect(getForOrder).toHaveBeenCalledWith(ORDER_ID));
  });
});

// #2047: once a record exists the connection is a FACT. The picker that used to
// sit above an issued invoice is what let one sale get two documents.
describe('OrderInvoicePanel — connection lock (#2047)', () => {
  const alpha = { ...invoicingConnection, id: 'conn_aaa', name: 'Alpha' };
  const zeta = { ...invoicingConnection, id: 'conn_zzz', name: 'Zeta' };

  function renderWithTwoConnections(
    invoice: InvoiceRecord,
    connections: Connection[] = [alpha, zeta],
  ): ReturnType<typeof renderWithProviders> {
    return renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue(connections) },
        invoicing: { getForOrder: vi.fn().mockResolvedValue(invoice) },
      }),
      ...adminSession,
    });
  }

  it('renders NO connection picker and NO Issue button for an invoiced order, even with 2 candidates', async () => {
    renderWithTwoConnections(makeInvoice({ connectionId: 'conn_aaa' }));

    expect(await screen.findByText(/Issued by/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /issue on/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /issue invoice/i })).toBeNull();
  });

  it('names the issuing connection read off the record, not an operator pick', async () => {
    renderWithTwoConnections(makeInvoice({ connectionId: 'conn_zzz' }));

    const lock = await screen.findByText(/Issued by/i);
    expect(lock.parentElement?.textContent).toContain('Zeta');
    expect(lock.parentElement?.textContent).not.toContain('Alpha');
  });

  it('says "Issuing on" while an attempt is in flight (the most dangerous window)', async () => {
    renderWithTwoConnections(makeInvoice({ status: 'pending', connectionId: 'conn_aaa' }));

    expect(await screen.findByText(/Issuing on/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /issue on/i })).toBeNull();
  });

  it('says "Still assigned to" for an in-doubt failure and offers no provider change', async () => {
    renderWithTwoConnections(
      makeInvoice({ status: 'failed', failureMode: 'in-doubt', connectionId: 'conn_aaa' }),
    );

    expect(await screen.findByText(/Still assigned to/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /issue on a different connection/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^retry$/i })).toBeNull();
  });

  it('offers a guarded provider switch ONLY for a rejected failure', async () => {
    const user = userEvent.setup();
    const issue = vi.fn().mockResolvedValue(makeInvoice({ connectionId: 'conn_zzz' }));
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([alpha, zeta]) },
        invoicing: {
          getForOrder: vi.fn().mockResolvedValue(
            makeInvoice({
              status: 'failed',
              failureMode: 'rejected',
              failureCode: 'provider-rejected',
              connectionId: 'conn_aaa',
            }),
          ),
          issue,
        },
      }),
      ...adminSession,
    });

    await user.click(
      await screen.findByRole('button', { name: /issue on a different connection/i }),
    );
    expect(
      screen.getByText(/You are moving this order to another provider/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /issue here/i }));

    await waitFor(() =>
      expect(issue).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'conn_zzz' })),
    );
  });

  it('still renders the invoice when its connection is no longer usable, with actions off', async () => {
    // The record names a disabled connection: the invoice is an accounting fact,
    // but no other connection may be offered (that would be a second invoice).
    const disabled = { ...alpha, status: 'disabled' as Connection['status'] };
    renderWithTwoConnections(makeInvoice({ connectionId: 'conn_aaa' }), [disabled, zeta]);

    expect(await screen.findByText(/Issued by/i)).toBeInTheDocument();
    expect(screen.getByText('disconnected')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /issue on/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /issue invoice/i })).toBeNull();
  });

  it('renders the invoice even when OL knows no connection with that id at all', async () => {
    renderWithTwoConnections(makeInvoice({ connectionId: 'conn_deleted' }), []);

    const lock = await screen.findByText(/Issued by/i);
    expect(lock.parentElement?.textContent).toContain('conn_deleted');
  });
});

describe('OrderInvoicePanel — display states', () => {
  it('not-issued (404) ⇒ "Not issued" badge + enabled Issue button', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) } }),
      ...adminSession,
    });
    expect(await screen.findByText('Not issued')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /issue invoice/i })).toBeEnabled();
  });

  it('not-issued ⇒ document-type picker fills the row beside a signal-orange primary Issue action (#1622)', async () => {
    const { container } = renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) } }),
      ...adminSession,
    });
    // The picker + primary action share one row (mockup section 02 layout).
    const issue = await screen.findByRole('button', { name: /issue invoice/i });
    expect(issue).toHaveClass('button--primary');
    const picker = screen.getByRole('combobox', { name: /document type/i });
    expect(picker).toHaveClass('order-invoice-panel__doc-type');
    expect(container.querySelector('.order-invoice-panel__actions--issue')).not.toBeNull();
  });

  it('issued ⇒ number + safe PDF link + document type, no action button', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockResolvedValue(makeInvoice()) } }),
    });
    const link = await screen.findByRole('link', { name: /invoice pdf/i });
    expect(link).toHaveAttribute('href', 'https://subiekt.example/inv/1.pdf');
    expect(screen.getByText(/Invoice \(faktura\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /issue invoice|retry/i })).toBeNull();
  });

  it('issued with javascript: pdfUrl ⇒ number is NOT an href-bearing anchor', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockResolvedValue(makeInvoice({ pdfUrl: 'javascript:alert(1)' })) },
      }),
    });
    expect(await screen.findByText('FV/2026/06/001')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('failed (rejected) ⇒ error alert + enabled Retry button', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockResolvedValue(makeInvoice({ status: 'failed', failureMode: 'rejected', failureCode: 'provider-rejected' })) },
      }),
      ...adminSession,
    });
    // Both the failure copy and the retry hint contain "rejected"
    const msgs = await screen.findAllByText(/rejected/i);
    expect(msgs.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled();
  });

  it('failed (in-doubt) ⇒ warning alert, Check/Mark-resolved buttons, NO Retry', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: {
          getForOrder: vi.fn().mockResolvedValue(
            makeInvoice({ status: 'failed', failureMode: 'in-doubt', failureCode: 'transport-timeout' }),
          ),
        },
      }),
    });
    // Wait for the in-doubt branch to fully render first
    expect(await screen.findByRole('button', { name: /check provider/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark resolved/i })).toBeInTheDocument();
    // In-doubt: no Retry button
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('issuing ⇒ no action button, locked notice', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockResolvedValue(makeInvoice({ status: 'issuing' })) },
      }),
    });
    // issuing: no Retry, no Issue
    await waitFor(() => expect(screen.queryByRole('button', { name: /retry|issue invoice/i })).toBeNull());
    // Locked notice present
    expect(await screen.findByText(/in progress.*locked/i)).toBeInTheDocument();
  });
});

describe('OrderInvoicePanel — issue flow', () => {
  it('Issue click ⇒ invoicing.issue called with {connectionId, orderId, documentType}, no idempotencyKey', async () => {
    const user = userEvent.setup();
    const issue = vi.fn().mockResolvedValue(makeInvoice());
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()), issue } }),
      ...adminSession,
    });
    await user.click(await screen.findByRole('button', { name: /issue invoice/i }));
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(1));
    const arg = issue.mock.calls[0][0];
    expect(arg).toEqual({ connectionId: CONN_ID, orderId: ORDER_ID, documentType: 'invoice' });
    expect(arg).not.toHaveProperty('idempotencyKey');
  });

  it('document-type override ⇒ selecting receipt passes documentType:"receipt"', async () => {
    const user = userEvent.setup();
    const issue = vi.fn().mockResolvedValue(makeInvoice({ documentType: 'receipt' }));
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()), issue } }),
      ...adminSession,
    });
    await screen.findByRole('button', { name: /issue invoice/i });
    await user.selectOptions(screen.getByRole('combobox', { name: /document type/i }), 'receipt');
    await user.click(screen.getByRole('button', { name: /issue invoice/i }));
    await waitFor(() => expect(issue).toHaveBeenCalled());
    expect(issue.mock.calls[0][0].documentType).toBe('receipt');
  });

  it('captures demo_invoice_doctype_changed when the document-type picker changes (#1788)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) } }),
      ...adminSession,
    });
    await screen.findByRole('button', { name: /issue invoice/i });
    await user.selectOptions(screen.getByRole('combobox', { name: /document type/i }), 'receipt');

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_invoice_doctype_changed', {
      documentType: 'receipt',
    });
  });

  it('issue capability-disabled 400 ⇒ friendly copy AND DOM does NOT leak connectionId/adapterKey', async () => {
    const user = userEvent.setup();
    const leaky = "Capability 'Invoicing' not enabled for connection conn_inv (adapter subiekt-gt)";
    const issue = vi
      .fn()
      .mockRejectedValue(new ApiError(leaky, 400, { error: 'CapabilityNotEnabledException', message: leaky }));
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()), issue } }),
      ...adminSession,
    });
    await user.click(await screen.findByRole('button', { name: /issue invoice/i }));
    expect(await findToastDescription(/Invoicing is not enabled for this connection/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('adapter subiekt-gt');
  });
});

describe('OrderInvoicePanel — regulatory badge (data gate)', () => {
  it('shows the regulatory badge when regulatoryStatus !== "not-applicable"', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockResolvedValue(makeInvoice({ regulatoryStatus: 'submitted' })) },
      }),
    });
    // Badge may render the label in an accessible title/span — findAllByText handles multiples
    const badges = await screen.findAllByText(/KSeF: submitted/i);
    expect(badges.length).toBeGreaterThan(0);
  });

  it('hides the regulatory badge when regulatoryStatus === "not-applicable"', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockResolvedValue(makeInvoice()) } }),
    });
    await screen.findByRole('link', { name: /invoice pdf/i });
    expect(screen.queryByText(/KSeF:/i)).toBeNull();
  });
});

describe('OrderInvoicePanel — write-access gating (#1613, mirrors #1615)', () => {
  it('demo read-only viewer sees the Issue button visible-but-disabled', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: demoApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
      }),
      ...viewerSession,
    });
    expect(await screen.findByRole('button', { name: /issue invoice/i })).toBeDisabled();
  });

  it('captures demo_invoice_issue_attempted when a demo read-only viewer clicks the locked Issue button (#1788)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: demoApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
      }),
      ...viewerSession,
    });
    await screen.findByRole('button', { name: /issue invoice/i });
    const lockWrapper = document.querySelector('.read-only-lock');
    expect(lockWrapper).not.toBeNull();
    await user.click(lockWrapper as Element);

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_invoice_issue_attempted', {});
  });

  it('demo read-only viewer sees the Retry button visible-but-disabled', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: demoApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: {
          getForOrder: vi.fn().mockResolvedValue(
            makeInvoice({ status: 'failed', failureMode: 'rejected', failureCode: 'provider-rejected' }),
          ),
        },
      }),
      ...viewerSession,
    });
    expect(await screen.findByRole('button', { name: /retry/i })).toBeDisabled();
  });

  it('keeps the existing hide-when-missing behaviour for an unauthorized non-demo viewer', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
      }),
      ...viewerSession,
    });
    await screen.findByText('Not issued');
    expect(screen.queryByRole('button', { name: /issue invoice/i })).not.toBeInTheDocument();
  });

  it('operator/admin session issuing is unaffected — Issue button renders enabled outside demo mode', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
      }),
      ...adminSession,
    });
    expect(await screen.findByRole('button', { name: /issue invoice/i })).toBeEnabled();
  });

  describe('persisted block reason (#2100)', () => {
    it('reads the backend reason instead of re-deriving, on an install with ONE connection', async () => {
      // The decisive case: a single candidate means the client-side derivation
      // reports no ambiguity at all, so before #2100 this order looked normal.
      // The backend recorded a manual block, and that is what must show.
      renderWithProviders(
        <OrderInvoicePanel
          order={{ ...order, salesDocumentBlockReason: 'trigger-model-manual' }}
        />,
        {
          apiClient: createMockApiClient({
            connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
            invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
          }),
          ...adminSession,
        },
      );

      expect(
        await screen.findByText(/This connection invoices by hand/i),
      ).toBeInTheDocument();
      // Quiet, not alarming — and no "Set a primary" remediation, which would be
      // the wrong fix for a deliberate setting.
      expect(screen.queryByRole('link', { name: /set a primary/i })).not.toBeInTheDocument();
    });

    it('renders the no-primary reason with its detail and the Set-a-primary remediation', async () => {
      const a = { ...invoicingConnection, id: 'conn_aaa', name: 'Alpha' };
      const b = { ...invoicingConnection, id: 'conn_zzz', name: 'Zeta' };
      renderWithProviders(
        <OrderInvoicePanel
          order={{
            ...order,
            salesDocumentBlockReason: 'unresolved-routing',
            salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
            salesDocumentBlockDetail: '2 invoicing connections, none marked primary',
          }}
        />,
        {
          apiClient: createMockApiClient({
            connections: { list: vi.fn().mockResolvedValue([b, a]) },
            invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
          }),
          ...adminSession,
        },
      );

      expect(
        await screen.findByText(/Not invoiced: no primary connection/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/2 invoicing connections, none marked primary/),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /set a primary/i })).toHaveAttribute(
        'href',
        '/connections/conn_aaa/edit',
      );
    });

    it('states the batched limitation without offering Set a primary', async () => {
      renderWithProviders(
        <OrderInvoicePanel
          order={{ ...order, salesDocumentBlockReason: 'trigger-model-batched' }}
        />,
        {
          apiClient: createMockApiClient({
            connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
            invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
          }),
          ...adminSession,
        },
      );

      expect(
        await screen.findByText(/batched invoicing is not available yet/i),
      ).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /set a primary/i })).not.toBeInTheDocument();
    });

    it('shows no block message once the order carries an invoice', async () => {
      renderWithProviders(
        <OrderInvoicePanel
          order={{ ...order, salesDocumentBlockReason: 'trigger-model-manual' }}
        />,
        {
          apiClient: createMockApiClient({
            connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
            invoicing: { getForOrder: vi.fn().mockResolvedValue(makeInvoice()) },
          }),
          ...adminSession,
        },
      );

      await screen.findByText('FV/2026/06/001');
      expect(screen.queryByText(/This connection invoices by hand/i)).toBeNull();
    });

    it('keeps the block message behind a terminal REJECTED failure', async () => {
      renderWithProviders(
        <OrderInvoicePanel
          order={{ ...order, salesDocumentBlockReason: 'trigger-model-manual' }}
        />,
        {
          apiClient: createMockApiClient({
            connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
            invoicing: {
              getForOrder: vi
                .fn()
                .mockResolvedValue(makeInvoice({ status: 'failed', failureMode: 'rejected' })),
            },
          }),
          ...adminSession,
        },
      );

      // The provider is known to have created nothing, so the backend gate KEEPS
      // the block and the aggregate counts it. Suppressing here would leave the
      // operator a failed invoice that says nothing about why auto-issue never ran.
      expect(await screen.findByText(/This connection invoices by hand/i)).toBeInTheDocument();
    });

    it('suppresses the block message on an in-doubt failure', async () => {
      renderWithProviders(
        <OrderInvoicePanel
          order={{ ...order, salesDocumentBlockReason: 'trigger-model-manual' }}
        />,
        {
          apiClient: createMockApiClient({
            connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
            invoicing: {
              getForOrder: vi
                .fn()
                .mockResolvedValue(makeInvoice({ status: 'failed', failureMode: 'in-doubt' })),
            },
          }),
          ...adminSession,
        },
      );

      // A document may exist at the provider, so the gate reports `none` and this
      // surface must not claim otherwise.
      // Anchor on the in-doubt branch being fully rendered before asserting absence.
      expect(await screen.findByRole('button', { name: /check provider/i })).toBeInTheDocument();
      expect(screen.queryByText(/This connection invoices by hand/i)).toBeNull();
    });
  });
});

describe('OrderInvoicePanel — shipping split preview (#2254)', () => {
  /** An order whose snapshot carries line rates and a shipping charge. */
  function orderWithBasket(
    lines: { id: string; rate: string | null; price: number; quantity: number }[],
    shipping: number,
  ): OrderRecord {
    return {
      ...order,
      orderSnapshot: {
        items: lines.map((line) => ({
          id: line.id,
          productId: `prod_${line.id}`,
          quantity: line.quantity,
          price: line.price,
          name: `Item ${line.id}`,
          taxRate: line.rate,
        })),
        totals: { shipping, currency: 'PLN', total: 0 },
      },
    };
  }

  function renderPanel(record: OrderRecord): void {
    renderWithProviders(<OrderInvoicePanel order={record} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
      }),
      ...adminSession,
    });
  }

  it('previews parts that add up to the shipping the buyer paid', async () => {
    // 10 across three equal-gross rates does not divide into cents. The document
    // puts the remainder on the largest part; the preview must say the same,
    // or the operator reads a split that is a cent short of what was charged.
    renderPanel(
      orderWithBasket(
        [
          { id: 'a', rate: '23', price: 100, quantity: 1 },
          { id: 'b', rate: '8', price: 100, quantity: 1 },
          { id: 'c', rate: '5', price: 100, quantity: 1 },
        ],
        10,
      ),
    );

    const notice = await screen.findByText(/Shipping is split across the rates/i);
    const text = notice.textContent ?? '';
    expect(text).toContain(`${formatAmount(3.34, 'PLN')} at 23%`);
    expect(text).toContain(`${formatAmount(3.33, 'PLN')} at 8%`);
    expect(text).toContain(`${formatAmount(3.33, 'PLN')} at 5%`);
    expect(3.34 + 3.33 + 3.33).toBeCloseTo(10, 2);
  });

  it('renders an exemption code without a percent suffix', async () => {
    renderPanel(
      orderWithBasket(
        [
          { id: 'a', rate: 'zw', price: 100, quantity: 1 },
          { id: 'b', rate: '23', price: 100, quantity: 1 },
        ],
        10,
      ),
    );

    const notice = await screen.findByText(/Shipping is split across the rates/i);
    const text = notice.textContent ?? '';
    expect(text).toContain(`${formatAmount(5, 'PLN')} at zw`);
    expect(text).not.toContain('zw%');
  });

  it('waits instead of splitting when a line has no rate', async () => {
    renderPanel(
      orderWithBasket(
        [
          { id: 'a', rate: '23', price: 100, quantity: 1 },
          { id: 'b', rate: null, price: 100, quantity: 1 },
        ],
        10,
      ),
    );

    expect(await screen.findByText(/Shipping is waiting with the document/i)).toBeInTheDocument();
    expect(screen.queryByText(/Shipping is split across the rates/i)).toBeNull();
  });

  it('renders no preview when the whole basket is at one rate', async () => {
    renderPanel(
      orderWithBasket(
        [
          { id: 'a', rate: '23', price: 100, quantity: 1 },
          { id: 'b', rate: '23', price: 50, quantity: 2 },
        ],
        10,
      ),
    );

    expect(await screen.findByRole('button', { name: /issue invoice/i })).toBeInTheDocument();
    expect(screen.queryByText(/Shipping is split across the rates/i)).toBeNull();
    expect(screen.queryByText(/Shipping is waiting with the document/i)).toBeNull();
  });
});
