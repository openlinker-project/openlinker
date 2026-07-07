/**
 * useSendInvoiceEmailMutation (#1353)
 *
 * Mutation hook for `POST /invoices/:invoiceId/send-email`. Triggers the
 * connection's Invoicing provider to render + email the issued invoice to the
 * buyer (OpenLinker only triggers the send). On success invalidates the
 * invoicing query domain so any status change (the provider flips the invoice
 * to "sent") surfaces. Neutral: keyed on the internal `invoice.id`.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import type { SendInvoiceEmailInput, SendInvoiceEmailResult } from '../api/invoicing.types';

export interface SendInvoiceEmailVariables {
  invoiceId: string;
  input: SendInvoiceEmailInput;
}

export function useSendInvoiceEmailMutation(): UseMutationResult<
  SendInvoiceEmailResult,
  Error,
  SendInvoiceEmailVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<SendInvoiceEmailResult, Error, SendInvoiceEmailVariables>({
    mutationFn: ({ invoiceId, input }) => apiClient.invoicing.sendEmail(invoiceId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invoicingQueryKeys.all });
    },
  });
}
