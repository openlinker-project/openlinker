/**
 * Issue Correction Mutation Hook (#1233)
 *
 * Fires `POST /invoices/:invoiceId/correct` via the invoicing API namespace.
 * Invalidates the whole invoicing domain on success so any invoicing query
 * (order invoice panel, invoices list, invoice detail) re-fetches without a
 * manual refresh.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import type { InvoiceRecord, IssueCorrectionInput } from '../api/invoicing.types';

export interface IssueCorrectionVariables {
  invoiceId: string;
  input: IssueCorrectionInput;
}

export function useIssueCorrectionMutation(): UseMutationResult<
  InvoiceRecord,
  Error,
  IssueCorrectionVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ invoiceId, input }) => apiClient.invoicing.issueCorrection(invoiceId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invoicingQueryKeys.all });
    },
  });
}
