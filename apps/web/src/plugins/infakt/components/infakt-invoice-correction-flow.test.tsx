/**
 * InfaktInvoiceCorrectionFlow tests (#1282)
 *
 * @module plugins/infakt/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import type { InvoiceRecord } from '../../../features/invoicing/api/invoicing.types';
import { InfaktInvoiceCorrectionFlow } from './infakt-invoice-correction-flow';

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
    providerInvoiceNumber: 'FV 101/inFakt/2026',
    regulatoryStatus: 'accepted',
    clearanceReference: '5260001246-20260625-A1B2-3D',
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

describe('InfaktInvoiceCorrectionFlow', () => {
  it('renders the form header and invoice reference', async () => {
    renderWithProviders(
      <InfaktInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={infaktConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
    );
    expect(await screen.findByRole('heading', { name: /Issue KOR correction/i })).toBeDefined();
    expect(await screen.findByText(/FV 101\/inFakt\/2026/i)).toBeDefined();
  });

  it('renders the reason textarea', async () => {
    renderWithProviders(
      <InfaktInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={infaktConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
    );
    expect(await screen.findByLabelText(/Reason for correction/i)).toBeDefined();
  });

  it('starts with one empty line row', async () => {
    renderWithProviders(
      <InfaktInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={infaktConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
    );
    const lineInputs = await screen.findAllByLabelText(/Line number/i);
    expect(lineInputs).toHaveLength(1);
  });

  it('adds a line row on "+ Add line" click', async () => {
    renderWithProviders(
      <InfaktInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={infaktConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
    );
    const addBtn = await screen.findByText(/Add line/i);
    fireEvent.click(addBtn);
    const lineInputs = await screen.findAllByLabelText(/Line number/i);
    expect(lineInputs).toHaveLength(2);
  });

  it('removes a line row when Remove is clicked', async () => {
    renderWithProviders(
      <InfaktInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={infaktConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByText(/Add line/i));
    let lineInputs = await screen.findAllByLabelText(/Line number/i);
    expect(lineInputs).toHaveLength(2);

    const removeBtns = await screen.findAllByRole('button', { name: /Remove line/i });
    fireEvent.click(removeBtns[0]);

    lineInputs = await screen.findAllByLabelText(/Line number/i);
    expect(lineInputs).toHaveLength(1);
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <InfaktInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={infaktConnection}
        onClose={onClose}
        onCorrectionIssued={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByText(/Cancel/i));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('blocks submit when no line has a line number and shows error', async () => {
    const issueCorrection = vi.fn();
    renderWithProviders(
      <InfaktInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={infaktConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
      { apiClient: createMockApiClient({ invoicing: { issueCorrection } }) },
    );

    fireEvent.click(await screen.findByRole('button', { name: /Issue KOR/i }));

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(await screen.findByText(/at least one line/i)).toBeDefined();
    expect(issueCorrection).not.toHaveBeenCalled();
  });

  it('submits issueCorrection with reason, line data and idempotencyKey on form submit', async () => {
    const correctionInvoice = makeInvoice({ id: 'ol_invoice_correction' });
    const issueCorrection = vi.fn().mockResolvedValue(correctionInvoice);
    const onCorrectionIssued = vi.fn();
    const onClose = vi.fn();

    renderWithProviders(
      <InfaktInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={infaktConnection}
        onClose={onClose}
        onCorrectionIssued={onCorrectionIssued}
      />,
      { apiClient: createMockApiClient({ invoicing: { issueCorrection } }) },
    );

    const reasonInput = await screen.findByLabelText(/Reason for correction/i);
    fireEvent.change(reasonInput, { target: { value: 'Partial return' } });

    const lineInput = await screen.findByLabelText(/Line number 1/i);
    fireEvent.change(lineInput, { target: { value: '1' } });
    const qtyInput = await screen.findByLabelText(/New qty, line 1/i);
    fireEvent.change(qtyInput, { target: { value: '0' } });
    const priceInput = await screen.findByLabelText(/New price, line 1/i);
    fireEvent.change(priceInput, { target: { value: '34.84' } });

    fireEvent.click(await screen.findByRole('button', { name: /Issue KOR/i }));

    await waitFor(() => {
      expect(issueCorrection).toHaveBeenCalledWith(
        'ol_invoice_test',
        expect.objectContaining({
          reason: 'Partial return',
          lines: [{ originalLineNumber: 1, newQuantity: 0, newUnitPriceGross: 34.84 }],
          idempotencyKey: expect.stringMatching(/^infakt-corr-/),
        }),
      );
    });

    await waitFor(() => expect(onCorrectionIssued).toHaveBeenCalledWith('ol_invoice_correction'));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('does not include empty line rows in the submission', async () => {
    const issueCorrection = vi.fn().mockResolvedValue(makeInvoice({ id: 'ol_invoice_cor2' }));

    renderWithProviders(
      <InfaktInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={infaktConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
      { apiClient: createMockApiClient({ invoicing: { issueCorrection } }) },
    );

    // Add a second line but leave it empty
    fireEvent.click(await screen.findByText(/Add line/i));

    // Only fill line 1 — line number plus a delta, so it's a valid (non-no-op) row
    const lineInputs = await screen.findAllByLabelText(/Line number/i);
    fireEvent.change(lineInputs[0], { target: { value: '2' } });
    const qtyInputs = await screen.findAllByLabelText(/New qty, line/i);
    fireEvent.change(qtyInputs[0], { target: { value: '3' } });

    fireEvent.change(await screen.findByLabelText(/Reason for correction/i), {
      target: { value: 'partial return' },
    });

    fireEvent.click(await screen.findByRole('button', { name: /Issue KOR/i }));

    await waitFor(() => {
      const call = issueCorrection.mock.calls[0] as [
        string,
        { lines: { originalLineNumber: number }[] },
      ];
      expect(call[1].lines).toHaveLength(1);
      expect(call[1].lines[0].originalLineNumber).toBe(2);
    });
  });

  it('blocks submit when a filled line has neither new quantity nor new price', async () => {
    const issueCorrection = vi.fn();

    renderWithProviders(
      <InfaktInvoiceCorrectionFlow
        invoice={makeInvoice()}
        connection={infaktConnection}
        onClose={vi.fn()}
        onCorrectionIssued={vi.fn()}
      />,
      { apiClient: createMockApiClient({ invoicing: { issueCorrection } }) },
    );

    const lineInputs = await screen.findAllByLabelText(/Line number/i);
    fireEvent.change(lineInputs[0], { target: { value: '1' } });

    fireEvent.click(await screen.findByRole('button', { name: /Issue KOR/i }));

    expect(
      await screen.findByText(/Each line must specify a new quantity and\/or a new price/i),
    ).toBeInTheDocument();
    expect(issueCorrection).not.toHaveBeenCalled();
  });
});
