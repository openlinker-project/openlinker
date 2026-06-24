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
 * terminal failure (`successfulInvoiceCount === 0`). The KSeF number is assigned
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
 * KSeF status codes the clearance reader maps onto the neutral CTC
 * `RegulatoryStatus` lifecycle (#1150 / C6), confirmed from the official CIRFMF
 * C# client/tests:
 *
 *  - `100` processing started, `150` in-progress ("w trakcie przetwarzania")
 *    → non-terminal `submitted` (keep polling).
 *  - `200` Success → the document cleared and the KSeF number was assigned.
 *  - any other deterministic business code (e.g. `400`) → terminal rejection.
 *  - `5xx` → transient (the reconciliation job retries).
 *
 * The mapper is range-aware (`100<=code<200`, `===200`, `5xx`, else rejected),
 * so no per-code rejection constant is needed.
 */
export const KSEF_STATUS_PROCESSING_STARTED = 100;
export const KSEF_STATUS_IN_PROGRESS = 150;
export const KSEF_STATUS_SUCCESS = 200;

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
 * Pattern the assigned KSeF number must match, per the authoritative KSeF API v2
 * OpenAPI (min 35 / max 36 chars): `{NIP}-{RRRRMMDD}-{6 hex}-{6 hex}-{2 hex}`,
 * with an optional `-` between the two 6-hex groups for 1.0 back-compat. The hex
 * groups are uppercase-only (`[0-9A-F]`) — intentionally NOT case-insensitive.
 */
export const KSEF_NUMBER_PATTERN =
  /^([1-9](\d[1-9]|[1-9]\d)\d{7})-(20[2-9][0-9]|2[1-9]\d{2}|[3-9]\d{3})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])-([0-9A-F]{6})-?([0-9A-F]{6})-([0-9A-F]{2})$/;
