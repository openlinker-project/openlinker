/**
 * useBulkIssueInvoicesMutation (#1355 — bulk issue)
 *
 * Mutation for `POST /invoices/bulk-issue` (#1355). Issues invoices for a list
 * of order ids on ONE invoicing connection, fanning out over the same
 * single-order issue primitive server-side; idempotent per (connection, order)
 * so a re-submitted batch does not double-issue. Renders the aggregate
 * `issued` / `skipped` / `failed` result. On success it invalidates the
 * invoices list so the freshly-issued rows surface.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import type { BulkIssueInvoicesInput, BulkIssueInvoicesResult } from '../api/invoicing.types';

export function useBulkIssueInvoicesMutation(): UseMutationResult<
  BulkIssueInvoicesResult,
  Error,
  BulkIssueInvoicesInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<BulkIssueInvoicesResult, Error, BulkIssueInvoicesInput>({
    mutationFn: (input) => apiClient.invoicing.bulkIssue(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invoicingQueryKeys.all });
    },
  });
}
