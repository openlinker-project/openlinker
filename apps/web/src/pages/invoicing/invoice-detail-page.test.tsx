/**
 * InvoiceDetailPage — page tests (#1240 A2)
 *
 * Drives the page through mocked API state: loading, not-found (404), generic
 * error, and each key display state (issued, failed+rejected, in-doubt).
 *
 * Fiscal-safety assertions:
 *   - failed+rejected: Retry button present
 *   - in-doubt: NO Retry, Check/Mark-resolved present
 *   - issuing: NO Retry
 *   - Accepted clearance: visible "Accepted", no "Cleared" text
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ApiError } from '../../shared/api/api-error';
import type { Connection } from '../../features/connections';
import type { InvoiceRecord } from '../../features/invoicing/api/invoicing.types';
import { InvoiceDetailPage } from './invoice-detail-page';

afterEach(cleanup);

const INVOICE_ID = 'inv_123';
const ORDER_ID = 'ord_456';
const CONN_ID = 'conn_inv';

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
    id: INVOICE_ID,
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
    issuedAt: '2026-06-02T10:00:00.000Z',
    createdAt: '2026-06-02T09:00:00.000Z',
    updatedAt: '2026-06-02T10:00:00.000Z',
    ...over,
  };
}

/** Render the page with `:invoiceId` param wired into a real Route definition. */
function renderPage(inv: InvoiceRecord | Error | Promise<never>) {
  const getById =
    inv instanceof Error
      ? vi.fn().mockRejectedValue(inv)
      : inv instanceof Promise
        ? vi.fn().mockReturnValue(inv)
        : vi.fn().mockResolvedValue(inv);

  const apiClient = createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue([invoicingConnection]) },
    invoicing: { getById },
  });

  return renderWithProviders(
    <Routes>
      <Route path="/invoices/:invoiceId" element={<InvoiceDetailPage />} />
    </Routes>,
    { apiClient, route: `/invoices/${INVOICE_ID}` },
  );
}

describe('InvoiceDetailPage — page states', () => {
  it('loading: renders skeleton while query is in-flight', () => {
    // Never-resolving promise keeps the query in pending state
    const neverResolves = new Promise<never>(() => { /* never resolves */ });
    const { container } = renderPage(neverResolves);
    expect(container.querySelector('.invoice-detail__skeleton')).toBeInTheDocument();
  });

  it('not-found (404): renders EmptyState + back link, no Retry', async () => {
    renderPage(new ApiError('Not found', 404, {}));
    // Both page-title and EmptyState title say "Invoice not found" — use getAllByText
    const headers = await screen.findAllByText(/invoice not found/i);
    expect(headers.length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /back to invoices/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('generic error (500): renders ErrorState with retry-query button', async () => {
    renderPage(new ApiError('Server error', 500, {}));
    // Both page-title and ErrorState title say "Error loading invoice"
    const headers = await screen.findAllByText(/error loading invoice/i);
    expect(headers.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('issued: renders number, PDF link, connection link, timeline, no Retry', async () => {
    renderPage(makeInvoice());
    // Invoice number appears in both the page title and the KV section
    const numberEls = await screen.findAllByText('FV/2026/06/001');
    expect(numberEls.length).toBeGreaterThan(0);
    // PDF link
    expect(screen.getByRole('link', { name: /invoice pdf/i })).toHaveAttribute(
      'href',
      'https://subiekt.example/inv/1.pdf',
    );
    // Connection link
    expect(screen.getByRole('link', { name: 'Subiekt GT' })).toBeInTheDocument();
    // Timeline present
    expect(screen.getByText('Issuance')).toBeInTheDocument();
    // No Retry for issued
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('failed + rejected: error alert, Retry button enabled', async () => {
    renderPage(
      makeInvoice({ status: 'failed', failureMode: 'rejected', failureCode: 'provider-rejected' }),
    );
    // Multiple elements may contain "rejected" (alert + retry hint)
    const rejectedEls = await screen.findAllByText(/rejected|nothing was issued/i);
    expect(rejectedEls.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled();
  });

  it('in-doubt: warning alert, Check/Mark-resolved, NO Retry', async () => {
    renderPage(
      makeInvoice({ status: 'failed', failureMode: 'in-doubt', failureCode: 'transport-timeout' }),
    );
    // Wait for in-doubt branch to fully render by locating the Check Provider button
    expect(await screen.findByRole('button', { name: /check provider/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark resolved/i })).toBeInTheDocument();
    // In-doubt: no Retry button
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('issuing: NO Retry, locked node in timeline', async () => {
    renderPage(makeInvoice({ status: 'issuing' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /retry/i })).toBeNull(),
    );
    expect(await screen.findByText(/in progress.*locked/i)).toBeInTheDocument();
  });

  it('accepted clearance: renders "Accepted", never "Cleared"', async () => {
    renderPage(makeInvoice({ regulatoryStatus: 'accepted' }));
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(screen.queryByText(/cleared/i)).toBeNull();
  });
});
