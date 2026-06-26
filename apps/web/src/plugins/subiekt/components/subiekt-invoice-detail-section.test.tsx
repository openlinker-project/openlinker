/**
 * SubiektInvoiceDetailSection tests (#1241)
 *
 * @module plugins/subiekt/components
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { InvoiceRecord } from '../../../features/invoicing/api/invoicing.types';
import { SubiektInvoiceDetailSection } from './subiekt-invoice-detail-section';

const subiektConnection = { ...sampleConnection, platformType: 'subiekt' };

function makeInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'ol_invoice_test',
    connectionId: subiektConnection.id,
    orderId: 'ol_order_test',
    providerType: 'subiekt',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: 'subiekt-101',
    providerInvoiceNumber: 'FS 101/TEST/2026',
    regulatoryStatus: 'not-applicable',
    clearanceReference: null,
    pdfUrl: null,
    failureMode: null,
    failureCode: null,
    failureReason: null,
    issuedAt: '2026-06-25T10:00:00.000Z',
    createdAt: '2026-06-25T09:59:00.000Z',
    updatedAt: '2026-06-25T10:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('SubiektInvoiceDetailSection', () => {
  it('renders nothing when regulatoryStatus is not-applicable and no pdfUrl', () => {
    renderWithProviders(
      <SubiektInvoiceDetailSection
        invoice={makeInvoice()}
        connection={subiektConnection}
      />,
    );
    expect(screen.queryByText(/Regulatory status/i)).toBeNull();
    expect(screen.queryByText(/KSeF status/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /Download PDF/i })).toBeNull();
  });

  it('renders KSeF status badge and clearance reference when regulatory data present', async () => {
    renderWithProviders(
      <SubiektInvoiceDetailSection
        invoice={makeInvoice({
          regulatoryStatus: 'accepted',
          clearanceReference: '5260001246-20260625-A1B2-3D',
        })}
        connection={subiektConnection}
      />,
    );
    expect(await screen.findByText(/KSeF status/i)).toBeDefined();
    expect(await screen.findByText(/KSeF number/i)).toBeDefined();
    expect(await screen.findByText('5260001246-20260625-A1B2-3D')).toBeDefined();
  });

  it('renders "Pending" when regulatoryStatus is accepted but no clearanceReference or providerInvoiceNumber', async () => {
    renderWithProviders(
      <SubiektInvoiceDetailSection
        invoice={makeInvoice({
          regulatoryStatus: 'submitted',
          clearanceReference: null,
          providerInvoiceNumber: null,
        })}
        connection={subiektConnection}
      />,
    );
    expect(await screen.findByText(/Pending/i)).toBeDefined();
  });

  it('renders PDF download link when pdfUrl is set', async () => {
    renderWithProviders(
      <SubiektInvoiceDetailSection
        invoice={makeInvoice({ pdfUrl: 'https://subiekt.example/invoice-101.pdf' })}
        connection={subiektConnection}
      />,
    );
    const link = await screen.findByRole('link', { name: /Download PDF/i });
    expect(link.getAttribute('href')).toBe('https://subiekt.example/invoice-101.pdf');
  });

  it('renders both regulatory and PDF sections when both are present', async () => {
    renderWithProviders(
      <SubiektInvoiceDetailSection
        invoice={makeInvoice({
          regulatoryStatus: 'accepted',
          clearanceReference: 'REF-001',
          pdfUrl: 'https://subiekt.example/invoice.pdf',
        })}
        connection={subiektConnection}
      />,
    );
    expect(await screen.findByText(/KSeF status/i)).toBeDefined();
    expect(await screen.findByRole('link', { name: /Download PDF/i })).toBeDefined();
  });

  it('renders section when only pdfUrl is present (no regulatory data)', async () => {
    renderWithProviders(
      <SubiektInvoiceDetailSection
        invoice={makeInvoice({ pdfUrl: 'https://subiekt.example/invoice.pdf' })}
        connection={subiektConnection}
      />,
    );
    expect(await screen.findByRole('link', { name: /Download PDF/i })).toBeDefined();
    // No KSeF status row
    expect(screen.queryByText(/KSeF status/i)).toBeNull();
  });
});
