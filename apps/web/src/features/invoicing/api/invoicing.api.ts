/**
 * Invoicing API Client (#757)
 *
 * Thin API module for the invoicing feature, consuming the #1119 HTTP API:
 *   - `GET /orders/:orderId/invoice?connectionId=…`
 *   - `GET /invoices` (paginated list with filters — #758 list page)
 *   - `POST /invoices`
 *
 * `list` (`GET /invoices`) is implemented for the #758 invoices list page.
 *
 * @module apps/web/src/features/invoicing/api
 */
import type {
  InvoiceFilters,
  InvoicePagination,
  InvoiceRecord,
  IssueInvoiceInput,
  PaginatedInvoices,
} from './invoicing.types';

export interface InvoicingApi {
  /** `GET /orders/{orderId}/invoice?connectionId=…` — the single invoice
   *  projection for an order + invoicing connection. 404 when no invoice row
   *  exists (mapped to `not-issued` by the query hook). */
  getForOrder: (orderId: string, connectionId: string) => Promise<InvoiceRecord>;
  /** `GET /invoices` — paginated list with AC-6 filters (#758). */
  list: (filters?: InvoiceFilters, pagination?: InvoicePagination) => Promise<PaginatedInvoices>;
  /** `POST /invoices` — manual issue (and failed-row retry). */
  issue: (input: IssueInvoiceInput) => Promise<InvoiceRecord>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** Builds the `GET /invoices` query string — appends only defined params.
 *  Mirrors `webhook-deliveries.api.ts buildQuery`. */
function buildQuery(filters?: InvoiceFilters, pagination?: InvoicePagination): string {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (filters?.regulatoryStatus) params.set('regulatoryStatus', filters.regulatoryStatus);
  if (filters?.issuedFrom) params.set('issuedFrom', filters.issuedFrom);
  if (filters?.issuedTo) params.set('issuedTo', filters.issuedTo);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createInvoicingApi(request: ApiRequest): InvoicingApi {
  return {
    getForOrder(orderId, connectionId): Promise<InvoiceRecord> {
      const params = new URLSearchParams({ connectionId });
      return request<InvoiceRecord>(
        `/orders/${encodeURIComponent(orderId)}/invoice?${params.toString()}`,
      );
    },
    list(filters, pagination): Promise<PaginatedInvoices> {
      return request<PaginatedInvoices>(`/invoices${buildQuery(filters, pagination)}`);
    },
    issue(input): Promise<InvoiceRecord> {
      return request<InvoiceRecord>('/invoices', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      });
    },
  };
}
