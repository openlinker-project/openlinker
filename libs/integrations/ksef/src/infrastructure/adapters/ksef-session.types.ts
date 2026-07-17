/**
 * KSeF Online-Session Wire Types
 *
 * Request/response shapes for the KSeF 2.0 online-session document flow
 * (`/sessions/online`, `.../invoices`, `.../close`, `.../status`). Adapter-
 * internal (ADR-026) — these KSeF specifics never cross back into the neutral
 * `@openlinker/core/invoicing` surface; the adapter maps them onto the neutral
 * `InvoiceRecord`/`RegulatoryStatus` at the boundary.
 *
 * Field names + status codes are reconciled against the authoritative KSeF API
 * v2 OpenAPI (api-test.ksef.mf.gov.pl) and the official CIRFMF C# client/tests.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */

/**
 * Body for `POST /sessions/online`. Bootstraps an encrypted session: the
 * RSA-wrapped AES key + the session IV (both base64). `formCode` pins the FA(3)
 * schema identity (system/schema version) the documents in this session use.
 */
export interface OpenOnlineSessionRequest {
  formCode: {
    systemCode: string;
    schemaVersion: string;
    value: string;
  };
  encryption: {
    encryptedSymmetricKey: string;
    initializationVector: string;
  };
}

/** Response from `POST /sessions/online` — the session reference. */
export interface OpenOnlineSessionResponse {
  referenceNumber: string;
}

/**
 * Body for `POST /sessions/online/{referenceNumber}/invoices`. Carries the
 * AES-encrypted FA(3) bytes (base64) plus the two integrity hashes KSeF
 * verifies: `invoiceHash` over the plaintext FA(3), `encryptedInvoiceHash` over
 * the ciphertext. Both base64-encoded SHA-256.
 */
export interface SendInvoiceRequest {
  invoiceHash: string;
  invoiceSize: number;
  encryptedInvoiceHash: string;
  encryptedInvoiceSize: number;
  encryptedInvoiceContent: string;
  /**
   * SHA-256 (base64) of the corrected invoice. Per the KSeF v2 spec this is
   * "wymagany przy wysyłaniu korekty technicznej faktury" — required only for a
   * *technical* correction (re-submitting a fixed copy of the same document),
   * NOT for a regular accounting correction (`faktura korygująca`, RodzajFaktury
   * `KOR`). The regular KOR flow (#1151) links to the original entirely in the
   * FA(3) body via `DaneFaKorygowanej` (`NrKSeF`/`NrKSeFN`) and leaves this
   * unset. The field is exposed for a future technical-correction flow.
   */
  hashOfCorrectedInvoice?: string;
}

/** Response from the invoice-submit POST — the per-invoice reference. */
export interface SendInvoiceResponse {
  referenceNumber: string;
}

/**
 * Response from the session status read `GET /sessions/{referenceNumber}`
 * (`SessionStatusResponse`). `status.code` is the KSeF-native session status;
 * `200` means the session was processed. The integer counts let the issuance
 * flow distinguish a real success from a "processed but nothing cleared"
 * terminal failure (`successfulInvoiceCount === 0`) — the count-based gate
 * supersedes the older `445` magic-code check. The KSeF number is assigned
 * asynchronously and is NOT present at submit time — clearance is reconciled
 * later (#1150 / C6).
 */
export interface OnlineSessionStatusResponse {
  status: {
    code: number;
    description?: string;
    details?: string[];
    extensions?: Record<string, string>;
  };
  invoiceCount?: number;
  successfulInvoiceCount?: number;
  failedInvoiceCount?: number;
}

/* ─────────────────── #1150 / C6: clearance status-read + UPO ─────────────────── */

/**
 * KSeF processing-status codes the clearance reader maps onto the neutral CTC
 * `RegulatoryStatus` lifecycle (#1150 / C6). These are processing codes in the
 * status BODY, not HTTP status codes — the mapper matches each explicitly
 * (`ksef-clearance-status.mapper.ts`) rather than HTTP-range banding.
 *
 *  - `100` request accepted for processing, `150` in progress
 *    → non-terminal `submitted` (keep polling).
 *  - `200` Success → the document cleared and the KSeF number was assigned.
 *  - `400`/`440` validation/business rejection, `445` session closed with zero
 *    valid invoices, `450` document semantic-validation failure → terminal
 *    `rejected`.
 *  - `550` processing error → transient (the reconciliation job retries).
 *
 * Provenance: `100`/`200` are confirmed from the KSeF v2 OpenAPI; `150`/`440`/
 * `445`/`550` are from the CIRFMF status catalogue; `450` (semantic validation
 * failed — the document is rejected, no KSeF number/UPO is assigned) was
 * observed live on the KSeF test env (2026-07-03, lowercase `KodKraju`) and
 * matches the CIRFMF catalogue. Unknown codes are handled by the mapper's
 * keep-polling default — not enumerated here.
 */
export const KSEF_STATUS_PROCESSING_STARTED = 100;
export const KSEF_STATUS_IN_PROGRESS = 150;
export const KSEF_STATUS_SUCCESS = 200;
export const KSEF_STATUS_REJECTED = 400;
/** FA(3) XSD secondary schema validation in progress — non-terminal, keep polling. */
export const KSEF_STATUS_FA3_PROCESSING = 430;
export const KSEF_STATUS_BUSINESS_REJECTED = 440;
export const KSEF_SESSION_CLOSED_ZERO_VALID = 445;
/** Document failed semantic validation — terminal rejection (no KSeF number/UPO). */
export const KSEF_STATUS_SEMANTIC_REJECTED = 450;
export const KSEF_STATUS_PROCESSING_ERROR = 550;

/**
 * Response from the per-invoice status read
 * (`GET /sessions/{sessionReferenceNumber}/invoices/{invoiceReferenceNumber}` →
 * `SessionInvoiceStatusResponse`). On success (`status.code === 200`) KSeF has
 * assigned the KSeF number (`ksefNumber`) and exposes a ready-to-use UPO
 * download URL (`upoDownloadUrl`).
 */
export interface InvoiceStatusResponse {
  status: {
    code: number;
    description?: string;
    details?: string[];
    extensions?: Record<string, string>;
  };
  /** The assigned KSeF number, present once `status.code === 200`. */
  ksefNumber?: string;
  /** Ready-to-use UPO (Official Confirmation of Receipt) download URL, present once accepted. */
  upoDownloadUrl?: string;
}

/**
 * Pattern the assigned KSeF number must match, per the KSeF API v2 spec — exactly
 * 35 chars: `{NIP}-{RRRRMMDD}-{12 hex}-{2 hex}`. The hex groups are uppercase-only
 * (`[0-9A-F]`) — intentionally NOT case-insensitive.
 */
export const KSEF_NUMBER_PATTERN =
  /^([1-9](\d[1-9]|[1-9]\d)\d{7})-(20[2-9][0-9]|2[1-9]\d{2}|[3-9]\d{3})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])-([0-9A-F]{12})-([0-9A-F]{2})$/;

/* ─────────────── #1701: last-resort invoice-metadata query (crash recovery) ─────────────── */

/**
 * Body for the invoice-metadata query (`POST /invoices/query/metadata`) — the
 * last-resort crash-recovery lookup (#1701): after a process died mid-submit,
 * OL cannot know from its own state whether KSeF received the document, so it
 * queries the authority by seller NIP + issue-date window + document number.
 *
 * BEST-EFFORT WIRE SHAPE: the KSeF v2 OpenAPI documents an invoice-metadata
 * query surface, but the exact JSON field names for the seller-NIP + issue-date
 * range + document-number filter are not pinned in-repo, so this is a
 * conservative, clearly-typed approximation. This path is reached ONLY after a
 * crash; a wire-shape mismatch degrades to "not found" (the caller re-issues) —
 * it can never yield a wrong-positive, so the fiscal risk of the approximation
 * is one avoidable re-issue, never a lost or duplicated cleared document.
 */
export interface InvoiceMetadataQueryRequest {
  /** `subject1` = documents where the queried NIP is the SELLER (Podmiot1). */
  subjectType?: string;
  /** Seller NIP the documents were issued under (the OL-side seller identity). */
  sellerNip?: string;
  /** Human document number (FA(3) `P_2`) to narrow to a single document. */
  invoiceNumber?: string;
  /** ISO-8601 issue-date window (inclusive) the document was issued within. */
  dateRange?: {
    from?: string;
    to?: string;
  };
}

/** One item in the invoice-metadata query result. */
export interface InvoiceMetadataItem {
  /** The authority-assigned KSeF number, present once the document has cleared. */
  ksefNumber?: string;
  /** The human document number (FA(3) `P_2`) the document was issued with. */
  invoiceNumber?: string;
  /** ISO-8601 issue date the authority holds for the document. */
  issueDate?: string;
}

/** Response envelope from `POST /invoices/query/metadata`. */
export interface InvoiceMetadataQueryResponse {
  invoices?: InvoiceMetadataItem[];
}
