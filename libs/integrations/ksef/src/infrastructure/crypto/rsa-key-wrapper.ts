/**
 * RSA-OAEP Key Wrapper (KSeF session crypto)
 *
 * Pure functions wrapping Node's `crypto` for RSA-OAEP (MGF1 + SHA-256) key
 * wrapping. KSeF wraps both the ephemeral AES session key (document session)
 * and the (token | timestamp) auth blob under an MF public key. The OAEP hash
 * is pinned to SHA-256 (`KSEF_RSA_OAEP_HASH`); a downgrade to SHA-1 or PKCS#1
 * v1.5 would be silently rejected by the MF backend, so the padding is a wire
 * contract, not a tunable.
 *
 * The public key is supplied as a PEM (certificate or SPKI). `createPublicKey`
 * accepts an X.509 cert PEM and extracts the SPKI automatically. We validate
 * the key is RSA and ≥ `KSEF_RSA_MIN_MODULUS_BITS` before trusting it.
 *
 * SECURITY: never log the plaintext, the wrapped bytes, or the private key.
 * `unwrapKeyWithRsa` exists for round-trip unit coverage only — production
 * never holds the MF private key (the server unwraps).
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { constants, createPublicKey, privateDecrypt, publicEncrypt } from 'crypto';
import type { KeyObject } from 'crypto';
import { KSEF_RSA_MIN_MODULUS_BITS, KSEF_RSA_OAEP_HASH } from '../http/ksef-crypto.constants';
import { KsefSessionCryptoException } from '../../domain/exceptions/ksef-session-crypto.exception';

/**
 * Load + validate an MF RSA public key from a PEM (cert or SPKI). Throws
 * `KsefSessionCryptoException` on a non-RSA or under-sized key so we never wrap
 * a session secret under a downgraded/malformed key.
 */
function loadRsaPublicKey(publicKeyPem: string): KeyObject {
  let keyObject: KeyObject;
  try {
    keyObject = createPublicKey(publicKeyPem);
  } catch (err) {
    throw new KsefSessionCryptoException(
      'Failed to parse MF RSA public key PEM',
      'RSA_BAD_PEM',
      err as Error,
    );
  }
  if (keyObject.asymmetricKeyType !== 'rsa') {
    throw new KsefSessionCryptoException(
      `MF public key is not RSA (got ${keyObject.asymmetricKeyType ?? 'unknown'})`,
      'RSA_WRONG_KEY_TYPE',
    );
  }
  const modulusBits = keyObject.asymmetricKeyDetails?.modulusLength;
  if (modulusBits !== undefined && modulusBits < KSEF_RSA_MIN_MODULUS_BITS) {
    throw new KsefSessionCryptoException(
      `MF RSA key too small: ${modulusBits} bits (min ${KSEF_RSA_MIN_MODULUS_BITS})`,
      'RSA_KEY_TOO_SMALL',
    );
  }
  return keyObject;
}

/**
 * Wrap raw bytes (an AES key, or the auth token blob) under an MF RSA public
 * key using RSA-OAEP / MGF1 / SHA-256.
 */
export function wrapKeyWithRsa(plaintext: Uint8Array, publicKeyPem: string): Uint8Array {
  const key = loadRsaPublicKey(publicKeyPem);
  try {
    return new Uint8Array(
      publicEncrypt(
        { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: KSEF_RSA_OAEP_HASH },
        Buffer.from(plaintext),
      ),
    );
  } catch (err) {
    throw new KsefSessionCryptoException('RSA-OAEP wrap failed', 'RSA_WRAP_FAILED', err as Error);
  }
}

/**
 * Unwrap bytes with an RSA private key (test/round-trip only — production never
 * holds the MF private key). Pins the same OAEP/SHA-256 params as the wrap path.
 */
export function unwrapKeyWithRsa(wrappedKey: Uint8Array, privateKeyPem: string): Uint8Array {
  try {
    return new Uint8Array(
      privateDecrypt(
        {
          key: privateKeyPem,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: KSEF_RSA_OAEP_HASH,
        },
        Buffer.from(wrappedKey),
      ),
    );
  } catch (err) {
    throw new KsefSessionCryptoException(
      'RSA-OAEP unwrap failed',
      'RSA_UNWRAP_FAILED',
      err as Error,
    );
  }
}
