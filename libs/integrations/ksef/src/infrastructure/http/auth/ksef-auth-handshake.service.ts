/**
 * KSeF Auth Handshake Service
 *
 * Runs the KSeF 2.0 authentication handshake and yields the access/refresh JWT
 * bundle the HTTP client injects + rotates. Sequence (ksef-token flow), all
 * reconciled to the authoritative spec:
 *
 *   1. POST /auth/challenge            → { challenge, timestamp }
 *   2. encrypt (token|timestamp)       → RSA-OAEP under MF token-enc key;
 *      build InitTokenAuthenticationRequest { challenge, contextIdentifier,
 *      encryptedToken, publicKeyId? }
 *   3. POST /auth/ksef-token           → { referenceNumber, authenticationToken }
 *      (async; authenticationToken is the Bearer for the next two calls)
 *   4. poll GET /auth/{referenceNumber} (Bearer authenticationToken) until
 *      status.code === 200 (backoff+timeout)
 *   5. POST /auth/token/redeem (Bearer authenticationToken, NO body)
 *      → { accessToken: TokenInfo, refreshToken: TokenInfo }
 *   6. parse accessToken.token `exp`   → cache TTL (never hardcoded)
 *
 * The qualified-seal flow (step 2/3 via XAdES + /auth/xades-signature) is
 * DEFERRED to C4: `authenticate` throws `KsefConfigException` for that authType
 * so the connection fails loudly until the real X.509/HSM path lands.
 *
 * Partial-failure posture: challenge/submit transient (5xx/network) failures are
 * retried by the HTTP client itself; a poll timeout throws
 * `KsefAuthenticationException` (the reference is lost — the caller restarts the
 * handshake). A `429` on any auth endpoint surfaces as the client's rate-limit
 * retry, then as an auth exception if exhausted.
 *
 * SECURITY: never logs the token, challenge, authenticationToken, accessToken,
 * or refreshToken.
 *
 * @module libs/integrations/ksef/src/infrastructure/http/auth
 */
import { Logger } from '@openlinker/shared/logging';
import type { IKsefHttpClient } from '../ksef-http-client.interface';
import type { KsefAuthenticationToken } from '../ksef-http-client.types';
import type {
  AuthChallenge,
  AuthInitResult,
  AuthOperationStatus,
  AuthTokensResult,
  InitTokenAuthenticationRequest,
} from '../ksef-auth.types';
import { KSEF_AUTH_STATUS_IN_PROGRESS, KSEF_AUTH_STATUS_SUCCESS } from '../ksef-auth.types';
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
    const initRequest = await this.tokenEncryptor.buildInitRequest(
      material.token,
      material.contextNip,
      challenge.challenge,
      challenge.timestamp,
    );
    const init = await this.submitKsefToken(initRequest);
    const authToken = init.authenticationToken.token;
    await this.pollUntilReady(init.referenceNumber, authToken);
    const redeemed = await this.redeem(authToken);
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
    initRequest: InitTokenAuthenticationRequest,
  ): Promise<AuthInitResult> {
    // Submit is safe to repeat (the server issues a fresh reference each time
    // from the same challenge), so opt into transient retries.
    const response = await this.httpClient.post<AuthInitResult>(
      '/auth/ksef-token',
      { ...initRequest },
      { idempotent: true },
    );
    if (!response.data.referenceNumber || !response.data.authenticationToken?.token) {
      throw new KsefAuthenticationException(
        'KSeF /auth/ksef-token returned no referenceNumber / authenticationToken',
      );
    }
    return response.data;
  }

  /**
   * Poll the async operation-status endpoint until `status.code === 200`
   * (success), with exponential backoff capped at `POLL_MAX_DELAY_MS` and a hard
   * `POLL_DEADLINE_MS` wall. The poll is authenticated with the submit step's
   * `authenticationToken`. Code `100` is still-in-progress; any other terminal
   * code throws.
   */
  private async pollUntilReady(referenceNumber: string, authToken: string): Promise<void> {
    const deadline = Date.now() + POLL_DEADLINE_MS;
    let delay = POLL_INITIAL_DELAY_MS;
    const auth = { headers: { Authorization: `Bearer ${authToken}` } };

    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      if (Date.now() > deadline) {
        break;
      }
      const response = await this.httpClient.get<AuthOperationStatus>(
        `/auth/${encodeURIComponent(referenceNumber)}`,
        auth,
      );
      const code = response.data.status?.code;
      if (code === KSEF_AUTH_STATUS_SUCCESS) {
        return;
      }
      if (code !== KSEF_AUTH_STATUS_IN_PROGRESS) {
        throw new KsefAuthenticationException(
          `KSeF auth reference ${referenceNumber} reported terminal status code ${code ?? 'unknown'}`,
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

  private async redeem(authToken: string): Promise<AuthTokensResult> {
    // Redeem takes NO body and is authenticated with the operation's
    // authenticationToken as Bearer.
    const response = await this.httpClient.post<AuthTokensResult>('/auth/token/redeem', undefined, {
      idempotent: true,
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return response.data;
  }

  private toAuthenticationToken(redeemed: AuthTokensResult): KsefAuthenticationToken {
    if (!redeemed.accessToken?.token || !redeemed.refreshToken?.token) {
      throw new KsefAuthenticationException('KSeF redeem returned no access/refresh token');
    }
    return {
      accessToken: redeemed.accessToken.token,
      refreshToken: redeemed.refreshToken.token,
      accessTokenExpiresAt: parseJwtExpiry(redeemed.accessToken.token),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
