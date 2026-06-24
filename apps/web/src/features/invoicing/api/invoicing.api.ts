/**
 * Invoicing API Client (#757)
 *
 * Thin API module for the invoicing feature, consuming the #1119 HTTP API:
 *   - `GET /orders/:orderId/invoice?connectionId=…`
 *   - `POST /invoices`
 *
 * `list` (`GET /invoices`) is intentionally NOT added — the /invoices list page
 * is #758, out of scope here.
 *
 * @module apps/web/src/features/invoicing/api
 */
import type { InvoiceRecord, IssueInvoiceInput } from './invoicing.types';

export interface InvoicingApi {
  /** `GET /orders/{orderId}/invoice?connectionId=…` — the single invoice
   *  projection for an order + invoicing connection. 404 when no invoice row
   *  exists (mapped to `not-issued` by the query hook). */
  getForOrder: (orderId: string, connectionId: string) => Promise<InvoiceRecord>;
  /** `POST /invoices` — manual issue (and failed-row retry). */
  issue: (input: IssueInvoiceInput) => Promise<InvoiceRecord>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export function createInvoicingApi(request: ApiRequest): InvoicingApi {
  return {
    getForOrder(orderId, connectionId): Promise<InvoiceRecord> {
      const params = new URLSearchParams({ connectionId });
      return request<InvoiceRecord>(
        `/orders/${encodeURIComponent(orderId)}/invoice?${params.toString()}`,
      );
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
