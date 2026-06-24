/**
 * KSeF Token Encryptor
 *
 * Encrypts the static authorization token for the ksef-token auth flow and
 * builds the `InitTokenAuthenticationRequest` submit body (`POST
 * /auth/ksef-token`). Fetches the MF `KsefTokenEncryption` public key (cached),
 * composes the `token|timestamp` payload (the challenge timestamp binds the
 * ciphertext to the challenge window and defeats replay), RSA-OAEP/SHA-256-wraps
 * it, and stamps the wrapping cert's `publicKeyId` so MF knows which key to
 * unwrap with.
 *
 * SECURITY: the plaintext token is received as a parameter and never logged or
 * retained; only the base64 ciphertext is returned. The token value never
 * appears in any log line or exception.
 *
 * @module libs/integrations/ksef/src/infrastructure/http/auth
 */
import { Logger } from '@openlinker/shared/logging';
import type { InitTokenAuthenticationRequest } from '../ksef-auth.types';
import { wrapKeyWithRsa } from '../../crypto/rsa-key-wrapper';
import type { MfPublicKeyCacheService } from '../../crypto/mf-public-key-cache.service';

export class KsefTokenEncryptor {
  private readonly logger = new Logger(KsefTokenEncryptor.name);

  constructor(private readonly publicKeyCache: MfPublicKeyCacheService) {}

  /**
   * Encrypt `token|challengeTimestamp` under the active MF token-encryption key
   * and assemble the `POST /auth/ksef-token` submit body. The context NIP is
   * carried as the `Nip`-typed `contextIdentifier`.
   */
  async buildInitRequest(
    token: string,
    contextNip: string,
    challenge: string,
    challengeTimestamp: string,
  ): Promise<InitTokenAuthenticationRequest> {
    const cert = await this.publicKeyCache.fetchAndCachePublicKey('KsefTokenEncryption');
    const payload = new TextEncoder().encode(`${token}|${challengeTimestamp}`);
    const wrapped = wrapKeyWithRsa(payload, cert.certificatePem);
    this.logger.debug(`Encrypted KSeF token for context (cert ${cert.certificateHash})`);
    return {
      challenge,
      contextIdentifier: { type: 'Nip', value: contextNip },
      encryptedToken: Buffer.from(wrapped).toString('base64'),
      ...(cert.publicKeyId ? { publicKeyId: cert.publicKeyId } : {}),
    };
  }
}
