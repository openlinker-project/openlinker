/**
 * OrderInvoicePanel — component tests (#757)
 *
 * Drives the panel through a mocked API client. Asserts the capability +
 * operator-toggle gate, per-status rendering, the issue flow (payload shape +
 * success/error toasts), the security-critical PII-non-leak on the
 * capability-disabled toast, the document-type override, and the data-driven
 * regulatory badge gate.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient, sampleConnection } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import type { Connection } from '../../connections';
import type { OrderRecord } from '../../orders';
import type { InvoiceRecord } from '../api/invoicing.types';
import { OrderInvoicePanel } from './order-invoice-panel';

afterEach(cleanup);

const ORDER_ID = 'ord_1';
const CONN_ID = 'conn_inv';

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
    issuedAt: '2026-06-02T00:00:00.000Z',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...over,
  };
}

const notFound = (): ApiError =>
  new ApiError('No invoice for order', 404, { message: 'No invoice for order' });

describe('OrderInvoicePanel — capability/toggle gate', () => {
  /** The panel renders a loading skeleton (also `.order-invoice-panel`) until the
   *  connections query settles, then collapses to `null` when the gate fails.
   *  Wait for the skeleton to clear before asserting the panel is gone. */
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
    });
    expect(await screen.findByRole('button', { name: /issue invoice/i })).toBeInTheDocument();
  });

  it('with >1 candidate: requires an explicit connection pick — no auto-bound Issue, no GET fired', async () => {
    const a = { ...invoicingConnection, id: 'conn_aaa', name: 'Alpha' };
    const b = { ...invoicingConnection, id: 'conn_zzz', name: 'Zeta' };
    const getForOrder = vi.fn().mockRejectedValue(notFound());
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([b, a]) }, invoicing: { getForOrder } }),
    });
    // Picker is shown with a placeholder + both connections; no Issue action and
    // no invoice GET is wired to an arbitrary connection until the operator picks.
    const picker = await screen.findByRole('combobox', { name: /invoicing connection/i });
    expect(picker).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Zeta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /issue invoice|retry/i })).toBeNull();
    expect(getForOrder).not.toHaveBeenCalled();
  });

  it('with >1 candidate: picking a connection binds the GET + Issue action to THAT connection', async () => {
    const user = userEvent.setup();
    const a = { ...invoicingConnection, id: 'conn_aaa', name: 'Alpha' };
    const b = { ...invoicingConnection, id: 'conn_zzz', name: 'Zeta' };
    const getForOrder = vi.fn().mockRejectedValue(notFound());
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([b, a]) }, invoicing: { getForOrder } }),
    });
    const picker = await screen.findByRole('combobox', { name: /invoicing connection/i });
    await user.selectOptions(picker, 'conn_zzz');
    // GET now fires against the PICKED connection (not the lowest-id [0]).
    await waitFor(() => expect(getForOrder).toHaveBeenCalledWith(ORDER_ID, 'conn_zzz'));
    expect(await screen.findByRole('button', { name: /issue invoice/i })).toBeEnabled();
  });
});

describe('OrderInvoicePanel — display states', () => {
  it('not-issued (404) ⇒ "Not issued" badge + enabled Issue button', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) } }),
    });
    expect(await screen.findByText('Not issued')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /issue invoice/i })).toBeEnabled();
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

  it('failed ⇒ error alert with generic copy + enabled Retry button', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockResolvedValue(makeInvoice({ status: 'failed' })) },
      }),
    });
    expect(await screen.findByText(/Issuing this invoice failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled();
  });
});

describe('OrderInvoicePanel — issue flow', () => {
  it('Issue click ⇒ invoicing.issue called with {connectionId, orderId, documentType}, no idempotencyKey', async () => {
    const user = userEvent.setup();
    const issue = vi.fn().mockResolvedValue(makeInvoice());
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()), issue } }),
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
    });
    await screen.findByRole('button', { name: /issue invoice/i });
    await user.selectOptions(screen.getByRole('combobox', { name: /document type/i }), 'receipt');
    await user.click(screen.getByRole('button', { name: /issue invoice/i }));
    await waitFor(() => expect(issue).toHaveBeenCalled());
    expect(issue.mock.calls[0][0].documentType).toBe('receipt');
  });

  it('issue capability-disabled 400 ⇒ friendly copy AND DOM does NOT leak connectionId/adapterKey', async () => {
    const user = userEvent.setup();
    const leaky = "Capability 'Invoicing' not enabled for connection conn_inv (adapter subiekt-gt)";
    const issue = vi
      .fn()
      .mockRejectedValue(new ApiError(leaky, 400, { error: 'CapabilityNotEnabledException', message: leaky }));
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()), issue } }),
    });
    await user.click(await screen.findByRole('button', { name: /issue invoice/i }));
    expect(await screen.findByText(/Invoicing is not enabled for this connection/i)).toBeInTheDocument();
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
    expect(await screen.findByText(/KSeF: submitted/i)).toBeInTheDocument();
  });

  it('hides the regulatory badge when regulatoryStatus === "not-applicable"', async () => {
    renderWithProviders(<OrderInvoicePanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) }, invoicing: { getForOrder: vi.fn().mockResolvedValue(makeInvoice()) } }),
    });
    await screen.findByRole('link', { name: /invoice pdf/i });
    expect(screen.queryByText(/KSeF:/i)).toBeNull();
  });
});
