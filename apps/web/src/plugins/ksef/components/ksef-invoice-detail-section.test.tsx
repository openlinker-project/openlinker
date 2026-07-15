/**
 * KsefInvoiceDetailSection Tests (#1152, B4 + #1234, B3 + #1228, B5)
 *
 * Covers the KSeF regulatory region rendered into the neutral invoice surfaces
 * via the `invoiceDetailSection` slot:
 *   - renders the clearance badge + KSeF number when regulatory data exists
 *   - returns null when there is no KSeF data (not-applicable + no number)
 *   - prefers `clearanceReference` (the KSeF number) over `providerInvoiceNumber`
 *   - UPO actions: shown only when `regulatoryStatus === 'accepted'`
 *   - FA(3) actions (View + Download XML): shown only when `regulatoryStatus === 'accepted'`
 *   - Preview UPO: calls `invoicing.downloadUpo` + opens dialog
 *   - View FA(3): calls `invoicing.downloadDocument(id, 'rendered')` + shows inline frame
 *   - Download XML: calls `invoicing.downloadDocument(id, 'source')`
 *   - Slot is registered on the KSeF plugin descriptor
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
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

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe('KsefInvoiceDetailSection', () => {
  afterEach(() => {
    cleanup();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('renders the clearance badge and KSeF number when regulatory data exists', () => {
    renderWithProviders(
      <KsefInvoiceDetailSection invoice={makeInvoice()} connection={sampleConnection} />,
    );
    expect(screen.getByText('KSeF number')).toBeInTheDocument();
    expect(screen.getByText('1234567890-20260625-ABCDEF123456-7F')).toBeInTheDocument();
    expect(screen.getByText('KSeF: accepted')).toBeInTheDocument();
  });

  it('surfaces the rejection detail when a document was rejected (#1582)', () => {
    renderWithProviders(
      <KsefInvoiceDetailSection
        invoice={makeInvoice({
          regulatoryStatus: 'rejected',
          clearanceDetail: 'KSeF status 440: buyer NIP invalid',
        })}
        connection={sampleConnection}
      />,
    );
    expect(screen.getByText('Rejection detail')).toBeInTheDocument();
    expect(screen.getByText('KSeF status 440: buyer NIP invalid')).toBeInTheDocument();
  });

  it('does not render a rejection detail row when the document is not rejected (#1582)', () => {
    renderWithProviders(
      <KsefInvoiceDetailSection invoice={makeInvoice()} connection={sampleConnection} />,
    );
    expect(screen.queryByText('Rejection detail')).not.toBeInTheDocument();
  });

  it('surfaces the KSeF number as a copyable value with the Art. 108g payment-title hint', () => {
    renderWithProviders(
      <KsefInvoiceDetailSection invoice={makeInvoice()} connection={sampleConnection} />,
    );
    // Copyable affordance (CopyableId renders a Copy button labelled with the id).
    expect(
      screen.getByRole('button', { name: 'Copy 1234567890-20260625-ABCDEF123456-7F' }),
    ).toBeInTheDocument();
    // Art. 108g hint present so the operator knows to paste it into the transfer title.
    expect(screen.getByText(/Art\. 108g/)).toBeInTheDocument();
  });

  it('returns null when there is no KSeF data', () => {
    renderWithProviders(
      <KsefInvoiceDetailSection
        invoice={makeInvoice({
          regulatoryStatus: 'not-applicable',
          clearanceReference: null,
          providerInvoiceNumber: null,
        })}
        connection={sampleConnection}
      />,
    );
    expect(screen.queryByText('KSeF · National e-Invoicing System')).not.toBeInTheDocument();
    expect(screen.queryByText('Clearance status')).not.toBeInTheDocument();
  });

  it('prefers clearanceReference over providerInvoiceNumber', () => {
    renderWithProviders(
      <KsefInvoiceDetailSection
        invoice={makeInvoice({
          clearanceReference: 'KSEF-CLEARANCE-REF',
          providerInvoiceNumber: 'FALLBACK-NUM',
        })}
        connection={sampleConnection}
      />,
    );
    expect(screen.getByText('KSEF-CLEARANCE-REF')).toBeInTheDocument();
    expect(screen.queryByText('FALLBACK-NUM')).not.toBeInTheDocument();
  });

  it('falls back to providerInvoiceNumber when clearanceReference is null', () => {
    renderWithProviders(
      <KsefInvoiceDetailSection
        invoice={makeInvoice({
          regulatoryStatus: 'submitted',
          clearanceReference: null,
          providerInvoiceNumber: 'FV/2026/06/0142',
        })}
        connection={sampleConnection}
      />,
    );
    expect(screen.getByText('FV/2026/06/0142')).toBeInTheDocument();
  });

  describe('UPO actions (B3)', () => {
    it('shows Preview + Download UPO only when status is accepted', () => {
      renderWithProviders(
        <KsefInvoiceDetailSection
          invoice={makeInvoice({ regulatoryStatus: 'accepted' })}
          connection={sampleConnection}
        />,
      );
      expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download UPO' })).toBeInTheDocument();
    });

    it('hides UPO actions when status is submitted', () => {
      renderWithProviders(
        <KsefInvoiceDetailSection
          invoice={makeInvoice({ regulatoryStatus: 'submitted' })}
          connection={sampleConnection}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Download UPO' })).not.toBeInTheDocument();
    });

    it('calls downloadUpo when Preview is clicked and opens the UPO dialog', async () => {
      URL.createObjectURL = vi.fn(() => 'about:blank');
      URL.revokeObjectURL = vi.fn();
      const downloadUpo = vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
      const apiClient = createMockApiClient({ invoicing: { downloadUpo } });

      renderWithProviders(
        <KsefInvoiceDetailSection
          invoice={makeInvoice({ regulatoryStatus: 'accepted' })}
          connection={sampleConnection}
        />,
        { apiClient },
      );

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
      await waitFor(() => expect(downloadUpo).toHaveBeenCalledWith('inv_1'));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    });

    it('calls downloadUpo when Download UPO is clicked', async () => {
      URL.createObjectURL = vi.fn(() => 'blob:mock');
      URL.revokeObjectURL = vi.fn();
      const downloadUpo = vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
      const apiClient = createMockApiClient({ invoicing: { downloadUpo } });

      renderWithProviders(
        <KsefInvoiceDetailSection
          invoice={makeInvoice({ regulatoryStatus: 'accepted' })}
          connection={sampleConnection}
        />,
        { apiClient },
      );

      fireEvent.click(screen.getByRole('button', { name: 'Download UPO' }));
      await waitFor(() => expect(downloadUpo).toHaveBeenCalledWith('inv_1'));
    });
  });

  describe('FA(3) actions (B5)', () => {
    it('shows FA(3) document row and doc-preview placeholder when status is accepted', () => {
      renderWithProviders(
        <KsefInvoiceDetailSection
          invoice={makeInvoice({ regulatoryStatus: 'accepted' })}
          connection={sampleConnection}
        />,
      );
      expect(screen.getByText('FA(3) document')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download XML' })).toBeInTheDocument();
      expect(screen.getByText("Click 'View' to load the invoice.")).toBeInTheDocument();
    });

    it('hides FA(3) actions when status is submitted', () => {
      renderWithProviders(
        <KsefInvoiceDetailSection
          invoice={makeInvoice({ regulatoryStatus: 'submitted' })}
          connection={sampleConnection}
        />,
      );
      expect(screen.queryByText('FA(3) document')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
    });

    it('loads the FA(3) source XML and shows parsed view on View click', async () => {
      URL.createObjectURL = vi.fn(() => 'blob:fa3-source');
      URL.revokeObjectURL = vi.fn();
      // Return a minimal valid FA(3) XML so KsefFa3View renders (not null).
      const fa3Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura>
  <Podmiot1><DaneIdentyfikacyjne><NIP>1111111111</NIP><Nazwa>Seller Ltd</Nazwa></DaneIdentyfikacyjne></Podmiot1>
  <Podmiot2><DaneIdentyfikacyjne><NIP>2222222222</NIP><Nazwa>Buyer Ltd</Nazwa></DaneIdentyfikacyjne></Podmiot2>
  <Fa><P_1>2026-01-01</P_1><P_2>FV/2026/001</P_2><P_15>123.00</P_15></Fa>
</Faktura>`;
      const downloadDocument = vi
        .fn()
        .mockResolvedValue(new Blob([fa3Xml], { type: 'application/xml' }));
      const apiClient = createMockApiClient({ invoicing: { downloadDocument } });

      renderWithProviders(
        <KsefInvoiceDetailSection
          invoice={makeInvoice({ regulatoryStatus: 'accepted' })}
          connection={sampleConnection}
        />,
        { apiClient },
      );

      fireEvent.click(screen.getByRole('button', { name: 'View' }));
      // The hook now fetches kind=source (XML) for client-side parsing, not kind=rendered.
      await waitFor(() =>
        expect(downloadDocument).toHaveBeenCalledWith('inv_1', 'source'),
      );
      // KsefFa3View renders the parsed invoice — no iframe.
      await waitFor(() => expect(screen.getByText('FV/2026/001')).toBeInTheDocument());
      expect(screen.queryByTitle('FA(3) document preview')).not.toBeInTheDocument();
    });

    it('falls through to error copy when the fetched XML cannot be parsed', async () => {
      URL.createObjectURL = vi.fn(() => 'blob:fa3-source');
      URL.revokeObjectURL = vi.fn();
      const downloadDocument = vi
        .fn()
        .mockResolvedValue(new Blob(['not xml at all ><>'], { type: 'application/xml' }));
      const apiClient = createMockApiClient({ invoicing: { downloadDocument } });

      renderWithProviders(
        <KsefInvoiceDetailSection
          invoice={makeInvoice({ regulatoryStatus: 'accepted' })}
          connection={sampleConnection}
        />,
        { apiClient },
      );

      fireEvent.click(screen.getByRole('button', { name: 'View' }));
      await waitFor(() =>
        expect(screen.getByText("Preview failed. Click 'View' to retry.")).toBeInTheDocument(),
      );
      expect(screen.queryByText("Click 'View' to load the invoice.")).not.toBeInTheDocument();
    });

    it('calls downloadDocument with kind=source when Download XML is clicked', async () => {
      URL.createObjectURL = vi.fn(() => 'blob:xml');
      URL.revokeObjectURL = vi.fn();
      const downloadDocument = vi
        .fn()
        .mockResolvedValue(new Blob(['<?xml'], { type: 'application/xml' }));
      const apiClient = createMockApiClient({ invoicing: { downloadDocument } });

      renderWithProviders(
        <KsefInvoiceDetailSection
          invoice={makeInvoice({ regulatoryStatus: 'accepted' })}
          connection={sampleConnection}
        />,
        { apiClient },
      );

      fireEvent.click(screen.getByRole('button', { name: 'Download XML' }));
      await waitFor(() =>
        expect(downloadDocument).toHaveBeenCalledWith('inv_1', 'source'),
      );
    });
  });
});
