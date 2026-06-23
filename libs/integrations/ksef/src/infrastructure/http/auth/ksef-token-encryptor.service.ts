/**
 * KSeF Token Encryptor
 *
 * Encrypts the static authorization token for the ksef-token auth flow. Fetches
 * the MF `KsefTokenEncryption` public key (cached), composes the `token|timestamp`
 * payload (the challenge timestamp binds the ciphertext to the challenge window
 * and defeats replay), and RSA-OAEP/SHA-256-wraps it.
 *
 * SECURITY: the plaintext token is received as a parameter and never logged or
 * retained; only the base64 ciphertext is returned. The token value never
 * appears in any log line or exception.
 *
 * @module libs/integrations/ksef/src/infrastructure/http/auth
 */
import { Logger } from '@openlinker/shared/logging';
import type { KsefTokenEncryptionRequest } from '../ksef-auth.types';
import { wrapKeyWithRsa } from '../../crypto/rsa-key-wrapper';
import type { MfPublicKeyCacheService } from '../../crypto/mf-public-key-cache.service';

export class KsefTokenEncryptor {
  private readonly logger = new Logger(KsefTokenEncryptor.name);

  constructor(private readonly publicKeyCache: MfPublicKeyCacheService) {}

  /**
   * Encrypt `token|challengeTimestamp` under the active MF token-encryption key.
   * Returns the submit payload for `POST /auth/ksef-token`.
   */
  async encryptToken(
    token: string,
    contextNip: string,
    challengeTimestamp: string,
  ): Promise<KsefTokenEncryptionRequest> {
    const cert = await this.publicKeyCache.fetchAndCachePublicKey('KsefTokenEncryption');
    const payload = new TextEncoder().encode(`${token}|${challengeTimestamp}`);
    const wrapped = wrapKeyWithRsa(payload, cert.certificatePem);
    this.logger.debug(`Encrypted KSeF token for context (cert ${cert.certificateHash})`);
    return {
      contextNip,
      encryptedToken: Buffer.from(wrapped).toString('base64'),
      challengeTimestamp,
    };
  }
}
