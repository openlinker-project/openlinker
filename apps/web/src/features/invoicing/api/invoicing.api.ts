/**
 * Invoicing API Client (#757, redesign #1240)
 *
 * Thin API module for the invoicing feature, consuming the #1119 HTTP API:
 *   - `GET /orders/:orderId/invoice?connectionId=…`
 *   - `GET /invoices` (paginated list with filters — #758 list page)
 *   - `GET /invoices/:invoiceId` (detail page — W2 #1231)
 *   - `POST /invoices`
 *   - `POST /invoices/retry` (batch retry — W6 #1245)
 *   - `POST /invoices/:invoiceId/correct` (correction — #1241)
 *   - `GET /invoices/:invoiceId/upo` (UPO blob — #1234)
 *   - `GET /invoices/:invoiceId/document?kind=source|rendered` (FA(3) doc — W3 #1231)
 *
 * @module apps/web/src/features/invoicing/api
 */
import type {
  BulkIssueInvoicesInput,
  BulkIssueInvoicesResult,
  InvoiceFilters,
  InvoicePagination,
  InvoiceRecord,
  IssueCorrectionInput,
  IssueInvoiceInput,
  PaginatedInvoices,
  RetryInvoicesInput,
  RetryInvoicesResult,
} from './invoicing.types';

export interface InvoicingApi {
  /** `GET /orders/{orderId}/invoice?connectionId=…` — the single invoice
   *  projection for an order + invoicing connection. 404 when no invoice row
   *  exists (mapped to `not-issued` by the query hook). */
  getForOrder: (orderId: string, connectionId: string) => Promise<InvoiceRecord>;
  /** `GET /invoices/{invoiceId}` — the single invoice by id (detail page, W2
   *  #1231). 404 when no invoice exists at this id. */
  getById: (invoiceId: string) => Promise<InvoiceRecord>;
  /** `GET /invoices` — paginated list with AC-6 filters (#758) + tax-id (#1202). */
  list: (filters?: InvoiceFilters, pagination?: InvoicePagination) => Promise<PaginatedInvoices>;
  /** `POST /invoices` — manual issue (and failed-row retry). */
  issue: (input: IssueInvoiceInput) => Promise<InvoiceRecord>;
  /** `POST /invoices/retry` — batch retry of failed+rejected records (W6 #1245).
   *  The server gates eligibility; non-eligible ids are skipped per-id. */
  retry: (input: RetryInvoicesInput) => Promise<RetryInvoicesResult>;
  /** `POST /invoices/bulk-issue` — issue invoices for a list of order ids on one
   *  connection (#1355). Fans out over the single issue primitive; idempotent
   *  per (connection, order). Returns a per-id summary. */
  bulkIssue: (input: BulkIssueInvoicesInput) => Promise<BulkIssueInvoicesResult>;
  /** `POST /invoices/:invoiceId/correct` — issue a correcting document (#1241). */
  issueCorrection: (invoiceId: string, input: IssueCorrectionInput) => Promise<InvoiceRecord>;
  /**
   * `GET /invoices/:invoiceId/upo` (#1234) — fetch the official UPO confirmation
   * document for a cleared/accepted e-invoice as a Blob. Content type is
   * provider-defined (PDF / XML); the caller derives the kind from `blob.type`.
   * Capability-gated on `RegulatoryDocumentReader` server-side. Neutral: keyed
   * on the internal `invoice.id`, never on platform type (ADR-026).
   */
  downloadUpo: (invoiceId: string) => Promise<Blob>;
  /**
   * `GET /invoices/:invoiceId/document?kind=source|rendered` (W3 #1231) —
   * fetch the issued FA(3) document. `kind=source` returns the original XML;
   * `kind=rendered` returns a human-readable HTML rendering. Returns a Blob;
   * content type is provider-defined.
   */
  downloadDocument: (invoiceId: string, kind: 'source' | 'rendered') => Promise<Blob>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

interface ApiBlobRequest {
  (path: string, init?: RequestInit): Promise<Blob>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** Builds the `GET /invoices` query string — appends only defined params.
 *  Mirrors `webhook-deliveries.api.ts buildQuery`. */
function buildQuery(filters?: InvoiceFilters, pagination?: InvoicePagination): string {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (filters?.regulatoryStatus) params.set('regulatoryStatus', filters.regulatoryStatus);
  if (filters?.taxId) params.set('taxId', filters.taxId);
  if (filters?.issuedFrom) params.set('issuedFrom', filters.issuedFrom);
  if (filters?.issuedTo) params.set('issuedTo', filters.issuedTo);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createInvoicingApi(request: ApiRequest, requestBlob: ApiBlobRequest): InvoicingApi {
  return {
    getForOrder(orderId, connectionId): Promise<InvoiceRecord> {
      const params = new URLSearchParams({ connectionId });
      return request<InvoiceRecord>(
        `/orders/${encodeURIComponent(orderId)}/invoice?${params.toString()}`,
      );
    },
    getById(invoiceId): Promise<InvoiceRecord> {
      return request<InvoiceRecord>(`/invoices/${encodeURIComponent(invoiceId)}`);
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
    retry(input): Promise<RetryInvoicesResult> {
      return request<RetryInvoicesResult>('/invoices/retry', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      });
    },
    bulkIssue(input): Promise<BulkIssueInvoicesResult> {
      return request<BulkIssueInvoicesResult>('/invoices/bulk-issue', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      });
    },
    issueCorrection(invoiceId, input): Promise<InvoiceRecord> {
      return request<InvoiceRecord>(`/invoices/${encodeURIComponent(invoiceId)}/correct`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      });
    },
    downloadUpo(invoiceId): Promise<Blob> {
      return requestBlob(`/invoices/${encodeURIComponent(invoiceId)}/upo`);
    },
    downloadDocument(invoiceId, kind): Promise<Blob> {
      return requestBlob(`/invoices/${encodeURIComponent(invoiceId)}/document?kind=${kind}`);
    },
  };
}
