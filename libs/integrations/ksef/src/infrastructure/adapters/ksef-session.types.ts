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
