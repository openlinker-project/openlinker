/**
 * KsefInvoiceDetailSection Tests (#1152, B4 + #1234, B3/B5)
 *
 * Covers the KSeF regulatory region rendered into the neutral invoice surfaces
 * via the `invoiceDetailSection` slot:
 *   - renders the clearance badge + KSeF number when regulatory data exists
 *   - returns null when there is no KSeF data (not-applicable + no number)
 *   - prefers `clearanceReference` (the KSeF number) over `providerInvoiceNumber`
 *   - UPO actions: shown only when `regulatoryStatus === 'accepted'`; hidden
 *     for other statuses (submitted, cleared, rejected)
 *   - Preview UPO: calls `invoicing.downloadUpo` on click and opens the dialog
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

// jsdom lacks createObjectURL/revokeObjectURL; capture originals for restore.
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
    // Neutral RegulatoryStatusBadge renders the accepted label.
    expect(screen.getByText('KSeF: accepted')).toBeInTheDocument();
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
    // Nothing KSeF-specific rendered — neither the section title nor any key.
    expect(screen.queryByText('KSeF · National e-Invoicing System')).not.toBeInTheDocument();
    expect(screen.queryByText('Clearance status')).not.toBeInTheDocument();
  });

  it('prefers clearanceReference over providerInvoiceNumber for the KSeF number', () => {
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

  describe('UPO actions', () => {
    it('shows Preview UPO + Download UPO only when status is accepted', () => {
      renderWithProviders(
        <KsefInvoiceDetailSection
          invoice={makeInvoice({ regulatoryStatus: 'accepted' })}
          connection={sampleConnection}
        />,
      );
      expect(screen.getByRole('button', { name: 'Preview UPO' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download UPO' })).toBeInTheDocument();
    });

    it('hides UPO actions when status is submitted (UPO not yet available)', () => {
      renderWithProviders(
        <KsefInvoiceDetailSection
          invoice={makeInvoice({ regulatoryStatus: 'submitted' })}
          connection={sampleConnection}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Preview UPO' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Download UPO' })).not.toBeInTheDocument();
    });

    it('hides UPO actions when status is cleared', () => {
      renderWithProviders(
        <KsefInvoiceDetailSection
          invoice={makeInvoice({ regulatoryStatus: 'cleared' })}
          connection={sampleConnection}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Preview UPO' })).not.toBeInTheDocument();
    });

    it('calls invoicing.downloadUpo when Preview UPO is clicked and opens the dialog', async () => {
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

      fireEvent.click(screen.getByRole('button', { name: 'Preview UPO' }));
      await waitFor(() => {
        expect(downloadUpo).toHaveBeenCalledWith('inv_1');
      });
      // The dialog opens after a successful fetch.
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('calls invoicing.downloadUpo when Download UPO is clicked', async () => {
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
      await waitFor(() => {
        expect(downloadUpo).toHaveBeenCalledWith('inv_1');
      });
    });
  });
});
