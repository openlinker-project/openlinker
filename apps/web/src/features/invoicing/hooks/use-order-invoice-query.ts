/**
 * useOrderInvoiceQuery (#757, made connection-agnostic by #2047)
 *
 * Fetches THE invoice projection for an order — one sale has one invoice, so the
 * read is not scoped by connection. Returns `null` for the invoice-absent 404
 * ("not-issued" — plan §1.4) and polls every 5s while the invoice is `pending`
 * or `issuing`.
 *
 * WHY NO `connectionId` (#2047): while this hook took one, the panel had to ask
 * the operator for a connection first, and switching that picker asked "is there
 * an invoice on THIS connection?" of an already-invoiced order. The 404 mapped to
 * `null`, `null` rendered as "not issued" with an Issue button, and one sale could
 * get two fiscal documents. The connection is now read OFF the returned record
 * (`invoice.connectionId`), never chosen before the read.
 *
 * 404→null PRECONDITION (plan §1.4): the GET endpoint returns two distinct
 * 404s — `Order not found` and `No invoice for order`. This hook only ever runs
 * for an order the order-detail page has ALREADY resolved and 404-guarded, so the
 * order-not-found 404 is unreachable here and the only reachable 404 is
 * invoice-absent. Mapping `404 → null` is therefore safe (no message-substring
 * sniffing).
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ApiError } from '../../../shared/api/api-error';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import type { InvoiceRecord } from '../api/invoicing.types';

const INVOICE_POLL_MS = 5000;

export function useOrderInvoiceQuery(orderId: string): UseQueryResult<InvoiceRecord | null> {
  const apiClient = useApiClient();

  return useQuery<InvoiceRecord | null>({
    queryKey: invoicingQueryKeys.forOrder(orderId),
    enabled: Boolean(orderId),
    queryFn: async (): Promise<InvoiceRecord | null> => {
      // 404 → null (invoice-absent "not-issued"); see the 404 precondition in
      // the module docstring. Any other error propagates to the query's error
      // state so the panel can surface a retryable failure (not a false
      // not-issued).
      try {
        return await apiClient.invoicing.getForOrder(orderId);
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
