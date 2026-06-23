/**
 * KSeF Session Crypto Service
 *
 * Owns the document-session crypto lifecycle (ADR-026; KSeF-specific, NOT a core
 * abstraction). Generates an ephemeral AES-256 key + IV via `crypto.randomBytes`,
 * fetches the MF `SymmetricKeyEncryption` public key (cached), wraps the AES key
 * with RSA-OAEP/SHA-256, and exposes AES-256-CBC document encrypt/decrypt.
 *
 * Lifecycle: `initializeSession()` is called on-demand by the issuance flow
 * (C4) before encrypting a batch of documents; the returned `SessionCryptoContext`
 * is reused for all documents until `expiresAt` (min of a self-imposed session
 * TTL and the wrapping cert's validity, with a safety margin). The HTTP client
 * never holds session state — this service is decoupled and lazy.
 *
 * SECURITY: never log key bytes, the wrapped key, plaintext, or ciphertext. The
 * AES key/IV are generated with the CSPRNG `crypto.randomBytes`, never
 * `Math.random`.
 *
 * FUTURE (ADR-027 candidate): if a second CTC regime (IT SDI, ES SII) ships with
 * identical AES + RSA-OAEP needs, extract this to a domain-level
 * `RegulatoryTransmissionCryptoPort` in libs/core. Until then it lives here.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { randomBytes } from 'crypto';
import { Logger } from '@openlinker/shared/logging';
import type { EncryptedDocument, SessionCryptoContext, SymmetricKey } from '../http/ksef-crypto.types';
import {
  KSEF_AES_ALGORITHM,
  KSEF_AES_IV_BYTES,
  KSEF_AES_KEY_BYTES,
} from '../http/ksef-crypto.constants';
import { decryptAesCbc, encryptAesCbc } from './aes-cipher';
import { wrapKeyWithRsa } from './rsa-key-wrapper';
import type { MfPublicKeyCacheService } from './mf-public-key-cache.service';
import { KsefSessionCryptoException } from '../../domain/exceptions/ksef-session-crypto.exception';

/** Self-imposed session lifetime cap; the effective expiry is min(this, cert validity). */
const SESSION_TTL_MS = 30 * 60_000;

export class KsefSessionCryptoService {
  private readonly logger = new Logger(KsefSessionCryptoService.name);

  constructor(private readonly publicKeyCache: MfPublicKeyCacheService) {}

  /**
   * Generate an ephemeral AES-256 session key + IV and wrap the key under the
   * active MF `SymmetricKeyEncryption` public key. Returns the context the
   * issuance flow reuses for the batch.
   */
  async initializeSession(now: Date = new Date()): Promise<SessionCryptoContext> {
    const symmetricKey = this.generateSymmetricKey();
    const cert = await this.publicKeyCache.fetchAndCachePublicKey('SymmetricKeyEncryption');
    const wrapped = wrapKeyWithRsa(symmetricKey.key, cert.certificatePem);

    const sessionCap = now.getTime() + SESSION_TTL_MS;
    const certCap = cert.validUntil.getTime();
    const expiresAt = new Date(Math.min(sessionCap, certCap));

    this.logger.debug(`Initialized KSeF session crypto (cert ${cert.certificateHash}, expires ${expiresAt.toISOString()})`);

    return {
      symmetricKey,
      wrappedKey: { wrappedKey: wrapped, certificateHash: cert.certificateHash },
      expiresAt,
    };
  }

  /** Encrypt a document body with the session's AES key + IV. */
  encryptDocument(plaintext: string, context: SessionCryptoContext): EncryptedDocument {
    const { key, iv } = context.symmetricKey;
    return {
      algorithm: KSEF_AES_ALGORITHM,
      ciphertext: encryptAesCbc(plaintext, key, iv),
      iv,
    };
  }

  /** Decrypt a document body with the session's AES key + the document's IV. */
  decryptDocument(encrypted: EncryptedDocument, context: SessionCryptoContext): string {
    return decryptAesCbc(encrypted.ciphertext, context.symmetricKey.key, encrypted.iv);
  }

  private generateSymmetricKey(): SymmetricKey {
    try {
      return {
        key: new Uint8Array(randomBytes(KSEF_AES_KEY_BYTES)),
        iv: new Uint8Array(randomBytes(KSEF_AES_IV_BYTES)),
      };
    } catch (err) {
      throw new KsefSessionCryptoException(
        'Failed to generate AES session key',
        'AES_KEYGEN_FAILED',
        err as Error,
      );
    }
  }
}
