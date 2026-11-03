/**
 * useInvoiceMarketplaceUploadQuery (#3549)
 *
 * Reads where attaching an issued document to its marketplace order stands.
 * While an attempt is still `pending` the query polls, because the upload runs
 * as a background job and the operator otherwise has to reload to see it land.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import type { InvoiceMarketplaceUploadState } from '../api/invoicing.types';

const POLL_WHILE_PENDING_MS = 5_000;

export function useInvoiceMarketplaceUploadQuery(
  invoiceId: string,
  enabled: boolean,
): UseQueryResult<InvoiceMarketplaceUploadState> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: invoicingQueryKeys.marketplaceUpload(invoiceId),
    enabled: enabled && Boolean(invoiceId),
    queryFn: () => apiClient.invoicing.getMarketplaceUpload(invoiceId),
    refetchInterval: (query) =>
      query.state.data?.uploads.some((upload) => upload.status === 'pending')
        ? POLL_WHILE_PENDING_MS
        : false,
  });
}
