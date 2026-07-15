/**
 * useIssueCorrectionMutation tests (#1233)
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { InvoiceRecord } from '../api/invoicing.types';
import { useIssueCorrectionMutation } from './use-issue-correction-mutation';

function makeInvoiceRecord(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'ol_invoice_1',
    connectionId: 'conn_1',
    orderId: 'ol_order_1',
    providerType: 'ksef',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: 'ksef-1',
    providerInvoiceNumber: 'FV 1/2026',
    regulatoryStatus: 'accepted',
    clearanceReference: null,
    pdfUrl: null,
    failureMode: null,
    failureCode: null,
    failureReason: null,
    issuedAt: null,
    createdAt: '2026-06-25T00:00:00.000Z',
    updatedAt: '2026-06-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('useIssueCorrectionMutation', () => {
  it('calls issueCorrection and resolves to the corrected InvoiceRecord', async () => {
    const correctionRecord = makeInvoiceRecord({ id: 'ol_invoice_cor', documentType: 'corrected' });
    const issueCorrection = vi.fn().mockResolvedValue(correctionRecord);

    let capturedMutation: ReturnType<typeof useIssueCorrectionMutation> | undefined;

    function Harness(): null {
      capturedMutation = useIssueCorrectionMutation();
      return null;
    }

    renderWithProviders(<Harness />, {
      apiClient: createMockApiClient({ invoicing: { issueCorrection } }),
    });

    capturedMutation!.mutate({
      invoiceId: 'ol_invoice_1',
      input: { reason: 'partial return', lines: [{ originalLineNumber: 1, newQuantity: 0 }] },
    });

    await waitFor(() => expect(capturedMutation!.isSuccess).toBe(true));

    expect(capturedMutation!.data).toEqual(correctionRecord);
    expect(issueCorrection).toHaveBeenCalledWith('ol_invoice_1', {
      reason: 'partial return',
      lines: [{ originalLineNumber: 1, newQuantity: 0 }],
    });
  });

  it('surfaces the error when issueCorrection rejects', async () => {
    const issueCorrection = vi.fn().mockRejectedValue(new Error('KSeF unavailable'));

    let capturedMutation: ReturnType<typeof useIssueCorrectionMutation> | undefined;

    function Harness(): null {
      capturedMutation = useIssueCorrectionMutation();
      return null;
    }

    renderWithProviders(<Harness />, {
      apiClient: createMockApiClient({ invoicing: { issueCorrection } }),
    });

    capturedMutation!.mutate({
      invoiceId: 'ol_invoice_1',
      input: { reason: 'partial return', lines: [] },
    });

    await waitFor(() => expect(capturedMutation!.isError).toBe(true));
    expect(capturedMutation!.error?.message).toBe('KSeF unavailable');
  });
});
