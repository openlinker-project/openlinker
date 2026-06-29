/**
 * SubiektInvoiceCorrectionFlow tests (#1241)
 *
 * @module plugins/subiekt/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient, sampleConnection } from '../../../test/test-utils';
import type { InvoiceRecord } from '../../../features/invoicing/api/invoicing.types';
import { SubiektInvoiceCorrectionFlow } from './subiekt-invoice-correction-flow';

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
    regulatoryStatus: 'accepted',
    clearanceReference: '5260001246-20260625-A1B2-3D',
    pdfUrl: 'https://subiekt.example/invoice.pdf',
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

describe('SubiektInvoiceCorrectionFlow', () => {
  it('renders the form header and invoice reference', async () => {
    renderWithProviders(
      <SubiektInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={subiektConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
    );
    expect(await screen.findByRole('heading', { name: /Issue correction/i })).toBeDefined();
    expect(await screen.findByText(/FS 101\/TEST\/2026/i)).toBeDefined();
  });

  it('renders the reason textarea', async () => {
    renderWithProviders(
      <SubiektInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={subiektConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
    );
    expect(await screen.findByLabelText(/Reason for correction/i)).toBeDefined();
  });

  it('starts with one empty line row', async () => {
    renderWithProviders(
      <SubiektInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={subiektConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
    );
    const lineInputs = await screen.findAllByLabelText(/Line number/i);
    expect(lineInputs).toHaveLength(1);
  });

  it('adds a line row on "+ Add line" click', async () => {
    renderWithProviders(
      <SubiektInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={subiektConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
    );
    const addBtn = await screen.findByText(/Add line/i);
    fireEvent.click(addBtn);
    const lineInputs = await screen.findAllByLabelText(/Line number/i);
    expect(lineInputs).toHaveLength(2);
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SubiektInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={subiektConnection}
        onClose={onClose}
        onCorrectionIssued={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByText(/Cancel/i));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('submits issueCorrection with reason and line data on form submit', async () => {
    const correctionInvoice = makeInvoice({ id: 'ol_invoice_correction' });
    const issueCorrection = vi.fn().mockResolvedValue(correctionInvoice);
    const onCorrectionIssued = vi.fn();
    const onClose = vi.fn();

    renderWithProviders(
      <SubiektInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={subiektConnection}
        onClose={onClose}
        onCorrectionIssued={onCorrectionIssued}
      />,
      { apiClient: createMockApiClient({ invoicing: { issueCorrection } }) },
    );

    // Fill reason
    const reasonInput = await screen.findByLabelText(/Reason for correction/i);
    fireEvent.change(reasonInput, { target: { value: 'Partial return' } });

    // Fill line 1
    const lineInput = await screen.findByLabelText(/Line number 1/i);
    fireEvent.change(lineInput, { target: { value: '1' } });
    const qtyInput = await screen.findByLabelText(/New qty, line 1/i);
    fireEvent.change(qtyInput, { target: { value: '0' } });
    const priceInput = await screen.findByLabelText(/New net, line 1/i);
    fireEvent.change(priceInput, { target: { value: '34.84' } });

    // Submit
    fireEvent.click(await screen.findByRole('button', { name: /Issue correction/i }));

    await waitFor(() => {
      expect(issueCorrection).toHaveBeenCalledWith('ol_invoice_test', {
        reason: 'Partial return',
        lines: [{ originalLineNumber: 1, newQuantity: 0, newUnitPriceGross: 34.84 }],
        idempotencyKey: expect.stringMatching(/^sk-corr-/),
      });
    });

    await waitFor(() => expect(onCorrectionIssued).toHaveBeenCalledWith('ol_invoice_correction'));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('does not include empty line rows in the submission', async () => {
    const issueCorrection = vi.fn().mockResolvedValue(makeInvoice({ id: 'ol_invoice_cor2' }));

    renderWithProviders(
      <SubiektInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={subiektConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
      { apiClient: createMockApiClient({ invoicing: { issueCorrection } }) },
    );

    // Add a second line but leave it empty
    fireEvent.click(await screen.findByText(/Add line/i));

    // Only fill line 1
    const lineInputs = await screen.findAllByLabelText(/Line number/i);
    fireEvent.change(lineInputs[0], { target: { value: '2' } });

    fireEvent.click(await screen.findByRole('button', { name: /Issue correction/i }));

    await waitFor(() => {
      const call = issueCorrection.mock.calls[0] as [string, { lines: { originalLineNumber: number }[] }];
      expect(call[1].lines).toHaveLength(1);
      expect(call[1].lines[0].originalLineNumber).toBe(2);
    });
  });
});
