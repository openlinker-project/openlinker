/**
 * Allegro OAuth Completion Adapter
 *
 * Implements the neutral `OAuthCompletionPort` (#859) for Allegro's OAuth2
 * authorization-code flow. Owns the three Allegro-API-specific steps the host
 * must not know about:
 *
 *   1. `buildAuthorizationUrl` — `/auth/oauth/authorize` URL construction.
 *   2. `exchangeCode` — `POST /auth/oauth/token` (Basic auth, code grant),
 *      returning the *normalized* credential blob the host persists verbatim
 *      and `AllegroTokenRefreshService` reads back at runtime.
 *   3. `fetchAccountIdentity` — delegates to `AllegroAccountReader` (`GET /me`,
 *      relocated to the plugin in #820), mapping the seller identity to the
 *      neutral `OAuthAccountIdentity`.
 *
 * The environment (sandbox/production) is read from the opaque `config` seed
 * the host forwards from the persisted OAuth state — it never leaks into the
 * neutral port surface. Registered against `OAuthCompletionRegistryService` at
 * `allegro.publicapi.v1` by `allegro-plugin.ts`'s `register(host)`.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {OAuthCompletionPort}
 */
import { Logger } from '@openlinker/shared/logging';
import type {
  OAuthCompletionPort,
  BuildAuthorizationUrlInput,
  ExchangeCodeInput,
  FetchAccountIdentityInput,
  OAuthAccountIdentity,
  OAuthCredentialBlob,
} from '@openlinker/core/integrations';
import { OAuthCodeExchangeException } from '@openlinker/core/integrations';
import { AllegroNetworkException } from '../../domain/exceptions/allegro-network.exception';
import { AllegroAccountReader } from '../http/allegro-account-reader';
import type { AllegroOAuthTokenResponse } from '../../domain/types/allegro-oauth.types';

const ALLEGRO_OAUTH_TIMEOUT_MS = 10_000;
const SANDBOX_API_BASE_URL = 'https://allegro.pl.allegrosandbox.pl';
const PRODUCTION_API_BASE_URL = 'https://allegro.pl';

export class AllegroOAuthCompletionAdapter implements OAuthCompletionPort {
  private readonly logger = new Logger(AllegroOAuthCompletionAdapter.name);

  constructor(private readonly accountReader: AllegroAccountReader = new AllegroAccountReader()) {}

  buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
    const apiBaseUrl = this.getApiBaseUrl(this.readEnvironment(input.config));
    const authorizationUrl = new URL('/auth/oauth/authorize', apiBaseUrl);
    authorizationUrl.searchParams.set('client_id', input.clientId);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('redirect_uri', input.redirectUri);
    authorizationUrl.searchParams.set('state', input.state);
    return authorizationUrl.toString();
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<OAuthCredentialBlob> {
    const environment = this.readEnvironment(input.config);
    const tokenUrl = new URL('/auth/oauth/token', this.getApiBaseUrl(environment)).toString();
    const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64');

    let response: Response;
    try {
      this.logger.debug(`Exchanging authorization code for token (environment: ${environment})`);
      response = await this.fetchWithTimeout(
        tokenUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basic}`,
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: input.code,
            redirect_uri: input.redirectUri,
          }).toString(),
        },
        ALLEGRO_OAUTH_TIMEOUT_MS
      );
    } catch (error) {
      // DNS / TLS / connection-refused / abort-on-timeout — transient; the host
      // maps a non-OAuthCodeExchangeException to a 500 (retryable).
      const formatted = this.formatFetchError(error);
      this.logger.error(
        `Error exchanging code for token (environment: ${environment}): ${formatted}`,
        error instanceof Error ? error.stack : undefined
      );
      throw new AllegroNetworkException(
        `Allegro token exchange request failed: ${formatted}`,
        tokenUrl,
        { cause: error }
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.logger.error(
        `Failed to exchange code for token: ${response.status} ${response.statusText} - ${errorText}`
      );
      // Provider rejected the code/credentials — a 4xx-class, client-side
      // failure. The host maps this neutral exception to a 400.
      throw new OAuthCodeExchangeException(
        `Failed to exchange authorization code for token: ${response.statusText}`
      );
    }

    const tokenData = (await response.json()) as AllegroOAuthTokenResponse;
    this.logger.debug(`Successfully exchanged code for token (token_type: ${tokenData.token_type})`);

    // Normalized credential blob — the exact shape the host persists verbatim
    // and `AllegroTokenRefreshService` reads back at runtime. clientId /
    // clientSecret are folded in here for the refresh grant.
    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : undefined,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    };
  }

  async fetchAccountIdentity(
    input: FetchAccountIdentityInput
  ): Promise<OAuthAccountIdentity | undefined> {
    const accessToken = input.credentials.accessToken;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      // Defensive: the blob is always produced by this adapter's exchangeCode,
      // so a missing accessToken is a programming error, not a runtime path.
      throw new AllegroNetworkException(
        'Allegro account-identity check requires an access token',
        '/me'
      );
    }
    const baseUrl = this.getApiBaseUrl(this.readEnvironment(input.config));
    const identity = await this.accountReader.fetchSellerIdentity(baseUrl, accessToken);
    return { accountId: identity.sellerId, label: identity.login };
  }

  private readEnvironment(config?: Record<string, unknown>): string {
    const environment = config?.environment;
    return typeof environment === 'string' && environment.length > 0 ? environment : 'sandbox';
  }

  private getApiBaseUrl(environment: string): string {
    switch (environment) {
      case 'sandbox':
        return SANDBOX_API_BASE_URL;
      case 'production':
        return PRODUCTION_API_BASE_URL;
      default:
        this.logger.warn(`Unknown environment: ${environment}, defaulting to sandbox`);
        return SANDBOX_API_BASE_URL;
    }
  }

  /**
   * Perform a fetch bounded by a timeout via AbortController. Without this, a
   * hung Allegro endpoint pins the request until the OS-level TCP timeout
   * (~2 minutes).
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Format a thrown value from `fetch()` into an operator-actionable string.
   * For an undici network failure, `error.message` is the literal
   * `"fetch failed"`; the useful detail (`ECONNREFUSED`, `ENOTFOUND`,
   * `UND_ERR_CONNECT_TIMEOUT`) lives on `error.cause.code`/`error.cause.message`.
   * DNS fan-out / happy-eyeballs surface an AggregateError-shaped cause whose
   * codes live on `cause.errors[]`. AbortErrors get a dedicated phrasing.
   */
  private formatFetchError(error: unknown): string {
    if (!(error instanceof Error)) {
      return `non-error thrown: ${String(error)}`;
    }
    if (error.name === 'AbortError') {
      return `request aborted after ${ALLEGRO_OAUTH_TIMEOUT_MS}ms`;
    }
    const baseMessage = error.message || 'unknown error';
    const cause = (error as Error & { cause?: unknown }).cause;

    if (cause && typeof cause === 'object') {
      const errorsProp = (cause as { errors?: unknown }).errors;
      if (Array.isArray(errorsProp)) {
        const codes = errorsProp
          .map((e) =>
            e && typeof e === 'object' && 'code' in e ? (e as { code?: unknown }).code : undefined
          )
          .filter((c): c is string => typeof c === 'string');
        const codeSummary = codes.length > 0 ? codes.join(', ') : 'unknown';
        return `${baseMessage} (cause: aggregate — ${codeSummary})`;
      }

      const codeProp = (cause as { code?: unknown }).code;
      const messageProp = (cause as { message?: unknown }).message;
      const causeCode = typeof codeProp === 'string' ? codeProp : 'unknown';
      const causeMessage = typeof messageProp === 'string' ? messageProp : 'n/a';
      return `${baseMessage} (cause: ${causeCode} — ${causeMessage})`;
    }

    return `${baseMessage} (cause: unknown — n/a)`;
  }
}
