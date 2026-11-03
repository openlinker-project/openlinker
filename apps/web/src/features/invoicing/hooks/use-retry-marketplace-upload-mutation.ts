/**
 * useRetryMarketplaceUploadMutation (#3549)
 *
 * `POST /invoices/:invoiceId/marketplace-upload/retry` (admin only). Queues a new
 * upload job; the status query is invalidated so the row reads fresh.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';

export function useRetryMarketplaceUploadMutation(): UseMutationResult<
  { queued: true },
  Error,
  string
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<{ queued: true }, Error, string>({
    mutationFn: (invoiceId) => apiClient.invoicing.retryMarketplaceUpload(invoiceId),
    onSuccess: async (_result, invoiceId) => {
      await queryClient.invalidateQueries({
        queryKey: invoicingQueryKeys.marketplaceUpload(invoiceId),
      });
    },
  });
}
