/**
 * KSeF Session Crypto Exception
 *
 * Thrown for any failure in the session/auth crypto layer — RSA-OAEP key
 * wrapping, AES-256-CBC encrypt/decrypt, MF public-key fetch/validation, or
 * malformed key material. Distinct from `KsefAuthenticationException` (a live
 * 401/403 auth rejection): a crypto failure is a local primitive failure or a
 * cert-trust problem, surfaced before (or independent of) any auth verdict.
 *
 * SECURITY: this exception MUST NOT carry key bytes, plaintext, or ciphertext.
 * The optional `cause` is the underlying Node crypto error — it may carry an
 * error `code` but never the inputs (Node crypto errors don't echo key/plaintext
 * bytes). Callers log only `message` + `cause.code`, never `cause` verbatim into
 * an external sink that might serialize buffers.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefSessionCryptoException extends Error {
  constructor(
    message: string,
    /** Machine-readable code for the failing operation (e.g. 'RSA_WRAP_FAILED'). */
    public readonly errorCode?: string,
    /** Underlying cause; never serialize verbatim to an external sink. */
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'KsefSessionCryptoException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefSessionCryptoException);
    }
  }
}
