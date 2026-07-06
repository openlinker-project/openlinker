/**
 * useResendToKsefMutation (#1356)
 *
 * Mutation hook for `POST /invoices/:invoiceId/resend-to-ksef`. Re-sends a
 * rejected invoice to KSeF and, on success, invalidates the invoicing query
 * domain so the refreshed regulatory status (typically `submitted`) appears
 * immediately. The consumer reads `isPending`/`isSuccess`/`isError` for the
 * button's loading / success / error states.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import type { InvoiceRecord } from '../api/invoicing.types';

export function useResendToKsefMutation(): UseMutationResult<InvoiceRecord, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invoiceId: string) => apiClient.invoicing.resendToKsef(invoiceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invoicingQueryKeys.all });
    },
  });
}
