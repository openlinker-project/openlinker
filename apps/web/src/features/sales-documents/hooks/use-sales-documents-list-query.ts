/**
 * useSalesDocumentsListQuery (#3307)
 *
 * Fetches one keyset page of `GET /sales-documents` (#3306). Mirrors
 * `use-invoices-query.ts`'s shape (server state → TanStack Query; filter +
 * pagination state owned by the page via URL search params) with one
 * difference: pagination is `cursor`-keyed rather than `offset`-keyed, so
 * the cache key carries the cursor value itself (see
 * `sales-document-list.query-keys.ts`).
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentListQueryKeys } from '../api/sales-document-list.query-keys';
import type {
  PaginatedSalesDocuments,
  SalesDocumentListFilters,
  SalesDocumentListPagination,
} from '../api/sales-document-list.types';

export function useSalesDocumentsListQuery(
  filters?: SalesDocumentListFilters,
  pagination?: SalesDocumentListPagination,
): UseQueryResult<PaginatedSalesDocuments> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: salesDocumentListQueryKeys.list(filters, pagination?.cursor),
    queryFn: () => apiClient.salesDocumentList.list(filters, pagination),
  });
}
