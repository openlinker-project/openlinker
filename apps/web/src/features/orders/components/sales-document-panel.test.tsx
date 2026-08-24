/**
 * SalesDocumentPanel — component tests (#2160, ADR-041 §3a/3b)
 *
 * Covers the four states the issue's acceptance criteria name: filled,
 * empty + gate-block reason, and the two cross-kind write-path-refusal
 * states (register-receipt blocked by an existing invoice, and the mirror
 * image). Also pins the capability gate and that the page never renders two
 * independent panels — there is exactly one `.sales-document-panel`.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  sampleConnection,
  createAuthenticatedSessionAdapter,
} from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { formatAmount } from '../../../shared/format/format-amount';
import type { Connection } from '../../connections';
import type { OrderRecord } from '../api/orders.types';
import type { InvoiceRecord } from '../../invoicing';
import type { FiscalRegistrationRecord } from '../../fiscalization';
import { SalesDocumentPanel } from './sales-document-panel';

afterEach(cleanup);

const ORDER_ID = 'ord_1';
const INVOICE_CONN_ID = 'conn_inv';
const FISCAL_CONN_ID = 'conn_fiscal';

const adminSession = { sessionAdapter: createAuthenticatedSessionAdapter() };

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

const invoicingConnection: Connection = {
  ...sampleConnection,
  id: INVOICE_CONN_ID,
  name: 'Subiekt GT',
  status: 'active',
  enabledCapabilities: ['Invoicing'],
  supportedCapabilities: ['Invoicing'],
};

const fiscalConnection: Connection = {
  ...sampleConnection,
  id: FISCAL_CONN_ID,
  name: 'eparagony.pl',
  status: 'active',
  enabledCapabilities: ['Fiscalization'],
  supportedCapabilities: ['Fiscalization'],
};

function makeInvoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv_1',
    connectionId: INVOICE_CONN_ID,
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

function makeFiscalRecord(over: Partial<FiscalRegistrationRecord> = {}): FiscalRegistrationRecord {
  return {
    id: 'fr_1',
    connectionId: FISCAL_CONN_ID,
    orderId: ORDER_ID,
    providerType: 'eparagony',
    idempotencyKey: `fiscal:${FISCAL_CONN_ID}:${ORDER_ID}`,
    status: 'registered',
    providerReference: 'ep_1',
    documentReference: '1/2026/08/14',
    signingIdentity: 'ABC 1234567890',
    registeredAt: '2026-08-14T09:44:00.000Z',
    regimeExtras: null,
    artefacts: [],
    failureMode: null,
    failureReason: null,
    createdAt: '2026-08-14T09:43:00.000Z',
    updatedAt: '2026-08-14T09:44:00.000Z',
    ...over,
  };
}

const notFound = (): ApiError =>
  new ApiError('No invoice for order', 404, { message: 'No invoice for order' });

describe('SalesDocumentPanel — capability gate', () => {
  it('renders nothing when no connection declares Invoicing or Fiscalization', async () => {
    const { container } = renderWithProviders(<SalesDocumentPanel order={order} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([sampleConnection]) } }),
    });
    await waitFor(() => expect(container.querySelector('.sales-document-panel--loading')).toBeNull());
    expect(container.querySelector('.sales-document-panel')).toBeNull();
  });

  it('renders exactly one panel, never two independent ones', async () => {
    renderWithProviders(<SalesDocumentPanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection, fiscalConnection]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
        fiscalization: { listForOrder: vi.fn().mockResolvedValue([]) },
      }),
      ...adminSession,
    });
    expect(await screen.findByText('Sales document')).toBeInTheDocument();
    expect(document.querySelectorAll('.sales-document-panel')).toHaveLength(1);
  });
});

describe('SalesDocumentPanel — state 1: filled (invoice)', () => {
  it('renders the issued invoice inside a filled doc-slot', async () => {
    renderWithProviders(<SalesDocumentPanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockResolvedValue(makeInvoice()) },
      }),
      ...adminSession,
    });
    expect(await screen.findByText('FV/2026/06/001')).toBeInTheDocument();
    expect(document.querySelector('.doc-slot--filled')).not.toBeNull();
    expect(
      document.querySelector('.sales-document-panel__header-badges .status-badge--success'),
    ).not.toBeNull();
  });
});

describe('SalesDocumentPanel — state 1: filled (fiscal receipt)', () => {
  it('renders the registered receipt inside a filled doc-slot when no invoice exists', async () => {
    renderWithProviders(<SalesDocumentPanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
        fiscalization: { listForOrder: vi.fn().mockResolvedValue([makeFiscalRecord()]) },
      }),
      ...adminSession,
    });
    expect(await screen.findByText('1/2026/08/14')).toBeInTheDocument();
    expect(screen.getByText('ABC 1234567890')).toBeInTheDocument();
    expect(document.querySelector('.doc-slot--filled')).not.toBeNull();
  });
});

describe('SalesDocumentPanel — state 2: empty + gate-block reason', () => {
  it('shows the ambiguous-no-primary reason, distinct from a write-path refusal', async () => {
    const a = { ...invoicingConnection, id: 'conn_aaa', name: 'Alpha' };
    const b = { ...invoicingConnection, id: 'conn_zzz', name: 'Zeta' };
    renderWithProviders(<SalesDocumentPanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([b, a]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
      }),
      ...adminSession,
    });
    expect(
      await screen.findByText(/Automatic invoicing is off for this order/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /issue invoice/i })).toBeDisabled();
    expect(screen.getByRole('link', { name: /set a primary/i })).toHaveAttribute(
      'href',
      '/connections/conn_aaa/edit',
    );
    // Never confused with the cross-kind blocked copy.
    expect(screen.queryByText(/would create a second document/i)).toBeNull();
  });

  it('renders fiscal-receipt-flavored copy for a persisted block when the candidate pool is fiscal-only (#2156)', async () => {
    renderWithProviders(
      <SalesDocumentPanel
        order={{ ...order, salesDocumentBlockReason: 'trigger-model-manual' }}
      />,
      {
        apiClient: createMockApiClient({
          connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
          invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
          fiscalization: { listForOrder: vi.fn().mockResolvedValue([]) },
        }),
        ...adminSession,
      },
    );
    expect(await screen.findByText(/registers receipts by hand/i)).toBeInTheDocument();
    expect(screen.queryByText(/invoice/i)).toBeNull();
  });

  it('renders neutral copy when the candidate pool spans both kinds (#2156)', async () => {
    renderWithProviders(
      <SalesDocumentPanel
        order={{ ...order, salesDocumentBlockReason: 'trigger-model-manual' }}
      />,
      {
        apiClient: createMockApiClient({
          connections: {
            list: vi.fn().mockResolvedValue([invoicingConnection, fiscalConnection]),
          },
          invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
          fiscalization: { listForOrder: vi.fn().mockResolvedValue([]) },
        }),
        ...adminSession,
      },
    );
    expect(await screen.findByText(/issues sales documents by hand/i)).toBeInTheDocument();
  });
});

describe('SalesDocumentPanel — state 3: register-receipt blocked by an existing invoice', () => {
  it('disables Register receipt with an explanatory warning, distinct from state 2', async () => {
    renderWithProviders(<SalesDocumentPanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection, fiscalConnection]) },
        invoicing: { getForOrder: vi.fn().mockResolvedValue(makeInvoice()) },
      }),
      ...adminSession,
    });
    expect(await screen.findByText('FV/2026/06/001')).toBeInTheDocument();
    expect(
      screen.getByText(/Registering a receipt here would create a second document/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/already has an invoice from Subiekt GT/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register receipt' })).toBeDisabled();
  });

  it('does NOT block when the existing invoice is a retryable rejected failure', async () => {
    renderWithProviders(<SalesDocumentPanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection, fiscalConnection]) },
        invoicing: {
          getForOrder: vi
            .fn()
            .mockResolvedValue(makeInvoice({ status: 'failed', failureMode: 'rejected' })),
        },
        fiscalization: { listForOrder: vi.fn().mockResolvedValue([]) },
      }),
      ...adminSession,
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.queryByText(/would create a second document/i)).toBeNull();
  });
});

describe('SalesDocumentPanel — state 4: issue-invoice blocked by an existing receipt', () => {
  it('disables Issue invoice with an explanatory warning, distinct from state 2', async () => {
    renderWithProviders(<SalesDocumentPanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection, fiscalConnection]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
        fiscalization: { listForOrder: vi.fn().mockResolvedValue([makeFiscalRecord()]) },
      }),
      ...adminSession,
    });
    expect(await screen.findByText('1/2026/08/14')).toBeInTheDocument();
    expect(
      screen.getByText(/Issuing an invoice here would create a second document/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue invoice' })).toBeDisabled();
  });
});

describe('SalesDocumentPanel — manual actions when nothing is blocked', () => {
  it('issues an invoice on the single candidate connection', async () => {
    const issue = vi.fn().mockResolvedValue(makeInvoice({ status: 'pending' }));
    const user = userEvent.setup();
    renderWithProviders(<SalesDocumentPanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()), issue },
      }),
      ...adminSession,
    });
    await user.click(await screen.findByRole('button', { name: /issue invoice/i }));
    await waitFor(() =>
      expect(issue).toHaveBeenCalledWith({
        connectionId: INVOICE_CONN_ID,
        orderId: ORDER_ID,
        documentType: 'invoice',
      }),
    );
  });

  it('registers a fiscal receipt on the single candidate connection', async () => {
    const register = vi.fn().mockResolvedValue(makeFiscalRecord({ status: 'pending' }));
    const user = userEvent.setup();
    renderWithProviders(<SalesDocumentPanel order={order} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
        fiscalization: { listForOrder: vi.fn().mockResolvedValue([]), register },
      }),
      ...adminSession,
    });
    await user.click(await screen.findByRole('button', { name: 'Register receipt' }));
    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({ connectionId: FISCAL_CONN_ID, orderId: ORDER_ID }),
    );
  });
});

// Ported from the pre-#2160 `order-invoice-panel.test.tsx` (#2254): the panel
// that rendered these was folded into `SalesDocumentPanel`, so the coverage
// moved with the behaviour rather than being dropped with the file.
describe('SalesDocumentPanel — shipping split preview (#2254)', () => {
  /** An order whose snapshot carries line rates and a shipping charge. */
  function orderWithBasket(
    lines: { id: string; rate: string | null; price: number; quantity: number }[],
    shipping: number,
  ): OrderRecord {
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
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
        // A COMPLETE totals object (#2260 review): the panel reads totals through
        // `parseOrderSnapshot`, whose schema requires every field. A fixture
        // missing `subtotal`/`tax` used to pass only because the panel bypassed
        // its own validator with a cast.
        totals: { subtotal, tax: 0, shipping, total: subtotal + shipping, currency: 'PLN' },
      },
    };
  }

  function renderPanel(record: OrderRecord): void {
    renderWithProviders(<SalesDocumentPanel order={record} />, {
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

  it('closes the manual issue path when the gate recorded a missing rate', async () => {
    // #2254 epic F2: every other block reason means "auto-issue did not happen"
    // and issuing by hand is legitimate; this one means "this cannot be issued",
    // so a live button over the refusal would invite a known failure.
    const blocked: OrderRecord = {
      ...orderWithBasket([{ id: 'a', rate: null, price: 100, quantity: 1 }], 0),
      salesDocumentBlockReason: 'missing-tax-rate',
    };
    renderPanel(blocked);

    expect(await screen.findByRole('button', { name: /issue invoice/i })).toBeDisabled();
    expect(screen.getByText(/no tax rate on 1 line/i)).toBeInTheDocument();
    // The HREF, not just the text (#2260 review): the products list filters on
    // `taxRateState`, and the old `taxRate` param landed on the unfiltered
    // catalogue with no signal the filter had been dropped.
    expect(screen.getByRole('link', { name: /Fix and re-check/i })).toHaveAttribute(
      'href',
      '/products?taxRateState=missing',
    );
  });
});

describe('SalesDocumentPanel - delivery-charge rate block (#2260 review)', () => {
  /**
   * The gate's second refusal shape: every product line HAS a rate, but the
   * delivery charge cannot be attributed to one (here, lines grossing zero while
   * delivery is charged). There is no rate-less line to name, so the panel must
   * not claim one - and the disabled control still needs a reason beside it.
   */
  function deliveryBlockedOrder(): OrderRecord {
    return {
      ...order,
      orderSnapshot: {
        items: [
          {
            id: 'a',
            productId: 'prod_a',
            quantity: 1,
            price: 0,
            name: 'Free sample',
            taxRate: '23',
          },
        ],
        totals: { subtotal: 0, tax: 0, shipping: 10, total: 10, currency: 'PLN' },
      },
      salesDocumentBlockReason: 'missing-tax-rate',
      salesDocumentBlockDetail:
        'the shipping charge cannot be attributed to a tax rate (1 product line(s), none with a usable amount)',
    };
  }

  it('never tells the operator a line has no rate when every line has one', async () => {
    renderWithProviders(<SalesDocumentPanel order={deliveryBlockedOrder()} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
      }),
      ...adminSession,
    });

    expect(
      await screen.findByText(/Not invoiced: the delivery charge has no tax rate\./i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/line has no tax rate/i)).toBeNull();
    expect(screen.queryByText(/lines have no tax rate/i)).toBeNull();
    expect(screen.queryByText(/Some lines/i)).toBeNull();
  });

  it('states the refusal beside the disabled Issue button, and does not point at the catalogue', async () => {
    renderWithProviders(<SalesDocumentPanel order={deliveryBlockedOrder()} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
        invoicing: { getForOrder: vi.fn().mockRejectedValue(notFound()) },
      }),
      ...adminSession,
    });

    expect(await screen.findByRole('button', { name: /issue invoice/i })).toBeDisabled();
    expect(screen.getByText(/no tax rate for the delivery charge/i)).toBeInTheDocument();
    // A delivery charge with nowhere to sit is not fixed in the catalogue.
    expect(screen.queryByRole('link', { name: /Fix and re-check/i })).toBeNull();
  });
});

describe('SalesDocumentPanel - receipt path, missing rate (#2255/#2252)', () => {
  function renderFiscal(record: OrderRecord): void {
    renderWithProviders(<SalesDocumentPanel order={record} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
        fiscalization: { listForOrder: vi.fn().mockResolvedValue([]) },
      }),
      ...adminSession,
    });
  }

  const rateLessBasket: OrderRecord = {
    ...order,
    orderSnapshot: {
      items: [
        { id: 'a', productId: 'prod_a', quantity: 1, price: 100, name: 'Blue mug', taxRate: null },
      ],
      totals: { subtotal: 100, tax: 0, shipping: 0, total: 100, currency: 'PLN' },
    },
    salesDocumentBlockReason: 'missing-tax-rate',
  };

  const deliveryOnlyGap: OrderRecord = {
    ...order,
    orderSnapshot: {
      items: [
        { id: 'a', productId: 'prod_a', quantity: 1, price: 0, name: 'Free sample', taxRate: '23' },
      ],
      totals: { subtotal: 0, tax: 0, shipping: 10, total: 10, currency: 'PLN' },
    },
    salesDocumentBlockReason: 'missing-tax-rate',
  };

  it('disables Register receipt and says why for a rate-less line', async () => {
    renderFiscal(rateLessBasket);

    expect(await screen.findByRole('button', { name: 'Register receipt' })).toBeDisabled();
    expect(screen.getByText(/Not registered: 1 line has no tax rate\./i)).toBeInTheDocument();
    expect(screen.getByText(/tax letter is not used to fill the gap/i)).toBeInTheDocument();
  });

  it('never disables Register receipt with nothing beside it', async () => {
    // The button is disabled on the reason alone, so the alert must render for
    // EVERY shape of that reason - including the one with no rate-less line.
    renderFiscal(deliveryOnlyGap);

    expect(await screen.findByRole('button', { name: 'Register receipt' })).toBeDisabled();
    // Rendered twice on this pool - once as the empty-state block reason, once
    // beside the control - and both say the same true thing.
    expect(
      screen.getAllByText(/Not registered: the delivery charge has no tax rate\./i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/line has no tax rate/i)).toBeNull();
  });

  it('leaves Register receipt live when no rate is missing', async () => {
    renderFiscal({ ...rateLessBasket, salesDocumentBlockReason: null });

    expect(await screen.findByRole('button', { name: 'Register receipt' })).toBeEnabled();
    expect(screen.queryByText(/has no tax rate/i)).toBeNull();
  });
});
