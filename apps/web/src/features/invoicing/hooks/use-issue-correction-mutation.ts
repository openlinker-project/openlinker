/**
 * useIssueCorrectionMutation (#1241)
 *
 * Mutation hook for `POST /invoices/:invoiceId/correct`. On success invalidates
 * the invoicing query domain so the correction record appears immediately.
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
