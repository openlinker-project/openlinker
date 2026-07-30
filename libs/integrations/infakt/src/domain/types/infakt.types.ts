/**
 * Infakt API v3 wire types (PL-specific shapes).
 *
 * Only the fields OL actually reads are declared; the full Infakt schema is
 * richer. All PL-specific vocabulary (nip, ksef, paragon, etc.) lives here,
 * never in libs/core.
 *
 * @module libs/integrations/infakt/src/domain/types
 */

/** Infakt KSeF status values as returned in `ksef_data.status`. */
export const InfaktKsefStatusValues = [
  'pending',
  'sent',
  'success',
  'error',
] as const;
export type InfaktKsefStatus = (typeof InfaktKsefStatusValues)[number];

/** Partial KSeF data block on an invoice response. */
export interface InfaktKsefData {
  request_uuid: string | null;
  ksef_number: string | null;
  status: InfaktKsefStatus;
  status_description: string | null;
  timestamps: {
    request_created_at: string | null;
    request_finished_at: string | null;
  } | null;
}

/**
 * Infakt invoice kinds. `'correction'` is what POST /corrective_invoices.json
 * returns on its created document (verified live, 2026-07-03); `'corrective'`
 * remains the GET-by-uuid `invoice_type` query vocabulary.
 */
export type InfaktInvoiceKind =
  | 'vat'
  | 'corrective'
  | 'correction'
  | 'advance'
  | 'final'
  | 'internal'
  | 'margin'
  | 'oss'
  | 'corrective_oss'
  | 'proforma';

/** Invoice from GET /invoices/{uuid}.json */
export interface InfaktInvoice {
  uuid: string;
  number: string | null;
  kind: InfaktInvoiceKind;
  status: string;
  // Infakt's public API represents every monetary field as a PLAIN INTEGER
  // count of groszy (1 PLN = 100 grosze) — confirmed both live against the
  // real sandbox (a 349.00 PLN order landed as gross_price=348, i.e. 3.48 PLN,
  // when this adapter previously sent "amount currency" decimal strings) and
  // against the official MCP-exposed API schema (`unit_net_price`/`net_price`/
  // `gross_price` are `integer`, described as "w groszach"). The earlier
  // "amount currency" string assumption (#1292 review) was wrong and caused
  // every issued invoice to understate its legal/KSeF amount ~100x (#1293
  // review, live E2E finding).
  gross_price: number;
  net_price: number;
  tax_price: number;
  payment_method: string;
  invoice_date: string | null;
  sale_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  corrected_invoice_number: string | null;
  correction_reason: string | null;
  correction_reason_symbol: string | null;
  ksef_number: string | null;
  ksef_data: InfaktKsefData | null;
  client_id: number | null;
  client_uuid: string | null;
  services: InfaktInvoiceService[];
}

/** One line item on an Infakt invoice. */
export interface InfaktInvoiceService {
  name: string;
  tax_symbol: string;
  quantity: number;
  unit: string | null;
  // Same plain-integer-groszy format as InfaktInvoice's top-level totals.
  unit_net_price: number;
  net_price: number;
  tax_price: number;
  gross_price: number;
  correction: boolean | null;
  group: number | null;
}

/**
 * Client (buyer) from GET /clients/{uuid}.json or POST /clients.json.
 * Field names verified live against the sandbox response (2026-07-01) —
 * `company_name` / `postal_code`, not `name` / `post_code`.
 */
export interface InfaktClient {
  id: number;
  uuid: string;
  company_name: string;
  nip: string | null;
  email: string | null;
  city: string | null;
  street: string | null;
  postal_code: string | null;
  country: string | null;
}

/** Paginated list response shape (v3 API — verified live 2026-07-07). */
export interface InfaktListResponse<T> {
  items: T[];
  pagination: {
    current_page: number;
    items_on_page: number;
    limit: number;
    total_items: number;
    total_pages: number;
  };
}

/**
 * One "before"/"after" service row on a POST /async/corrective_invoices.json
 * request. Rows come in pairs per `group`: `correction: false` (original
 * values) then `correction: true` (corrected values).
 *
 * `unit_net_price`/`quantity` use the same plain-integer-groszy / numeric
 * shape as `async/invoices.json` (see toGroszy/fromGroszy) — #1763 replaced
 * an earlier decimal "amount currency" STRING assumption (e.g. `"811.37 PLN"`)
 * that was only ever tested against the bare `corrective_invoices.json` path,
 * which turned out to 500 on every payload regardless of shape (the root
 * #1763 bug).
 *
 * Live-verified on the `async/` path (2026-07-29): a `-100.00 PLN` correction
 * of a `499.99` gross line round-tripped as `before {quantity: 1,
 * unit_net_price: 40650}` / `after {quantity: 1, unit_net_price: 32520}`, and
 * the `before` row matched the original invoice's stored line to the groszy.
 */
export interface InfaktCorrectiveInvoiceServiceRequest {
  name: string;
  tax_symbol: string;
  quantity: number;
  unit: string;
  unit_net_price: number;
  group: string;
  correction: boolean;
}

/**
 * Body of a `POST /async/corrective_invoices.json` request, under its
 * `corrective_invoice` wrapper key (#1763).
 *
 * `correction_reason` is the WRITABLE reason field and takes a value from
 * Infakt's closed reason-code vocabulary, NOT free text ("Zapis: symbol
 * powodu; odczyt: polska nazwa"). The read-only `correction_reason_symbol`
 * is deliberately absent — Infakt sets it server-side and rejects it here.
 */
export interface InfaktCorrectiveInvoiceRequest {
  corrective_invoice: {
    payment_method: string;
    client_id: number | null;
    bank_account?: string;
    bank_name?: string;
    corrected_invoice_number: string | null;
    corrected_invoice_date: string;
    corrected_invoice_uuid: string;
    correction_reason: string;
    services: InfaktCorrectiveInvoiceServiceRequest[];
    external_id?: string;
  };
}

/** Response from POST /invoices/{uuid}/send_to_ksef.json */
export interface InfaktSendToKsefResponse {
  request_uuid: string;
  invoice_uuid: string;
  invoice_kind: string;
  ksef_number: string | null;
  status: InfaktKsefStatus;
  status_description: string | null;
  timestamps: {
    request_created_at: string | null;
    request_finished_at: string | null;
  };
}

/**
 * Task-accepted envelope returned by inFakt's `async/*.json` creation
 * endpoints (e.g. `POST async/invoices.json`, `POST async/corrective_invoices.json`)
 * — confirmed against inFakt's own published API reference. `processing_code:
 * 100` means "accepted, still processing"; the terminal outcome is only known
 * via `GET async/{resource}/status/{invoice_task_reference_number}.json`.
 */
export interface InfaktAsyncTaskAccepted {
  invoice_task_reference_number: string;
  processing_code: number;
  processing_description: string;
  timestamps: {
    task_created_at: string;
  };
  /**
   * Present on the TERMINAL status response once the task resolves — verified
   * live (2026-07-28) for a corrective-invoice task: `processing_code: 201`,
   * `processing_description: "Faktura stworzona"`, `action: "create_invoice"`,
   * `invoice_kind: "corrective_invoice"`, `invoice_uuid: "<uuid>"`. Absent
   * while still processing (`processing_code: 100`).
   */
  action?: string;
  invoice_kind?: string;
  invoice_uuid?: string;
}

/** Wire shape for `GET /bank_accounts.json` entries (#1303 follow-up). */
export interface InfaktBankAccount {
  id: number;
  account_number: string;
  bank_name: string;
  /** inFakt's own "set as default account" flag — surfaced live (2026-07-02). */
  default: boolean;
}
