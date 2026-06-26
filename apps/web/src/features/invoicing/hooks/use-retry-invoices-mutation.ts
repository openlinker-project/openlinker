/**
 * useRetryInvoicesMutation (#1240 — C2 batch retry)
 *
 * Mutation for `POST /invoices/retry` (W6 #1245). The server gates eligibility
 * (only `failed + rejected` records are re-attempted; every other state is
 * skipped per-id with a neutral reason), so the FE sends the full selection and
 * renders the aggregate `retried` / `skipped` result. On success it invalidates
 * the invoices list so refreshed statuses surface.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import type { RetryInvoicesInput, RetryInvoicesResult } from '../api/invoicing.types';

export function useRetryInvoicesMutation(): UseMutationResult<
  RetryInvoicesResult,
  Error,
  RetryInvoicesInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<RetryInvoicesResult, Error, RetryInvoicesInput>({
    mutationFn: (input) => apiClient.invoicing.retry(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invoicingQueryKeys.all });
    },
  });
}
