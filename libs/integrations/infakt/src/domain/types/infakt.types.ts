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

/** Infakt invoice kinds. */
export type InfaktInvoiceKind =
  | 'vat'
  | 'corrective'
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
  // Infakt returns monetary fields as "amount currency" strings (e.g. "123.00 PLN"),
  // never plain numbers — confirmed against the v3 vat_invoice schema (#1292 review).
  gross_price: string;
  net_price: string;
  tax_price: string;
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
  print_url: string | null;
  pdf_url: string | null;
}

/** One line item on an Infakt invoice. */
export interface InfaktInvoiceService {
  name: string;
  tax_symbol: string;
  quantity: number;
  unit: string | null;
  // Same "amount currency" string format as InfaktInvoice's top-level totals.
  unit_net_price: string;
  net_price: string;
  tax_price: string;
  gross_price: string;
  correction: boolean | null;
  group: number | null;
}

/** Client (buyer) from GET /clients/{uuid}.json or POST /clients.json */
export interface InfaktClient {
  id: number;
  uuid: string;
  name: string;
  nip: string | null;
  email: string | null;
  city: string | null;
  street: string | null;
  post_code: string | null;
  country: string | null;
}

/** Paginated list response shape. */
export interface InfaktListResponse<T> {
  entities: T[];
  metainfo: {
    total_count: number;
    next: string | null;
    previous: string | null;
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

/** Wire shape for `GET /bank_accounts.json` entries (#1303 follow-up). */
export interface InfaktBankAccount {
  id: number;
  account_number: string;
  bank_name: string;
  /** inFakt's own "set as default account" flag — surfaced live (2026-07-02). */
  default: boolean;
}
