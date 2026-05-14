/**
 * Crypto Primitives
 *
 * Pure functions implementing the AES-256-GCM credentials-at-rest envelope
 * used by `CryptoService` (runtime, NestJS-injected) AND by the
 * `1789000000000-encrypt-integration-credentials` migration (one-shot, no
 * DI). One source of truth for the algorithm + key-loading semantics so the
 * two callers cannot drift (#709).
 *
 * **Envelope format**: `base64(nonce[12] || ciphertext || authTag[16])`.
 *
 * **Key source**: `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY` (base64, 32 bytes
 * decoded). In production the key is required; missing/invalid values throw.
 * In development/test a deterministic fallback key is used with a warning so
 * local setups keep working without manual configuration.
 *
 * @module libs/shared/src/crypto
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DEV_KEY_SEED = 'openlinker-dev-credentials-key-do-not-use-in-production';
const ENV_VAR_NAME = 'OPENLINKER_CREDENTIALS_ENCRYPTION_KEY';

/**
 * Result of loading the encryption key. The `usedDevFallback` flag lets the
 * caller emit a one-time warning via its own logger (the primitive module
 * intentionally has no logging dependency).
 */
export interface LoadedEncryptionKey {
  key: Buffer;
  usedDevFallback: boolean;
}

/**
 * Read the credentials-encryption key from the supplied env map.
 *
 * Behavior:
 *   - `NODE_ENV=production` + key unset → throws.
 *   - `NODE_ENV=production` + key set but malformed → throws.
 *   - `NODE_ENV` in {development, test} + key unset → deterministic dev
 *     fallback, `usedDevFallback=true` so the caller can warn.
 *   - Key set with valid 32-byte base64 → returns the decoded buffer.
 */
export function loadEncryptionKey(env: NodeJS.ProcessEnv): LoadedEncryptionKey {
  const raw = env[ENV_VAR_NAME];
  const nodeEnv = env.NODE_ENV ?? 'development';

  if (!raw) {
    if (nodeEnv === 'development' || nodeEnv === 'test') {
      return {
        key: createHash('sha256').update(DEV_KEY_SEED).digest(),
        usedDevFallback: true,
      };
    }
    throw new Error(
      `${ENV_VAR_NAME} is required. Set it to a base64-encoded 32-byte key.`,
    );
  }

  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `${ENV_VAR_NAME} must decode to ${KEY_BYTES} bytes (got ${decoded.length}).`,
    );
  }
  return { key: decoded, usedDevFallback: false };
}

/**
 * Encrypt `plaintext` under `key` using AES-256-GCM. Returns the base64
 * envelope.
 */
export function encryptWithKey(key: Buffer, plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64');
}

/**
 * Decrypt a base64 envelope produced by `encryptWithKey`. Throws on auth-tag
 * mismatch or malformed envelope.
 */
export function decryptWithKey(key: Buffer, envelope: string): string {
  const buf = Buffer.from(envelope, 'base64');
  if (buf.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error('Invalid ciphertext envelope: too short');
  }
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ciphertext = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
