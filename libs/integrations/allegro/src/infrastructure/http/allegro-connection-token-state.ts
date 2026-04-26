/**
 * Allegro Connection Token State
 *
 * Per-connection mutable holder for OAuth access-token state shared by every
 * `AllegroHttpClient` that talks to Allegro on behalf of one connection.
 * The factory builds two HTTP clients per connection — one pointed at
 * `api.allegro.pl`, one at `upload.allegro.pl` — and both reference the same
 * `AllegroConnectionTokenState` instance so a refresh triggered by either
 * client is immediately visible to the other (no wasted 401 round-trip).
 *
 * Owns three responsibilities previously scattered on `AllegroHttpClient`:
 *
 *  1. The current `accessToken` + cached `tokenExpiresAt`.
 *  2. The proactive-refresh path (`ensureFreshToken`) — single-flight via
 *     `refreshInFlight`, with a post-failure cooldown so a sick refresh
 *     endpoint can't trigger a refresh storm.
 *  3. The reactive 401 path (`refreshOnUnauthorized`) — returns whether a
 *     refresh actually happened so the caller can decide to retry.
 *
 * Cross-process coordination (e.g., serializing refresh attempts across
 * worker pods) is the `AllegroTokenRefreshService` callback's job, not this
 * class — the Redis lock lives there.
 *
 * @module libs/integrations/allegro/src/infrastructure/http
 * @see {@link AllegroHttpClient} — sole consumer (constructed twice per
 *   connection, both instances sharing one `AllegroConnectionTokenState`)
 * @see {@link AllegroAdapterFactory} — constructs the shared token state
 */
import { Logger } from '@openlinker/shared/logging';
import { AllegroCredentials } from '../../domain/types/allegro-credentials.types';
import { TokenRefreshCallback, TokenRefreshResult } from './allegro-http-client.types';

/**
 * Proactive token-refresh window.
 *
 * Refresh proactively when the current access token is within this many
 * milliseconds of its expiresAt timestamp, so we don't pay a wasted 401
 * round-trip on the next request after an idle period.
 */
const TOKEN_REFRESH_WINDOW_MS = 60_000;

/**
 * Cooldown after a failed proactive refresh. During this window pre-request
 * checks short-circuit and rely on the reactive 401 path, preventing a
 * refresh storm when the refresh endpoint is unhealthy.
 */
const PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS = 5_000;

export class AllegroConnectionTokenState {
  private accessToken: string;
  private tokenExpiresAt: number | undefined;
  private refreshInFlight: Promise<void> | null = null;
  private proactiveRefreshCooldownUntil: number | undefined;

  constructor(
    private readonly connectionId: string,
    initial: AllegroCredentials,
    private readonly tokenRefreshCallback?: TokenRefreshCallback,
  ) {
    this.accessToken = initial.accessToken;
    this.tokenExpiresAt = AllegroConnectionTokenState.normalizeExpiresAt(initial.expiresAt);
  }

  getAccessToken(): string {
    return this.accessToken;
  }

  /**
   * Pre-request hook: refresh proactively if the current token is within
   * the refresh window. No-op when no callback / no expiresAt / inside the
   * post-failure cooldown / outside the refresh window.
   *
   * Per-instance single-flight via `refreshInFlight`: concurrent callers
   * await the same in-flight refresh promise.
   */
  async ensureFreshToken(traceId: string, logger: Logger): Promise<void> {
    if (!this.tokenRefreshCallback || this.tokenExpiresAt === undefined) {
      return;
    }
    if (
      this.proactiveRefreshCooldownUntil !== undefined &&
      Date.now() < this.proactiveRefreshCooldownUntil
    ) {
      return;
    }
    if (Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_WINDOW_MS) {
      return;
    }
    if (this.refreshInFlight) {
      await this.refreshInFlight;
      return;
    }
    this.refreshInFlight = this.performProactiveRefresh(traceId, logger).finally(() => {
      this.refreshInFlight = null;
    });
    await this.refreshInFlight;
  }

  /**
   * Reactive 401 path. Invokes the refresh callback and returns whether
   * the refresh succeeded — the caller decides whether to retry.
   *
   * Returns `false` (without throwing) when:
   *  - no refresh callback is registered, OR
   *  - the refresh callback throws (the original 401 path stays as the
   *    authoritative failure).
   */
  async refreshOnUnauthorized(traceId: string, logger: Logger): Promise<boolean> {
    if (!this.tokenRefreshCallback) {
      return false;
    }
    try {
      logger.warn(
        `[${traceId}] Access token expired, attempting refresh (connection: ${this.connectionId})`,
      );
      const refreshResult = await this.tokenRefreshCallback(this.connectionId);
      this.applyRefreshResult(refreshResult);
      logger.log(
        `[${traceId}] Access token refreshed successfully (connection: ${this.connectionId})`,
      );
      return true;
    } catch (error) {
      logger.error(
        `[${traceId}] Token refresh failed: ${(error as Error).message} (connection: ${this.connectionId})`,
      );
      return false;
    }
  }

  /**
   * Perform the actual proactive refresh. Updates cached access token and
   * expiry on success; records a cooldown on failure so subsequent requests
   * skip the proactive path and rely on the reactive 401 path.
   */
  private async performProactiveRefresh(traceId: string, logger: Logger): Promise<void> {
    if (!this.tokenRefreshCallback) {
      return;
    }
    try {
      logger.debug(
        `[${traceId}] Proactive token refresh (connection: ${this.connectionId})`,
      );
      const refreshResult = await this.tokenRefreshCallback(this.connectionId);
      this.applyRefreshResult(refreshResult);
      logger.log(
        `[${traceId}] Proactive token refresh succeeded (connection: ${this.connectionId})`,
      );
    } catch (error) {
      this.proactiveRefreshCooldownUntil = Date.now() + PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS;
      logger.warn(
        `[${traceId}] Proactive token refresh failed, falling back to reactive 401 path: ${(error as Error).message} (connection: ${this.connectionId})`,
      );
    }
  }

  /**
   * Single place where the access token + cached expiry get updated, so
   * the proactive and reactive refresh paths can't drift (e.g., one
   * forgetting to clear the cooldown or update the expiry).
   */
  private applyRefreshResult(result: TokenRefreshResult): void {
    this.accessToken = result.accessToken;
    this.tokenExpiresAt = AllegroConnectionTokenState.normalizeExpiresAt(result.expiresAt);
    this.proactiveRefreshCooldownUntil = undefined;
  }

  /**
   * Normalize an `expiresAt` value (Date | string | undefined) to epoch ms.
   *
   * Returns `undefined` for absent values, invalid Date objects, or strings
   * that don't parse — which disables proactive refresh for that token state
   * rather than letting NaN silently poison the comparison.
   */
  private static normalizeExpiresAt(value: Date | string | undefined): number | undefined {
    if (value === undefined) {
      return undefined;
    }
    const ms = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
  }
}
