/**
 * KsefInvoiceDetailSection Tests (#1152, B4)
 *
 * Covers the read-only KSeF regulatory region rendered into the neutral
 * invoice surfaces via the `invoiceDetailSection` slot:
 *   - renders the clearance badge + KSeF number when regulatory data exists
 *   - returns null when there is no KSeF data (not-applicable + no number)
 *   - prefers `clearanceReference` (the KSeF number) over `providerInvoiceNumber`
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../../../shared/i18n';
import { sampleConnection } from '../../../test/test-utils';
import type { InvoiceRecord } from '../../../features/invoicing';
import { KsefInvoiceDetailSection } from './ksef-invoice-detail-section';

function makeInvoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv_1',
    connectionId: sampleConnection.id,
    orderId: 'ord_1',
    providerType: 'ksef',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: 'pi_1',
    providerInvoiceNumber: 'FV/2026/06/0142',
    regulatoryStatus: 'accepted',
    clearanceReference: '1234567890-20260625-ABCDEF123456-7F',
    pdfUrl: null,
    failureMode: null,
    failureCode: null,
    failureReason: null,
    issuedAt: '2026-06-25T14:08:00.000Z',
    createdAt: '2026-06-25T13:50:00.000Z',
    updatedAt: '2026-06-25T14:08:00.000Z',
    ...over,
  };
}

function renderSection(invoice: InvoiceRecord): ReturnType<typeof render> {
  return render(
    <LocaleProvider>
      <KsefInvoiceDetailSection invoice={invoice} connection={sampleConnection} />
    </LocaleProvider>,
  );
}

describe('KsefInvoiceDetailSection', () => {
  afterEach(cleanup);

  it('renders the clearance badge and KSeF number when regulatory data exists', () => {
    renderSection(makeInvoice());
    expect(screen.getByText('KSeF number')).toBeInTheDocument();
    expect(screen.getByText('1234567890-20260625-ABCDEF123456-7F')).toBeInTheDocument();
    // Neutral RegulatoryStatusBadge renders the accepted label.
    expect(screen.getByText('KSeF: accepted')).toBeInTheDocument();
  });

  it('returns null when there is no KSeF data', () => {
    const { container } = renderSection(
      makeInvoice({
        regulatoryStatus: 'not-applicable',
        clearanceReference: null,
        providerInvoiceNumber: null,
      }),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('prefers clearanceReference over providerInvoiceNumber for the KSeF number', () => {
    renderSection(
      makeInvoice({
        clearanceReference: 'KSEF-CLEARANCE-REF',
        providerInvoiceNumber: 'FALLBACK-NUM',
      }),
    );
    expect(screen.getByText('KSEF-CLEARANCE-REF')).toBeInTheDocument();
    expect(screen.queryByText('FALLBACK-NUM')).not.toBeInTheDocument();
  });

  it('falls back to providerInvoiceNumber when clearanceReference is null', () => {
    renderSection(
      makeInvoice({
        regulatoryStatus: 'submitted',
        clearanceReference: null,
        providerInvoiceNumber: 'FV/2026/06/0142',
      }),
    );
    expect(screen.getByText('FV/2026/06/0142')).toBeInTheDocument();
  });
});
