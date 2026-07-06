/**
 * useSendInvoiceEmailMutation tests (#1353)
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { useSendInvoiceEmailMutation } from './use-send-invoice-email-mutation';

describe('useSendInvoiceEmailMutation', () => {
  it('calls sendEmail with the invoice id + input and resolves to the delivery result', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ delivered: true, recipient: null });

    let capturedMutation: ReturnType<typeof useSendInvoiceEmailMutation> | undefined;

    function Harness(): null {
      capturedMutation = useSendInvoiceEmailMutation();
      return null;
    }

    renderWithProviders(<Harness />, {
      apiClient: createMockApiClient({ invoicing: { sendEmail } }),
    });

    capturedMutation!.mutate({
      invoiceId: 'ol_invoice_1',
      input: { locale: 'en' },
    });

    await waitFor(() => expect(capturedMutation!.isSuccess).toBe(true));

    expect(capturedMutation!.data).toEqual({ delivered: true, recipient: null });
    expect(sendEmail).toHaveBeenCalledWith('ol_invoice_1', {
      locale: 'en',
    });
  });

  it('surfaces the error when sendEmail rejects', async () => {
    const sendEmail = vi.fn().mockRejectedValue(new Error('Provider cannot send email'));

    let capturedMutation: ReturnType<typeof useSendInvoiceEmailMutation> | undefined;

    function Harness(): null {
      capturedMutation = useSendInvoiceEmailMutation();
      return null;
    }

    renderWithProviders(<Harness />, {
      apiClient: createMockApiClient({ invoicing: { sendEmail } }),
    });

    capturedMutation!.mutate({ invoiceId: 'ol_invoice_1', input: {} });

    await waitFor(() => expect(capturedMutation!.isError).toBe(true));
    expect(capturedMutation!.error?.message).toBe('Provider cannot send email');
  });
});
