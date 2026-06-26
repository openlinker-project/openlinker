/**
 * useOrderInvoiceQuery (#757)
 *
 * Fetches the single invoice projection for an order + invoicing connection.
 * Returns `null` for the invoice-absent 404 ("not-issued" — plan §1.4) and
 * polls every 5s while the invoice is `pending`.
 *
 * 404→null PRECONDITION (plan §1.4): the GET endpoint returns two distinct
 * 404s — `Order not found` (controller line 186) and `No invoice for order`
 * (line 198). This hook only ever runs for an order the order-detail page has
 * ALREADY resolved and 404-guarded, so the order-not-found 404 is unreachable
 * here and the only reachable 404 is invoice-absent. Mapping `404 → null` is
 * therefore safe (no message-substring sniffing).
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ApiError } from '../../../shared/api/api-error';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import type { InvoiceRecord } from '../api/invoicing.types';

const INVOICE_POLL_MS = 5000;

export function useOrderInvoiceQuery(
  orderId: string,
  connectionId: string | null,
): UseQueryResult<InvoiceRecord | null> {
  const apiClient = useApiClient();

  return useQuery<InvoiceRecord | null>({
    queryKey: invoicingQueryKeys.forOrder(orderId, connectionId ?? ''),
    enabled: Boolean(orderId && connectionId),
    queryFn: async (): Promise<InvoiceRecord | null> => {
      // 404 → null (invoice-absent "not-issued"); see the 404 precondition in
      // the module docstring. Any other error propagates to the query's error
      // state so the panel can surface a retryable failure (not a false
      // not-issued).
      try {
        return await apiClient.invoicing.getForOrder(orderId, connectionId ?? '');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'pending' || s === 'issuing' ? INVOICE_POLL_MS : false;
    },
  });
}
