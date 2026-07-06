/**
 * useResendToKsefMutation tests (#1356)
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { InvoiceRecord } from '../api/invoicing.types';
import { useResendToKsefMutation } from './use-resend-to-ksef-mutation';

function makeInvoiceRecord(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'ol_invoice_1',
    connectionId: 'conn_1',
    orderId: 'ol_order_1',
    providerType: 'infakt',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: 'inv-uuid-1',
    providerInvoiceNumber: 'FV 1/2026',
    regulatoryStatus: 'submitted',
    clearanceReference: null,
    pdfUrl: null,
    failureMode: null,
    failureCode: null,
    failureReason: null,
    issuedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('useResendToKsefMutation', () => {
  it('calls resendToKsef and resolves to the refreshed InvoiceRecord', async () => {
    const refreshed = makeInvoiceRecord({ regulatoryStatus: 'submitted' });
    const resendToKsef = vi.fn().mockResolvedValue(refreshed);

    let capturedMutation: ReturnType<typeof useResendToKsefMutation> | undefined;

    function Harness(): null {
      capturedMutation = useResendToKsefMutation();
      return null;
    }

    renderWithProviders(<Harness />, {
      apiClient: createMockApiClient({ invoicing: { resendToKsef } }),
    });

    capturedMutation!.mutate('ol_invoice_1');

    await waitFor(() => expect(capturedMutation!.isSuccess).toBe(true));

    expect(capturedMutation!.data).toEqual(refreshed);
    expect(resendToKsef).toHaveBeenCalledWith('ol_invoice_1');
  });

  it('surfaces the error when resendToKsef rejects', async () => {
    const resendToKsef = vi.fn().mockRejectedValue(new Error('KSeF unavailable'));

    let capturedMutation: ReturnType<typeof useResendToKsefMutation> | undefined;

    function Harness(): null {
      capturedMutation = useResendToKsefMutation();
      return null;
    }

    renderWithProviders(<Harness />, {
      apiClient: createMockApiClient({ invoicing: { resendToKsef } }),
    });

    capturedMutation!.mutate('ol_invoice_1');

    await waitFor(() => expect(capturedMutation!.isError).toBe(true));
    expect(capturedMutation!.error?.message).toBe('KSeF unavailable');
  });
});
