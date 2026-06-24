/**
 * useInvoicesQuery (#758)
 *
 * Fetches the paginated `GET /invoices` list for the invoices list page.
 * Mirrors `use-webhook-deliveries-query.ts` (server state → TanStack Query;
 * filter + pagination state owned by the page via URL search params).
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { invoicingQueryKeys } from '../api/invoicing.query-keys';
import type {
  InvoiceFilters,
  InvoicePagination,
  PaginatedInvoices,
} from '../api/invoicing.types';

export function useInvoicesQuery(
  filters?: InvoiceFilters,
  pagination?: InvoicePagination,
): UseQueryResult<PaginatedInvoices> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: invoicingQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.invoicing.list(filters, pagination),
  });
}
