/**
 * InfaktInvoiceDetailSection tests (#1282)
 *
 * @module plugins/infakt/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { InvoiceRecord } from '../../../features/invoicing/api/invoicing.types';
import { InfaktInvoiceDetailSection } from './infakt-invoice-detail-section';

const infaktConnection = { ...sampleConnection, platformType: 'infakt' };

function makeInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'ol_invoice_test',
    connectionId: infaktConnection.id,
    orderId: 'ol_order_test',
    providerType: 'infakt',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: 'infakt-101',
    providerInvoiceNumber: 'FV 101/TEST/2026',
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

describe('InfaktInvoiceDetailSection', () => {
  it('renders nothing when regulatoryStatus is not-applicable', () => {
    renderWithProviders(
      <InfaktInvoiceDetailSection invoice={makeInvoice()} connection={infaktConnection} />,
    );
    expect(document.querySelector('.invoice-detail-section')).not.toBeInTheDocument();
  });

  it('renders the pending state with a progress indicator when submitted', async () => {
    renderWithProviders(
      <InfaktInvoiceDetailSection
        invoice={makeInvoice({ regulatoryStatus: 'submitted' })}
        connection={infaktConnection}
      />,
    );
    expect(await screen.findByText(/submitting this invoice to KSeF/i)).toBeInTheDocument();
    expect(document.querySelector('.reg-card--info')).toBeInTheDocument();
    expect(document.querySelector('.reg-card__progress')).toBeInTheDocument();
  });

  it('renders the clearance reference chip when accepted', async () => {
    renderWithProviders(
      <InfaktInvoiceDetailSection
        invoice={makeInvoice({
          regulatoryStatus: 'accepted',
          clearanceReference: '5260001246-20260625-A1B2-3D',
        })}
        connection={infaktConnection}
      />,
    );
    expect(await screen.findByText('5260001246-20260625-A1B2-3D')).toBeInTheDocument();
    expect(document.querySelector('.reg-card--success')).toBeInTheDocument();
  });

  it('falls back to providerInvoiceNumber when clearanceReference is absent on accepted', async () => {
    renderWithProviders(
      <InfaktInvoiceDetailSection
        invoice={makeInvoice({
          regulatoryStatus: 'accepted',
          clearanceReference: null,
          providerInvoiceNumber: 'FV 101/TEST/2026',
        })}
        connection={infaktConnection}
      />,
    );
    expect(await screen.findByText('FV 101/TEST/2026')).toBeInTheDocument();
  });

  it('shows the pending fallback when accepted but no reference at all', async () => {
    renderWithProviders(
      <InfaktInvoiceDetailSection
        invoice={makeInvoice({
          regulatoryStatus: 'accepted',
          clearanceReference: null,
          providerInvoiceNumber: null,
        })}
        connection={infaktConnection}
      />,
    );
    expect(await screen.findByText(/KSeF number pending/i)).toBeInTheDocument();
  });

  it('renders the failure reason when rejected', async () => {
    renderWithProviders(
      <InfaktInvoiceDetailSection
        invoice={makeInvoice({
          regulatoryStatus: 'rejected',
          failureReason: 'Invalid buyer NIP format on line 2',
        })}
        connection={infaktConnection}
      />,
    );
    expect(await screen.findByText('Invalid buyer NIP format on line 2')).toBeInTheDocument();
    expect(document.querySelector('.reg-card--error')).toBeInTheDocument();
  });

  it('renders a fallback rejection message when no failureReason is set', async () => {
    renderWithProviders(
      <InfaktInvoiceDetailSection
        invoice={makeInvoice({ regulatoryStatus: 'rejected', failureReason: null })}
        connection={infaktConnection}
      />,
    );
    expect(await screen.findByText('KSeF rejected this invoice.')).toBeInTheDocument();
  });

  it('shows a Resend to KSeF button only when rejected', async () => {
    const { rerender } = renderWithProviders(
      <InfaktInvoiceDetailSection
        invoice={makeInvoice({ regulatoryStatus: 'accepted', clearanceReference: 'REF-1' })}
        connection={infaktConnection}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Resend to KSeF' })).not.toBeInTheDocument();

    rerender(
      <InfaktInvoiceDetailSection
        invoice={makeInvoice({ regulatoryStatus: 'rejected', failureReason: 'nope' })}
        connection={infaktConnection}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Resend to KSeF' })).toBeInTheDocument();
  });

  it('calls resendToKsef when the Resend button is clicked (rejected)', async () => {
    const resendToKsef = vi.fn().mockResolvedValue(makeInvoice({ regulatoryStatus: 'submitted' }));
    const apiClient = createMockApiClient({ invoicing: { resendToKsef } });

    renderWithProviders(
      <InfaktInvoiceDetailSection
        invoice={makeInvoice({ regulatoryStatus: 'rejected', failureReason: 'nope' })}
        connection={infaktConnection}
      />,
      { apiClient },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Resend to KSeF' }));
    await waitFor(() => expect(resendToKsef).toHaveBeenCalledWith('ol_invoice_test'));
  });

  it('calls downloadDocument with kind=rendered when Download PDF is clicked', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    const downloadDocument = vi
      .fn()
      .mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    const apiClient = createMockApiClient({ invoicing: { downloadDocument } });

    renderWithProviders(
      <InfaktInvoiceDetailSection
        invoice={makeInvoice({
          regulatoryStatus: 'accepted',
          clearanceReference: '5260001246-20260625-A1B2-3D',
        })}
        connection={infaktConnection}
      />,
      { apiClient },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() =>
      expect(downloadDocument).toHaveBeenCalledWith('ol_invoice_test', 'rendered'),
    );
  });
});
