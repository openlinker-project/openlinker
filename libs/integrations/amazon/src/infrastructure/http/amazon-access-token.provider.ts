/**
 * Amazon Access Token Provider
 *
 * Mints the short-lived LWA access token every SP-API call carries in
 * `x-amz-access-token`, from the stored refresh token
 * (`POST https://api.amazon.com/auth/o2/token`, `grant_type=refresh_token`).
 * Amazon states one hour of validity.
 *
 * Caching, two layers:
 *   - an in-process memo shared by every resolution (the adapter bag is built
 *     per call, so a per-instance memo alone would mint a token per job);
 *   - the host `CachePort` when wired, so replicas share one token.
 *   A 401 from SP-API means the token was revoked or rotated before its stated
 *   expiry: the client calls `invalidate(token)` and retries once with a fresh
 *   one, rather than replaying a dead token until the margin passes.
 *   Concurrent callers that find no valid token share ONE mint in flight, so
 *   a token expiring under several parallel jobs costs a single LWA call.
 *   The cache key is a FINGERPRINT of the three credential values, never a
 *   secret: re-authorizing or rotating the client secret changes it, so a
 *   token minted from old credentials is never reused. A cached token is
 *   dropped `EXPIRY_MARGIN_SECONDS` before Amazon would expire it.
 *
 * Refusals:
 *   - `invalid_grant` / `invalid_client` / `unauthorized_client` mean the
 *     credentials themselves are rejected -> `AmazonAuthenticationError`,
 *     terminal, and the connection goes to `needs_reauth`;
 *   - anything else LWA answers (5xx, 429, an unknown error code) is an
 *     `AmazonApiError` and follows the ordinary retry rules.
 *
 * Grantless tokens (#4179): with `options.scope` the provider mints through
 * `grant_type=client_credentials` for that scope instead of the refresh
 * token. The Notifications API's destination calls need one
 * (`sellingpartnerapi::notifications`); they act for the app, not a seller.
 * The scope is part of the cache key.
 *
 * The call goes through the transport it is handed (the connection-bound one),
 * so it is paced like every other request for the connection. Nothing here
 * logs the request body; LWA does not echo the secret in its errors.
 *
 * @module libs/integrations/amazon/src/infrastructure/http
 */
import { createHash } from 'node:crypto';

import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';
import { RateLimitAbortedError, RateLimitTimeoutError } from '@openlinker/shared/rate-limit';

import { resolveAmazonLwaUrl } from '../../amazon.constants';
import { AmazonApiError } from '../../domain/exceptions/amazon-api.error';
import { AmazonAuthenticationError } from '../../domain/exceptions/amazon-authentication.error';
import { AmazonNetworkError } from '../../domain/exceptions/amazon-network.error';
import type { AmazonLwaTokenResponse } from '../../domain/types/amazon-api.types';
import type { AmazonCredentials } from '../../domain/types/amazon-credentials.types';
import type { AmazonAccessTokenEntry, AmazonAccessTokenSource } from './amazon-access-token.types';
import { parseAmazonJson, readAmazonBody } from './amazon-response-body';

export type { AmazonAccessTokenSource } from './amazon-access-token.types';

const REQUEST_TIMEOUT_MS = 15_000;

/** Amazon states 3600 s; assumed when the answer names none. */
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

/** Drop a cached token this long before it expires, so a call never starts with a dying one. */
const EXPIRY_MARGIN_SECONDS = 120;

/** LWA error codes that mean the stored credentials are rejected, not that LWA is unwell. */
const CREDENTIAL_GRANT_ERRORS: ReadonlySet<string> = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
]);

const CACHE_KEY_PREFIX = 'amazon:lwa-token:';

/** Shared by every provider in the process; keyed by credential fingerprint. */
const processMemo = new Map<string, AmazonAccessTokenEntry>();

/** Mints in flight, shared by every provider in the process; keyed by credential fingerprint. */
const processInFlight = new Map<string, Promise<AmazonAccessTokenEntry>>();

export class AmazonAccessTokenProvider implements AmazonAccessTokenSource {
  private readonly fingerprint: string;

  constructor(
    private readonly credentials: AmazonCredentials,
    private readonly fetchImpl: FetchLike,
    private readonly cache?: CachePort,
    private readonly now: () => number = Date.now,
    private readonly memo: Map<string, AmazonAccessTokenEntry> = processMemo,
    private readonly inFlight: Map<string, Promise<AmazonAccessTokenEntry>> = processInFlight,
    private readonly options: { readonly scope?: string } = {},
  ) {
    const base = fingerprintAmazonCredentials(credentials);
    this.fingerprint = options.scope ? `${base}:${options.scope}` : base;
  }

  async getAccessToken(): Promise<string> {
    const nowMs = this.now();
    const memoed = this.memo.get(this.fingerprint);
    if (memoed !== undefined) {
      if (memoed.expiresAtMs > nowMs) {
        return memoed.token;
      }
      // Rotated or re-authorized credentials leave their old entry behind; drop it once expired.
      this.memo.delete(this.fingerprint);
    }

    const pending = this.inFlight.get(this.fingerprint);
    if (pending !== undefined) {
      return (await pending).token;
    }
    const resolving = this.resolveToken(nowMs);
    this.inFlight.set(this.fingerprint, resolving);
    try {
      return (await resolving).token;
    } finally {
      this.inFlight.delete(this.fingerprint);
    }
  }

  /**
   * Drop `token` from the memo and the shared cache, but only while it is still
   * the current one: a peer that already replaced it must not lose its fresh
   * token to a late 401 about the old one.
   */
  async invalidate(token: string): Promise<void> {
    const memoed = this.memo.get(this.fingerprint);
    if (memoed !== undefined && memoed.token === token) {
      this.memo.delete(this.fingerprint);
    }
    if (this.cache === undefined) {
      return;
    }
    const key = `${CACHE_KEY_PREFIX}${this.fingerprint}`;
    const cached = await this.readCache(key);
    if (cached !== null && cached.token === token) {
      await this.cache.delete(key).catch(() => undefined);
    }
  }

  private async resolveToken(nowMs: number): Promise<AmazonAccessTokenEntry> {
    const cacheKey = `${CACHE_KEY_PREFIX}${this.fingerprint}`;
    const cached = await this.readCache(cacheKey);
    if (cached !== null && cached.expiresAtMs > nowMs) {
      this.memo.set(this.fingerprint, cached);
      return cached;
    }

    const minted = await this.mint();
    this.memo.set(this.fingerprint, minted);
    const ttlSeconds = Math.floor((minted.expiresAtMs - nowMs) / 1000);
    if (this.cache !== undefined && ttlSeconds > 0) {
      await this.cache.set(cacheKey, minted, ttlSeconds).catch(() => undefined);
    }
    return minted;
  }

  private async readCache(key: string): Promise<AmazonAccessTokenEntry | null> {
    if (this.cache === undefined) {
      return null;
    }
    // A cache outage must not stop the connection: mint instead.
    const value = await this.cache.get<AmazonAccessTokenEntry>(key).catch(() => null);
    return value !== null && typeof value.token === 'string' && typeof value.expiresAtMs === 'number'
      ? value
      : null;
  }

  private async mint(): Promise<AmazonAccessTokenEntry> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(resolveAmazonLwaUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/json',
        },
        body: new URLSearchParams(
          this.options.scope
            ? {
                grant_type: 'client_credentials',
                scope: this.options.scope,
                client_id: this.credentials.clientId,
                client_secret: this.credentials.clientSecret,
              }
            : {
                grant_type: 'refresh_token',
                refresh_token: this.credentials.refreshToken,
                client_id: this.credentials.clientId,
                client_secret: this.credentials.clientSecret,
              },
        ).toString(),
        redirect: 'manual',
        signal: controller.signal,
      });
      text = await readAmazonBody(response);
    } catch (error) {
      if (error instanceof RateLimitTimeoutError || error instanceof RateLimitAbortedError) {
        throw error;
      }
      if (error instanceof AmazonNetworkError) {
        throw error;
      }
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new AmazonNetworkError(
        controller.signal.aborted
          ? `Login with Amazon timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `Login with Amazon request failed: ${cause.message}`,
        controller.signal.aborted,
        cause,
      );
    } finally {
      clearTimeout(timer);
    }

    const body = parseAmazonJson<AmazonLwaTokenResponse>(text);
    if (response.status < 200 || response.status >= 300) {
      const grantError = body?.error;
      if (grantError !== undefined && CREDENTIAL_GRANT_ERRORS.has(grantError)) {
        throw new AmazonAuthenticationError(grantError, body?.error_description);
      }
      throw new AmazonApiError(response.status, grantError, body?.error_description, undefined);
    }
    if (body === null || typeof body.access_token !== 'string' || body.access_token.length === 0) {
      throw new AmazonNetworkError(`Login with Amazon returned no access token (HTTP ${response.status})`);
    }
    const expiresIn =
      typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : DEFAULT_EXPIRES_IN_SECONDS;
    const lifetimeSeconds = Math.max(expiresIn - EXPIRY_MARGIN_SECONDS, 0);
    return { token: body.access_token, expiresAtMs: this.now() + lifetimeSeconds * 1000 };
  }
}

/** Stable, secret-free key for the credentials an access token was minted from. */
export function fingerprintAmazonCredentials(credentials: AmazonCredentials): string {
  return createHash('sha256')
    .update(`${credentials.clientId}\u0000${credentials.clientSecret}\u0000${credentials.refreshToken}`)
    .digest('hex')
    .slice(0, 32);
}
