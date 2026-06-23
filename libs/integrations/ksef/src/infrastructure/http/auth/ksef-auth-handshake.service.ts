/**
 * KSeF Auth Handshake Service
 *
 * Runs the KSeF 2.0 authentication handshake and yields the access/refresh JWT
 * bundle the HTTP client injects + rotates. Sequence (ksef-token flow):
 *
 *   1. POST /auth/challenge            → { challenge, timestamp }
 *   2. encrypt (token|timestamp)       → RSA-OAEP under MF token-enc key
 *   3. POST /auth/ksef-token           → { referenceNumber }  (async)
 *   4. poll GET /auth/{referenceNumber} until status=completed (backoff+timeout)
 *   5. POST /auth/token/redeem         → { accessToken, refreshToken } (JWTs)
 *   6. parse accessToken `exp`         → cache TTL (never hardcoded)
 *
 * The qualified-seal flow (step 2/3 via XAdES + /auth/xades-signature) is
 * DEFERRED to C4: `authenticate` throws `KsefConfigException` for that authType
 * so the connection fails loudly until the real X.509/HSM path lands.
 *
 * Partial-failure posture: challenge/submit transient (5xx/network) failures are
 * retried by the HTTP client itself; a poll timeout throws
 * `KsefAuthenticationException` (the sessionToken/reference is lost — the caller
 * restarts the handshake). A `429` on any auth endpoint surfaces as the client's
 * rate-limit retry, then as an auth exception if exhausted.
 *
 * SECURITY: never logs the token, challenge, accessToken, or refreshToken.
 *
 * @module libs/integrations/ksef/src/infrastructure/http/auth
 */
import { Logger } from '@openlinker/shared/logging';
import type { IKsefHttpClient } from '../ksef-http-client.interface';
import type { KsefAuthenticationToken } from '../ksef-http-client.types';
import type {
  AuthChallenge,
  AuthSubmitResult,
  AuthTokenRedeem,
  KsefTokenEncryptionRequest,
} from '../ksef-auth.types';
import type { KsefTokenEncryptor } from './ksef-token-encryptor.service';
import { parseJwtExpiry } from './ksef-jwt-parser';
import { KsefAuthenticationException } from '../../../domain/exceptions/ksef-authentication.exception';

/** Resolved ksef-token credential material handed in by the factory. */
export interface KsefTokenAuthMaterial {
  authType: 'ksef-token';
  token: string;
  contextNip: string;
}

/** Polling parameters for the async session-issuance step. */
const POLL_MAX_ATTEMPTS = 60;
const POLL_INITIAL_DELAY_MS = 500;
const POLL_MAX_DELAY_MS = 5_000;
const POLL_DEADLINE_MS = 300_000;

export class KsefAuthHandshakeService {
  private readonly logger = new Logger(KsefAuthHandshakeService.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IKsefHttpClient,
    private readonly tokenEncryptor: KsefTokenEncryptor,
  ) {}

  /**
   * Run the full handshake for the ksef-token flow and return the JWT bundle.
   */
  async authenticate(material: KsefTokenAuthMaterial): Promise<KsefAuthenticationToken> {
    this.logger.log(`KSeF auth handshake started (connection ${this.connectionId})`);

    const challenge = await this.requestChallenge();
    const encrypted = await this.tokenEncryptor.encryptToken(
      material.token,
      material.contextNip,
      challenge.timestamp,
    );
    const submit = await this.submitKsefToken(encrypted);
    const redeemed = await this.pollForToken(submit.referenceNumber);
    return this.toAuthenticationToken(redeemed);
  }

  private async requestChallenge(): Promise<AuthChallenge> {
    const response = await this.httpClient.post<AuthChallenge>('/auth/challenge', undefined, {
      idempotent: true,
    });
    if (!response.data.challenge || !response.data.timestamp) {
      throw new KsefAuthenticationException('KSeF /auth/challenge returned an incomplete challenge');
    }
    return response.data;
  }

  private async submitKsefToken(
    encrypted: KsefTokenEncryptionRequest,
  ): Promise<AuthSubmitResult> {
    // Submit is safe to repeat (the server issues a fresh reference each time
    // from the same challenge), so opt into transient retries.
    const response = await this.httpClient.post<AuthSubmitResult>(
      '/auth/ksef-token',
      { ...encrypted },
      { idempotent: true },
    );
    if (!response.data.referenceNumber) {
      throw new KsefAuthenticationException('KSeF /auth/ksef-token returned no referenceNumber');
    }
    return response.data;
  }

  /**
   * Poll the async session-issuance status until completed, with exponential
   * backoff capped at `POLL_MAX_DELAY_MS` and a hard `POLL_DEADLINE_MS` wall.
   * `4xx` (other than the still-processing case) propagates from the client.
   */
  private async pollForToken(referenceNumber: string): Promise<AuthTokenRedeem> {
    const deadline = Date.now() + POLL_DEADLINE_MS;
    let delay = POLL_INITIAL_DELAY_MS;

    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      if (Date.now() > deadline) {
        break;
      }
      const response = await this.httpClient.get<AuthTokenRedeem>(
        `/auth/${encodeURIComponent(referenceNumber)}`,
      );
      const { status } = response.data;
      if (status === 'completed') {
        return this.redeem(referenceNumber);
      }
      if (status === 'failed') {
        throw new KsefAuthenticationException(
          `KSeF auth reference ${referenceNumber} reported failed status`,
        );
      }
      this.logger.debug(
        `KSeF auth poll attempt ${attempt + 1}: still processing (connection ${this.connectionId})`,
      );
      await this.sleep(delay);
      delay = Math.min(delay * 2, POLL_MAX_DELAY_MS);
    }

    throw new KsefAuthenticationException(
      `KSeF auth handshake timed out after ${POLL_DEADLINE_MS}ms (connection ${this.connectionId})`,
    );
  }

  private async redeem(referenceNumber: string): Promise<AuthTokenRedeem> {
    const response = await this.httpClient.post<AuthTokenRedeem>(
      '/auth/token/redeem',
      { referenceNumber },
      { idempotent: true },
    );
    return response.data;
  }

  private toAuthenticationToken(redeemed: AuthTokenRedeem): KsefAuthenticationToken {
    if (!redeemed.accessToken || !redeemed.refreshToken) {
      throw new KsefAuthenticationException('KSeF redeem returned no access/refresh token');
    }
    return {
      accessToken: redeemed.accessToken,
      refreshToken: redeemed.refreshToken,
      accessTokenExpiresAt: parseJwtExpiry(redeemed.accessToken),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
