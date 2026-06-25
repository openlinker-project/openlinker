/**
 * KSeF Auth Handshake Service
 *
 * Runs the KSeF 2.0 authentication handshake and yields the access/refresh JWT
 * bundle the HTTP client injects + rotates. Sequence (ksef-token flow), all
 * reconciled to the authoritative spec:
 *
 *   1. POST /auth/challenge            → { challenge, timestamp, timestampMs? }
 *   2. encrypt (token|timestampMs)     → RSA-OAEP under MF token-enc key
 *      (timestamp as epoch ms — MF reference uses ToUnixTimeMilliseconds());
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

/**
 * Polling parameters for the async session-issuance step. The wall-clock
 * `POLL_DEADLINE_MS` is the binding limit; `POLL_MAX_ATTEMPTS` is only a runaway
 * safety cap. At capped 5s backoff a 300s deadline is ~60 polls, so 200 leaves
 * generous headroom while still bounding a pathological zero-delay loop.
 */
const POLL_MAX_ATTEMPTS = 200;
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
    const tsMs = challenge.timestampMs ?? Date.parse(challenge.timestamp);
    if (!Number.isFinite(tsMs)) {
      throw new KsefAuthenticationException(
        `KSeF /auth/challenge returned an unparseable timestamp (${challenge.timestamp})`,
      );
    }
    const initRequest = await this.tokenEncryptor.buildInitRequest(
      material.token,
      material.contextNip,
      challenge.challenge,
      String(tsMs),
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
      skipAuth: true,
      // A 401 anywhere inside the handshake must NOT trigger reactive refresh
      // (which would re-run this very handshake — a nested re-handshake).
      noReactiveRefresh: true,
    });
    // Require the nonce plus *some* usable timestamp: a truthy ISO `timestamp`
    // OR a finite epoch-ms `timestampMs`. `authenticate` derives the epoch-ms
    // (`timestampMs ?? Date.parse(timestamp)`), so a response carrying only
    // `timestampMs` is complete and must not be rejected here.
    const hasTimestamp =
      !!response.data.timestamp || Number.isFinite(response.data.timestampMs);
    if (!response.data.challenge || !hasTimestamp) {
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
      { idempotent: true, skipAuth: true, noReactiveRefresh: true },
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
   * (success), with exponential backoff capped at `POLL_MAX_DELAY_MS`. The
   * binding limit is the `POLL_DEADLINE_MS` wall clock (`while Date.now() <
   * deadline`); `POLL_MAX_ATTEMPTS` is only a runaway safety cap. The poll is
   * authenticated with the submit step's `authenticationToken`. Code `100` is
   * still-in-progress; any other terminal code throws.
   */
  private async pollUntilReady(referenceNumber: string, authToken: string): Promise<void> {
    const deadline = Date.now() + POLL_DEADLINE_MS;
    let delay = POLL_INITIAL_DELAY_MS;
    // The poll carries the short-lived authentication token explicitly, so skip
    // the client's lazy handshake + access-token injection.
    const auth = {
      headers: { Authorization: `Bearer ${authToken}` },
      skipAuth: true,
      // A 401 on the poll means the short-lived authenticationToken was rejected —
      // a terminal handshake failure, NOT a trigger to re-enter reactive refresh.
      noReactiveRefresh: true,
    };

    let attempt = 0;
    while (Date.now() < deadline && attempt < POLL_MAX_ATTEMPTS) {
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
      attempt++;
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
      skipAuth: true,
      headers: { Authorization: `Bearer ${authToken}` },
      // A 401 on redeem means the authenticationToken was rejected — terminal,
      // never a reactive-refresh trigger (which would nest a re-handshake).
      noReactiveRefresh: true,
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
