/**
 * KSeF Online-Session Wire Types
 *
 * Request/response shapes for the KSeF 2.0 online-session document flow
 * (`/sessions/online`, `.../invoices`, `.../close`, `.../status`). Adapter-
 * internal (ADR-026) — these KSeF specifics never cross back into the neutral
 * `@openlinker/core/invoicing` surface; the adapter maps them onto the neutral
 * `InvoiceRecord`/`RegulatoryStatus` at the boundary.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */

/**
 * KSeF session status `445` — "session closed with zero valid invoices". The
 * one terminal-failure status the issuance flow must distinguish from a success
 * (the document was submitted but KSeF rejected it, so no invoice was issued).
 */
export const KSEF_SESSION_CLOSED_ZERO_VALID = 445;

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
}

/** Response from the invoice-submit POST — the per-invoice reference. */
export interface SendInvoiceResponse {
  referenceNumber: string;
}

/**
 * Response from `GET /sessions/online/{referenceNumber}` (status read). `status.code`
 * is the KSeF-native session status; `445` is the zero-valid-invoices terminal
 * failure. The KSeF number is assigned asynchronously and is NOT present at
 * submit time — clearance is reconciled later (#1150 / C6).
 */
export interface OnlineSessionStatusResponse {
  status: {
    code: number;
    description?: string;
  };
}

/* ─────────────────── #1150 / C6: clearance status-read + UPO ─────────────────── */

/**
 * KSeF session status codes the clearance reader maps onto the neutral CTC
 * `RegulatoryStatus` lifecycle (#1150 / C6). KSeF 2.0 reuses the same numeric
 * status family for the online session and for a per-invoice status read:
 *
 *  - `100` accepted / processing started, `150` in-progress → not terminal.
 *  - `200` success → the document cleared and the KSeF number was assigned.
 *  - `210` session expired, `410` gone / no longer available, `445` closed with
 *    zero valid invoices → terminal failures (the document was NOT issued).
 *
 * PROVISIONAL: `150`/`210`/`410` are a best-reading of the KSeF 2.0 status
 * family (only `200`/`445` are exercised by the C5 issuance flow). Reconcile
 * against live KSeF docs — same posture as C4/C5.
 */
export const KSEF_STATUS_PROCESSING_STARTED = 100;
export const KSEF_STATUS_IN_PROGRESS = 150;
export const KSEF_STATUS_SUCCESS = 200;
export const KSEF_STATUS_SESSION_EXPIRED = 210;
export const KSEF_STATUS_GONE = 410;
// `445` (zero valid invoices) is exported as KSEF_SESSION_CLOSED_ZERO_VALID above.

/**
 * Response from the per-invoice status read
 * (`GET /sessions/online/{sessionRef}/invoices/{invoiceRef}`). On success
 * (`status.code === 200`) KSeF has assigned the 35-char KSeF number
 * (`{NIP}-{RRRRMMDD}-{6}-{6}-{CC}`) and exposes a UPO document reference.
 *
 * PROVISIONAL field names (`ksefReferenceNumber`, `upo.referenceNumber` /
 * `upo.downloadUrl`) — best-reading of KSeF 2.0; reconcile against live docs.
 */
export interface InvoiceStatusResponse {
  status: {
    code: number;
    description?: string;
  };
  /** The assigned 35-char KSeF number, present once `status.code === 200`. */
  ksefReferenceNumber?: string;
  /** Official Confirmation of Receipt (UPO) pointer, present once cleared. */
  upo?: {
    referenceNumber?: string;
    downloadUrl?: string;
  };
}

/**
 * Pattern the assigned KSeF number must match: `{NIP}-{RRRRMMDD}-{6 hex}-{6 hex}-{2 hex}`
 * (35 chars incl. separators). Used to validate the captured `clearanceReference`
 * before it crosses back into the neutral outcome.
 */
export const KSEF_NUMBER_PATTERN = /^\d{10}-\d{8}-[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{2}$/i;
