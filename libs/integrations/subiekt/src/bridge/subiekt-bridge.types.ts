/**
 * Subiekt Bridge — wire types (RECONCILED to the REAL bridge HTTP DTO, #753)
 *
 * Request/response shapes for the OpenLinker Subiekt Bridge REST surface — the
 * Windows .NET service that wraps InsERT's Sfera SDK (#728 §3.1). These are
 * **bridge-native** (Subiekt/PL dialect: Polish field names, `FV`/`PA` document
 * types, `nip`, KSeF regulatory states) — the neutral ⇄ bridge mapping lives in
 * the real adapter (#753), NOT here.
 *
 * IMPORTANT (reconciliation): these shapes were realigned to the bridge's actual
 * .NET Contracts (`CreateFirmaRequestDto`/`CreateInvoiceRequestDto`/`BuyerDto`/
 * `AddressDto` + the `ResponseEnvelope<T>` wrapper) after a live wire-test proved
 * the previous `#754` shapes (wrapped `buyer`, English line/address fields,
 * `faktura`/`paragon`) were rejected by the bridge with HTTP 400. The authoritative
 * source is the bridge repo:
 *   bridge/Subiekt.Bridge.Api/Models/ResponseEnvelope.cs (the DTOs)
 *   bridge/Subiekt.Bridge.Api/Contracts/{InvoiceContracts,UpsertCustomerContracts}.cs
 *   bridge/Subiekt.Bridge.Api/Endpoints/{Invoices,Customers}Endpoints.cs (the envelope + response data)
 *
 * The bridge wraps EVERY response in `{ success, data, error }`; the `Bridge*Response`
 * types below model the `data` payload (the HTTP client unwraps the envelope).
 *
 * @module libs/integrations/subiekt/bridge
 */

/**
 * KSeF-native regulatory status the bridge reports for a document (the
 * `data.regulatoryStatus`/`data.ksef.status` field). The neutral
 * `RegulatoryStatus` (`@openlinker/core/invoicing`) is derived from this by the
 * #753 adapter — it is not referenced here. Observed live values: `none` (PA),
 * `pending` (FV pre-KSeF); the rest are the documented KSeF lifecycle.
 */
export const BridgeRegulatoryStatusValues = [
  'none',
  'pending',
  'sent',
  'accepted',
  'rejected',
] as const;
export type BridgeRegulatoryStatus = (typeof BridgeRegulatoryStatusValues)[number];

/** Bridge-side issuance result state (`data.state`). */
export const BridgeInvoiceStateValues = ['issued', 'failed'] as const;
export type BridgeInvoiceState = (typeof BridgeInvoiceStateValues)[number];

/**
 * Bridge-native document type. `FV` = faktura, `PA` = paragon. The correction
 * document (faktura korygująca) is NOT a `documentType` value on the wire — the
 * correction endpoint (`POST /api/invoices/{origId}/corrections`) is identified by
 * its route + body shape (`BridgeKorektaRequest`), not by a doctype discriminator.
 */
export const BridgeDocumentTypeValues = ['FV', 'PA'] as const;
export type BridgeDocumentType = (typeof BridgeDocumentTypeValues)[number];

/**
 * Postal address as the bridge expects it (Subiekt `AdresPodstawowy`). Polish
 * field names, mapped 1:1 onto the bridge's `AddressDto`. All parts are optional
 * on the wire; `countryCode` defaults to `"PL"` server-side when blank.
 */
export interface BridgeAddress {
  ulica?: string;
  nrDomu?: string;
  nrLokalu?: string | null;
  kodPocztowy?: string;
  miejscowosc?: string;
  poczta?: string | null;
  countryCode: string;
}

/**
 * Inline buyer (kontrahent) on an issue-invoice request — the bridge's `BuyerDto`.
 * When `nip` is present (or `isCompany` is true) the bridge treats the buyer as a
 * `firma`. `nip` is provider-native (a bare PL NIP), `null` for B2C.
 */
export interface BridgeBuyer {
  name: string;
  nip: string | null;
  isCompany: boolean;
  telefon?: string;
  address?: BridgeAddress;
}

/**
 * One invoice line — the bridge's `CreateInvoiceLineRequestDto`. A line references
 * a catalogue product by `towarSymbol`, OR carries a one-time `name` (product not
 * in Subiekt's catalogue); at least one of the two must be present. `ilosc` is the
 * quantity, `cenaBrutto` the gross unit price, `stawkaVAT` the VAT-rate code (e.g.
 * `"23"`).
 */
export interface BridgeLine {
  towarSymbol?: string;
  ilosc: number;
  cenaBrutto: number;
  stawkaVAT: string;
  name?: string;
}

/**
 * Issue-invoice request — the bridge's `CreateInvoiceRequestDto`.
 *
 * `documentType` is `"FV"` (faktura) or `"PA"` (paragon). The buyer is carried
 * INLINE: when `kontrahentId` is absent/<=0 and `buyer.name` is present, the
 * bridge auto-upserts the buyer and bills it in one unit of work (self-sufficient
 * mode). `idempotencyKey` makes a retried call return the SAME document.
 */
export interface BridgeIssueInvoiceRequest {
  documentType: BridgeDocumentType;
  currency: string;
  orderId?: string;
  idempotencyKey?: string;
  /** ISO-8601 issue date; the bridge defaults to "now" when omitted. */
  issueDate?: string;
  /** Explicit existing customer id; omit (or <=0) to use the inline `buyer`. */
  kontrahentId?: number;
  buyer?: BridgeBuyer;
  lines: BridgeLine[];
}

/**
 * Issue-invoice response — the `data` payload of the bridge's `ResponseEnvelope`.
 * `providerInvoiceId` is a numeric Subiekt document id (the bridge returns it as a
 * JSON number); the adapter stringifies it for the neutral `InvoiceRecord`.
 */
export interface BridgeIssueInvoiceResponse {
  providerInvoiceId: number;
  providerInvoiceNumber: string;
  state: BridgeInvoiceState;
  regulatoryStatus: BridgeRegulatoryStatus;
  pdfUrl: string | null;
}

/**
 * One corrected line on a correction request — the bridge's korekta line shape.
 * `lp` is the 1-based position of the original line being corrected; `nowaIlosc`
 * is the new quantity, `nowaCena` the new GROSS unit price. At least one of
 * `nowaIlosc`/`nowaCena` must be present (a line that changes neither is a no-op).
 */
export interface BridgeKorektaLine {
  lp: number;
  nowaIlosc?: number;
  nowaCena?: number;
}

/**
 * Issue-CORRECTION (faktura korygująca) request body — the REAL bridge contract:
 * `POST /api/invoices/{origId}/corrections`. The corrected original is identified
 * by the `{origId}` path segment (a positive integer), NOT in the body. The body
 * carries an optional free-text `przyczyna` (correction reason), an optional
 * `idempotencyKey` (so a retried correction returns the SAME document instead of
 * issuing a duplicate korekta — the bridge honours it in lockstep, #1229), and
 * the `lines` to correct.
 */
export interface BridgeKorektaRequest {
  /** Free-text correction reason (`przyczyna korekty`). */
  przyczyna?: string;
  /** Makes a retried correction return the SAME document (fiscal dedup). */
  idempotencyKey?: string;
  lines: BridgeKorektaLine[];
}

/**
 * Issue-CORRECTION response — the `data` payload of the bridge's `ResponseEnvelope`
 * for `POST /api/invoices/{origId}/corrections`. Distinct from the issue-invoice
 * response: it carries `korygowanyId` (the corrected original's numeric id) and a
 * nullable `przyczyna`, and it carries NEITHER a `regulatoryStatus` NOR a `pdfUrl`
 * (a correction's KSeF status is read back later via the status endpoint).
 */
export interface BridgeKorektaResponse {
  providerInvoiceId: number;
  providerInvoiceNumber: string;
  korygowanyId: number;
  przyczyna: string | null;
  state: BridgeInvoiceState;
}

/**
 * Customer (kontrahent) upsert request — the bridge's `CreateFirmaRequestDto`.
 * TOP-LEVEL (NOT wrapped in a `buyer`). `typ` is `"firma"` | `"osoba"`.
 */
export interface BridgeUpsertCustomerRequest {
  nazwaSkrocona: string;
  nip: string | null;
  typ: 'firma' | 'osoba';
  telefon?: string;
  address?: BridgeAddress;
}

/**
 * Customer upsert response — the `data` payload of the bridge's `ResponseEnvelope`
 * (`{ id, numer, nazwaSkrocona, nip }`). `id` is the numeric Subiekt customer id;
 * the adapter stringifies it into `providerCustomerId`.
 */
export interface BridgeUpsertCustomerResponse {
  id: number;
  numer: string;
  nazwaSkrocona: string;
  nip: string | null;
}

/** Status-read request, keyed by the provider's invoice id. */
export interface BridgeInvoiceStatusRequest {
  providerInvoiceId: string;
}

/**
 * Status-read response — derived from the `data` payload of
 * `GET /api/invoices/{id}/status`. The bridge's status payload carries the KSeF
 * `regulatoryStatus` and a Polish document `status` (e.g. `"zatwierdzony"`) but no
 * `state` field; the HTTP client derives `state: 'issued'` for a document that
 * reads back, `'failed'` otherwise.
 */
export interface BridgeInvoiceStatusResponse {
  state: BridgeInvoiceState;
  regulatoryStatus: BridgeRegulatoryStatus;
}

/**
 * The bridge's uniform response envelope. EVERY endpoint returns this shape; the
 * HTTP client reads `data` on success and `error.reason` on a business failure.
 */
export interface BridgeResponseEnvelope<T> {
  success: boolean;
  data: T | null;
  error: BridgeEnvelopeError | null;
}

/** Structured error inside a non-success `BridgeResponseEnvelope`. */
export interface BridgeEnvelopeError {
  code: string;
  reason: string;
  correlationId: string | null;
}
