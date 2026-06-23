/**
 * KSeF Session Crypto Types
 *
 * Shapes for the KSeF 2.0 session-crypto layer: the ephemeral symmetric key,
 * the RSA-wrapped key submitted to MF, the encrypted document envelope, and the
 * MF public-key certificate fetched from `GET /security/public-key-certificates`.
 * Adapter-internal (ADR-026).
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */

/**
 * Intended usage of an MF public-key certificate. KSeF serves distinct certs
 * for token encryption (auth handshake) vs symmetric-key wrapping (document
 * session). Selecting the wrong one is a key-confusion risk, so the usage is a
 * required filter on every fetch.
 */
export const KsefCertificateUsageValues = ['KsefTokenEncryption', 'SymmetricKeyEncryption'] as const;
export type KsefCertificateUsage = (typeof KsefCertificateUsageValues)[number];

/**
 * An MF public-key certificate with its validity window. `certificatePem` is
 * the PEM the RSA wrapper loads; `certificateHash` (SHA-256 of the PEM) is
 * stamped onto wrapped keys so the server can identify which cert was used.
 */
export interface PublicKeyCertificate {
  certificatePem: string;
  usage: KsefCertificateUsage;
  validFrom: Date;
  validUntil: Date;
  certificateHash: string;
}

/**
 * Ephemeral AES-256 symmetric key + IV generated per document-transmission
 * session via `crypto.randomBytes`. Held in memory only for the session
 * lifetime; never persisted.
 *
 * SECURITY: `key` and `iv` bytes must never be logged.
 */
export interface SymmetricKey {
  key: Uint8Array;
  iv: Uint8Array;
}

/**
 * An AES key wrapped under an MF RSA public key (RSA-OAEP, SHA-256). Submitted
 * to MF to bootstrap the encrypted session. `certificateHash` identifies the
 * wrapping cert so the server can unwrap and (on rotation) audit.
 */
export interface RsaWrappedKey {
  wrappedKey: Uint8Array;
  certificateHash: string;
}

/**
 * AES-256-CBC-encrypted document payload. `iv` accompanies the ciphertext
 * because each session uses its own random IV (CBC IV-reuse is unsafe).
 */
export interface EncryptedDocument {
  /** Always `aes-256-cbc` (see `KSEF_AES_ALGORITHM`); carried for self-describing payloads. */
  algorithm: 'aes-256-cbc';
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

/**
 * The full session-crypto context an issuance flow holds while encrypting one
 * or more documents in a batch. Combines the symmetric key, its RSA-wrapped
 * form, and an `expiresAt` (min of a self-imposed session TTL and the wrapping
 * cert's `validUntil`) so the caller can proactively re-initialize before stale.
 *
 * SECURITY: `symmetricKey` carries raw key bytes — never log this object.
 */
export interface SessionCryptoContext {
  symmetricKey: SymmetricKey;
  wrappedKey: RsaWrappedKey;
  expiresAt: Date;
}
