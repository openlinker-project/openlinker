/**
 * useInvoiceQuery (#1240 — A2 detail page)
 *
 * Fetches a single invoice by id for the detail page (`GET /invoices/:invoiceId`,
 * W2 #1231). A 404 surfaces as the query's error so the page can render its
 * not-found state (distinct from the order-scoped query, where 404 = absent).
 * Polls every 5s while the invoice is in a non-terminal state (`pending` /
 * `issuing`) so the detail page reflects clearance progress without a manual
 * refresh.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import type { InvoiceRecord } from '../api/invoicing.types';

const INVOICE_POLL_MS = 5000;

export function useInvoiceQuery(invoiceId: string): UseQueryResult<InvoiceRecord> {
  const apiClient = useApiClient();

  return useQuery<InvoiceRecord>({
    queryKey: invoicingQueryKeys.detail(invoiceId),
    enabled: Boolean(invoiceId),
    queryFn: () => apiClient.invoicing.getById(invoiceId),
    // Poll while non-terminal (pending awaiting clearance, or issuing holding a
    // live lease). Terminal rows (issued / failed) don't poll.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' || status === 'issuing' ? INVOICE_POLL_MS : false;
    },
  });
}
