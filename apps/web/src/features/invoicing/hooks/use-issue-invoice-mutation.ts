/**
 * useIssueInvoiceMutation (#757)
 *
 * Mutation for `POST /invoices` (manual issue + failed-row retry). On success
 * invalidates the per-order invoice query and seeds the cache so the panel
 * flips to issued without a refetch.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import type { InvoiceRecord, IssueInvoiceInput } from '../api/invoicing.types';

export function useIssueInvoiceMutation(): UseMutationResult<
  InvoiceRecord,
  Error,
  IssueInvoiceInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<InvoiceRecord, Error, IssueInvoiceInput>({
    mutationFn: (input) => apiClient.invoicing.issue(input),
    onSuccess: async (record, input) => {
      // Seed the cache so the panel flips to the returned status without waiting
      // on a refetch.
      queryClient.setQueryData(
        invoicingQueryKeys.forOrder(input.orderId, input.connectionId),
        record,
      );
      // Only invalidate (force a refetch) when the returned row is still
      // `pending` — the poll then reconciles it to the eventual issued/failed.
      // A terminal `issued`/`failed` response is already authoritative, so an
      // unconditional invalidate there would discard the just-seeded value and
      // fire a redundant GET on every successful issue (defeating the seed).
      if (record.status === 'pending') {
        await queryClient.invalidateQueries({
          queryKey: invoicingQueryKeys.forOrder(input.orderId, input.connectionId),
        });
      }
    },
  });
}
