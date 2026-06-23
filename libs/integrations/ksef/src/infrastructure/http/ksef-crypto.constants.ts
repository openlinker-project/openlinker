/**
 * KSeF Crypto Constants
 *
 * Pins the cryptographic primitives the KSeF 2.0 session/auth crypto layer
 * uses, in one leaf module so the RSA wrapper, the AES cipher, and the token
 * encryptor can't drift on padding/hash parameters (a silent server-side
 * decrypt failure). All values are derived from the KSeF 2.0 specification
 * (RSA-OAEP with MGF1+SHA-256 for key/token wrapping; AES-256-CBC with PKCS#7
 * for document encryption) and are validated by round-trip unit tests against
 * a self-generated key pair until live test vectors land (C4).
 *
 * SECURITY: changing any of these silently breaks interop with the MF backend —
 * a wrapped key the server cannot unwrap is rejected with an opaque 4xx, not a
 * crypto error. Treat them as a wire contract, not a tunable.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */

/**
 * RSA-OAEP hash for both the OAEP digest and the MGF1 mask-generation function.
 * KSeF mandates SHA-256 (not SHA-1). Node's `crypto.publicEncrypt` defaults
 * `mgf1HashAlgorithm` to `oaepHash`, so we pass `oaepHash` explicitly and let
 * MGF1 follow — but we also pin the value here so the intent is documented.
 */
export const KSEF_RSA_OAEP_HASH = 'sha256';

/** AES symmetric cipher: 256-bit key, CBC mode, PKCS#7 padding (Node default). */
export const KSEF_AES_ALGORITHM = 'aes-256-cbc';

/** AES-256 key length in bytes (256 bits). */
export const KSEF_AES_KEY_BYTES = 32;

/** AES-CBC initialization-vector length in bytes (128-bit block per NIST). */
export const KSEF_AES_IV_BYTES = 16;

/**
 * Minimum acceptable RSA modulus size in bits. KSeF MF certificates are
 * RSA-2048+; anything smaller is rejected as a malformed / downgraded key
 * before we trust it to wrap a session secret.
 */
export const KSEF_RSA_MIN_MODULUS_BITS = 2048;
