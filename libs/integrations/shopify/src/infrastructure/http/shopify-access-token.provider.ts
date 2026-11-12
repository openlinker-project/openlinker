/**
 * Shopify Access Token Provider
 *
 * Hands the GraphQL client an Admin API access token, in one of three modes
 * (`resolveShopifyCredentialMode`):
 *
 *   - access-token: the stored token as is; never renewed (only the operator
 *     can replace it).
 *   - client-credentials: minted through `grant_type=client_credentials`
 *     (~24 h life). Cached in the host cache (shared by replicas and by the
 *     per-call adapter bags) under ONE key per connection, with the credential
 *     fingerprint and store domain stored in the value, and in a per-process
 *     memo for hosts without a cache. Re-minted once when the API answers 401.
 *   - oauth: the stored, expiring offline token. Refreshed shortly before it
 *     expires, or once after a 401, with `grant_type=refresh_token`. Shopify
 *     rotates the refresh token on every refresh, so the new pair is written
 *     back to the stored credentials, under a lock so two replicas never
 *     spend the same refresh token (the second would be refused).
 *
 * The OAuth refresh does NOT go through the connection's rate-limited
 * transport: waiting for a slot there could outlast the refresh lock, and a
 * second process taking the expired lock would spend the same refresh token,
 * which Shopify has already rotated - the connection would drop to
 * `needs_reauth`. The refresh is one low-volume auth call with its own
 * timeout (the Allegro refresh bypass precedent), so the lock covers it.
 *
 * A process that finds the refresh lock held waits briefly for the peer's
 * result, then reports a `ContendedWriteError`: the runner requeues the job
 * without spending an attempt, instead of failing it for a peer's work.
 *
 * The token is never logged.
 *
 * @module libs/integrations/shopify/src/infrastructure/http
 */
import { ContendedWriteError, type SyncLockPort } from '@openlinker/core/sync';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyConfigException } from '../../domain/exceptions/shopify-config.exception';
import {
  resolveShopifyCredentialMode,
  shopifyAccessTokenCacheKey,
  shopifyCredentialFingerprint,
} from '../../domain/policies/shopify-credentials.policy';
import type { ShopifyCredentialsWriterPort } from '../../domain/ports/shopify-credentials-writer.port';
import type {
  ShopifyCredentialMode,
  ShopifyCredentials,
} from '../../domain/types/shopify-credentials.types';
import {
  SHOPIFY_TOKEN_REQUEST_TIMEOUT_MS,
  requestShopifyToken,
  shopifyAuthFetch,
} from './shopify-token-endpoint';

/** Shopify states ~24 h for a client-credentials token. */
const DEFAULT_TOKEN_LIFE_SECONDS = 86_399;
/** A minted token is retired an hour early so a long job never runs on an expiring one. */
const TOKEN_SAFETY_MARGIN_SECONDS = 3_600;
const MIN_CACHE_SECONDS = 60;
/** An OAuth token is refreshed when it has less than this left. */
const OAUTH_REFRESH_AHEAD_MS = 5 * 60_000;
/**
 * Covers the refresh request (bounded by its own timeout) plus the stored
 * credential read and the write-back attempts, with room to spare.
 */
const REFRESH_LOCK_TTL_MS = SHOPIFY_TOKEN_REQUEST_TIMEOUT_MS * 4;
const REFRESH_WAIT_STEP_MS = 500;
const REFRESH_WAIT_STEPS = 20;
const WRITE_BACK_ATTEMPTS = 3;
const WRITE_BACK_RETRY_MS = 500;

export interface ShopifyAccessToken {
  readonly token: string;
  /** True when a 401 may be answered by obtaining a new token (minted or refreshed). */
  readonly renewable: boolean;
}

export interface ShopifyTokenMemoEntry {
  readonly token: string;
  readonly expiresAtMs: number;
  readonly fingerprint: string;
  readonly storeDomain: string;
}

/** Process-wide memo of minted tokens, keyed like the cache, owned by the plugin instance. */
export type ShopifyTokenMemo = Map<string, ShopifyTokenMemoEntry>;

/** What the OAuth mode needs beyond the credentials themselves. */
export interface ShopifyOAuthRefreshDeps {
  readonly credentialsRef: string;
  /** Re-reads the stored blob, so a refresh another process just made is seen. */
  readonly reload: () => Promise<ShopifyCredentials>;
  readonly writer?: ShopifyCredentialsWriterPort;
  readonly lock?: SyncLockPort;
  /** Transport for the refresh request; outside the connection's rate limiter by default. */
  readonly refreshFetch?: FetchLike;
}

const logger = new Logger('ShopifyAccessTokenProvider');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ShopifyAccessTokenProvider {
  private readonly cacheKey: string;
  private readonly mode: ShopifyCredentialMode;
  private credentials: ShopifyCredentials;
  /** Set by `invalidate` in OAuth mode: the API refused a token we thought was still valid. */
  private forceRefresh = false;

  constructor(
    private readonly storeDomain: string,
    private readonly connectionId: string,
    credentials: ShopifyCredentials,
    private readonly fetchImpl: FetchLike,
    private readonly cache: CachePort | undefined,
    private readonly memo: ShopifyTokenMemo,
    private readonly oauth?: ShopifyOAuthRefreshDeps,
  ) {
    const mode = resolveShopifyCredentialMode(credentials as Readonly<Record<string, unknown>>);
    if (mode === null) {
      throw new ShopifyConfigException(
        connectionId,
        'stored credentials have neither an access token, a client id + secret, nor an OAuth install',
      );
    }
    this.mode = mode;
    this.credentials = credentials;
    this.cacheKey = shopifyAccessTokenCacheKey(connectionId);
  }

  get credentialMode(): ShopifyCredentialMode {
    return this.mode;
  }

  async get(): Promise<ShopifyAccessToken> {
    switch (this.mode) {
      case 'access-token':
        return { token: (this.credentials.accessToken ?? '').trim(), renewable: false };
      case 'oauth':
        return { token: await this.oauthToken(), renewable: true };
      case 'client-credentials':
        return { token: await this.clientCredentialsToken(), renewable: true };
    }
  }

  /** The API rejected the current token: drop it so the next `get` renews it. */
  async invalidate(): Promise<void> {
    if (this.mode === 'oauth') {
      this.forceRefresh = true;
      return;
    }
    this.memo.delete(this.cacheKey);
    if (this.cache !== undefined) {
      await this.cache.delete(this.cacheKey).catch(() => undefined);
    }
  }


  private async clientCredentialsToken(): Promise<string> {
    const fingerprint = shopifyCredentialFingerprint(this.credentials);
    const usable = (entry: ShopifyTokenMemoEntry | null | undefined): entry is ShopifyTokenMemoEntry =>
      entry !== null &&
      entry !== undefined &&
      entry.expiresAtMs > Date.now() &&
      entry.fingerprint === fingerprint &&
      entry.storeDomain === this.storeDomain;

    const memoised = this.memo.get(this.cacheKey);
    if (usable(memoised)) {
      return memoised.token;
    }
    if (this.cache !== undefined) {
      const cached = await this.cache.get<ShopifyTokenMemoEntry>(this.cacheKey).catch(() => null);
      if (usable(cached)) {
        this.memo.set(this.cacheKey, cached);
        return cached.token;
      }
    }

    const body = await requestShopifyToken(this.fetchImpl, this.storeDomain, {
      grant_type: 'client_credentials',
      client_id: (this.credentials.clientId ?? '').trim(),
      client_secret: (this.credentials.clientSecret ?? '').trim(),
    });
    const life =
      typeof body.expires_in === 'number' && body.expires_in > 0
        ? body.expires_in
        : DEFAULT_TOKEN_LIFE_SECONDS;
    const cacheSeconds = Math.max(MIN_CACHE_SECONDS, life - TOKEN_SAFETY_MARGIN_SECONDS);
    const entry: ShopifyTokenMemoEntry = {
      token: body.access_token,
      expiresAtMs: Date.now() + cacheSeconds * 1000,
      fingerprint,
      storeDomain: this.storeDomain,
    };
    this.memo.set(this.cacheKey, entry);
    if (this.cache !== undefined) {
      await this.cache.set(this.cacheKey, entry, cacheSeconds).catch(() => undefined);
    }
    return entry.token;
  }

  private needsRefresh(credentials: ShopifyCredentials): boolean {
    const expiresAtMs = Date.parse(credentials.expiresAt ?? '');
    // An unknown expiry is treated as valid: the API's 401 is the backstop.
    return Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() < OAUTH_REFRESH_AHEAD_MS;
  }

  private async oauthToken(): Promise<string> {
    if (!this.forceRefresh && !this.needsRefresh(this.credentials)) {
      return (this.credentials.accessToken ?? '').trim();
    }
    const staleToken = this.credentials.accessToken;
    await this.refreshOAuth(staleToken);
    this.forceRefresh = false;
    return (this.credentials.accessToken ?? '').trim();
  }

  /**
   * Refresh once across processes: whoever holds the lock refreshes and writes
   * back; the others wait and re-read until the stored token differs from the
   * one they found stale.
   */
  private async refreshOAuth(staleToken: string | undefined): Promise<void> {
    const deps = this.oauth;
    if (deps?.writer === undefined) {
      throw new ShopifyConfigException(
        this.connectionId,
        'the OAuth token expired and this process cannot store a refreshed one',
      );
    }
    const lockKey = `shopify:token-refresh:${this.connectionId}`;
    const lockToken = deps.lock !== undefined ? await deps.lock.acquire(lockKey, REFRESH_LOCK_TTL_MS) : 'local';
    if (lockToken === null) {
      for (let step = 0; step < REFRESH_WAIT_STEPS; step += 1) {
        await sleep(REFRESH_WAIT_STEP_MS);
        const reloaded = await deps.reload();
        if (reloaded.accessToken !== staleToken) {
          this.credentials = reloaded;
          return;
        }
      }
      throw new ContendedWriteError(
        `Another process is refreshing the Shopify OAuth token for connection ${this.connectionId}`,
        this.connectionId,
      );
    }
    try {
      // Another process may have refreshed between our read and the lock.
      const current = await deps.reload();
      if (current.accessToken !== staleToken) {
        this.credentials = current;
        return;
      }
      const body = await requestShopifyToken(deps.refreshFetch ?? shopifyAuthFetch, this.storeDomain, {
        grant_type: 'refresh_token',
        client_id: (current.clientId ?? '').trim(),
        client_secret: (current.clientSecret ?? '').trim(),
        refresh_token: (current.refreshToken ?? '').trim(),
      });
      const now = Date.now();
      const next: ShopifyCredentials = {
        ...current,
        grant: 'oauth',
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? current.refreshToken,
        expiresAt:
          typeof body.expires_in === 'number'
            ? new Date(now + body.expires_in * 1000).toISOString()
            : undefined,
        refreshTokenExpiresAt:
          typeof body.refresh_token_expires_in === 'number'
            ? new Date(now + body.refresh_token_expires_in * 1000).toISOString()
            : current.refreshTokenExpiresAt,
      };
      // Shopify has already rotated the refresh token, so the new pair exists
      // only here: the current call proceeds with it either way, and a lost
      // write is reported loudly because the next refresh will be refused.
      this.credentials = next;
      await this.writeBack(deps.writer, deps.credentialsRef, next);
    } finally {
      if (deps.lock !== undefined && lockToken !== 'local') {
        await deps.lock.release(lockKey, lockToken).catch(() => false);
      }
    }
  }

  private async writeBack(
    writer: ShopifyCredentialsWriterPort,
    credentialsRef: string,
    next: ShopifyCredentials,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= WRITE_BACK_ATTEMPTS; attempt += 1) {
      try {
        await writer.replace(credentialsRef, next);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < WRITE_BACK_ATTEMPTS) {
          await sleep(WRITE_BACK_RETRY_MS);
        }
      }
    }
    logger.error(
      `shopify_oauth_refresh_writeback_failed: connection ${this.connectionId} - the refreshed OAuth ` +
        `tokens could not be stored, so the next refresh will be refused and the store must be ` +
        `reconnected with OAuth: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
}
