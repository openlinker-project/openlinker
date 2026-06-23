/**
 * AES-256-CBC Cipher (KSeF session crypto)
 *
 * Pure functions wrapping Node's `crypto` for AES-256-CBC document encryption.
 * Node applies PKCS#7 padding automatically on `createCipheriv` and strips it
 * on `createDecipheriv`, so no manual padding is done here (manual padding is a
 * classic off-by-one source). Key + IV are caller-supplied (generated via
 * `crypto.randomBytes` in `KsefSessionCryptoService`) — these helpers never
 * generate or cache key material.
 *
 * SECURITY: never log the key, IV, plaintext, or ciphertext. Crypto failures
 * are wrapped in `KsefSessionCryptoException` so the raw Node error (which may
 * carry an arg name, never the bytes) doesn't leak past the boundary.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { createCipheriv, createDecipheriv } from 'crypto';
import {
  KSEF_AES_ALGORITHM,
  KSEF_AES_IV_BYTES,
  KSEF_AES_KEY_BYTES,
} from '../http/ksef-crypto.constants';
import { KsefSessionCryptoException } from '../../domain/exceptions/ksef-session-crypto.exception';

function assertKeyAndIv(key: Uint8Array, iv: Uint8Array): void {
  if (key.byteLength !== KSEF_AES_KEY_BYTES) {
    throw new KsefSessionCryptoException(
      `AES key must be ${KSEF_AES_KEY_BYTES} bytes (got ${key.byteLength})`,
      'AES_BAD_KEY_LENGTH',
    );
  }
  if (iv.byteLength !== KSEF_AES_IV_BYTES) {
    throw new KsefSessionCryptoException(
      `AES IV must be ${KSEF_AES_IV_BYTES} bytes (got ${iv.byteLength})`,
      'AES_BAD_IV_LENGTH',
    );
  }
}

/**
 * Encrypt a UTF-8 plaintext with AES-256-CBC/PKCS#7. Returns ciphertext bytes;
 * the caller transmits the accompanying IV separately (CBC IV-reuse is unsafe).
 */
export function encryptAesCbc(plaintext: string, key: Uint8Array, iv: Uint8Array): Uint8Array {
  assertKeyAndIv(key, iv);
  try {
    const cipher = createCipheriv(KSEF_AES_ALGORITHM, key, iv);
    return new Uint8Array(Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]));
  } catch (err) {
    throw new KsefSessionCryptoException('AES encrypt failed', 'AES_ENCRYPT_FAILED', err as Error);
  }
}

/**
 * Decrypt AES-256-CBC/PKCS#7 ciphertext back to a UTF-8 string. A corrupted
 * ciphertext / wrong key surfaces as a padding error from Node, wrapped here so
 * the raw error type never leaks.
 */
export function decryptAesCbc(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array): string {
  assertKeyAndIv(key, iv);
  try {
    const decipher = createDecipheriv(KSEF_AES_ALGORITHM, key, iv);
    return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]).toString(
      'utf8',
    );
  } catch (err) {
    throw new KsefSessionCryptoException('AES decrypt failed', 'AES_DECRYPT_FAILED', err as Error);
  }
}
