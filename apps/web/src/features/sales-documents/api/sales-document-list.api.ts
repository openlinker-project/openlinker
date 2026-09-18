/**
 * Sales-Document List API Client (#3307)
 *
 * Thin API module for `GET /sales-documents` — the merged, keyset-paginated
 * cross-order list of invoice and fiscal-receipt records (#3306).
 *
 * @module apps/web/src/features/sales-documents/api
 */
import type {
  PaginatedSalesDocuments,
  SalesDocumentListFilters,
  SalesDocumentListPagination,
} from './sales-document-list.types';

export interface SalesDocumentListApi {
  list: (
    filters?: SalesDocumentListFilters,
    pagination?: SalesDocumentListPagination,
  ) => Promise<PaginatedSalesDocuments>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

/** Appends only defined params. Mirrors `invoicing.api.ts buildQuery`. */
function buildQuery(
  filters?: SalesDocumentListFilters,
  pagination?: SalesDocumentListPagination,
): string {
  const params = new URLSearchParams();
  if (filters?.kind) params.set('kind', filters.kind);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (filters?.issuedFrom) params.set('issuedFrom', filters.issuedFrom);
  if (filters?.issuedTo) params.set('issuedTo', filters.issuedTo);
  if (filters?.taxId) params.set('taxId', filters.taxId);
  if (filters?.search) params.set('search', filters.search);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.cursor) params.set('cursor', pagination.cursor);
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createSalesDocumentListApi(request: ApiRequest): SalesDocumentListApi {
  return {
    list(filters, pagination): Promise<PaginatedSalesDocuments> {
      return request<PaginatedSalesDocuments>(`/sales-documents${buildQuery(filters, pagination)}`);
    },
  };
}
