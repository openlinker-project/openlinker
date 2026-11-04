/**
 * Shopify Access Token Provider
 *
 * Hands the GraphQL client an Admin API access token: the stored `accessToken`
 * as is, or one minted through the client-credentials grant
 * (`POST https://{shop}/admin/oauth/access_token`, form
 * `grant_type=client_credentials`, live L-C1). A minted token lives about 24 h,
 * so it is cached - in the host cache (shared by every replica and every
 * per-call adapter bag) with a TTL well below its life, and in a per-process
 * memo for hosts with no cache wired - and re-minted when the API answers 401.
 *
 * The mint goes through the SAME connection-bound transport as the GraphQL
 * traffic (`host.http.forConnection`), so it is paced and needs no raw `fetch`
 * exemption: a token request is just one more request to the shop.
 *
 * The cache key carries a fingerprint of the client id + secret, so rotating
 * the app's secret can never keep serving a token minted with the old one. The
 * token itself is never logged.
 *
 * @module libs/integrations/shopify/src/infrastructure/http
 */
import { createHash } from 'node:crypto';

import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';
import { RateLimitAbortedError, RateLimitTimeoutError } from '@openlinker/shared/rate-limit';

import { ShopifyApiError } from '../../domain/exceptions/shopify-api.error';
import { ShopifyNetworkError } from '../../domain/exceptions/shopify-network.error';
import type { ShopifyCredentials } from '../../domain/types/shopify-credentials.types';
import { parseShopifyJson, readShopifyBody } from './shopify-response-body';

/** Shopify states ~24 h; a token is retired an hour early so a long job never runs on an expiring one. */
const DEFAULT_TOKEN_LIFE_SECONDS = 86_399;
const TOKEN_SAFETY_MARGIN_SECONDS = 3_600;
const MIN_CACHE_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 15_000;

export interface ShopifyAccessToken {
  readonly token: string;
  /** True when the token was minted here, so a 401 may be answered by minting a new one. */
  readonly renewable: boolean;
}

export interface ShopifyTokenMemoEntry {
  readonly token: string;
  readonly expiresAtMs: number;
}

/** Process-wide memo of minted tokens, owned by the plugin instance. */
export type ShopifyTokenMemo = Map<string, ShopifyTokenMemoEntry>;

interface TokenEndpointBody {
  readonly access_token?: string;
  readonly expires_in?: number;
}

export class ShopifyAccessTokenProvider {
  private readonly cacheKey: string;

  constructor(
    private readonly storeDomain: string,
    connectionId: string,
    private readonly credentials: ShopifyCredentials,
    private readonly fetchImpl: FetchLike,
    private readonly cache: CachePort | undefined,
    /** Process-wide memo owned by the plugin's factory; the adapter bag is rebuilt per call. */
    private readonly memo: ShopifyTokenMemo,
  ) {
    const fingerprint = createHash('sha256')
      .update(`${credentials.clientId ?? ''}:${credentials.clientSecret ?? ''}`)
      .digest('hex')
      .slice(0, 16);
    this.cacheKey = `shopify:access-token:${connectionId}:${storeDomain}:${fingerprint}`;
  }

  async get(): Promise<ShopifyAccessToken> {
    const stored = this.credentials.accessToken?.trim();
    if (stored !== undefined && stored.length > 0) {
      return { token: stored, renewable: false };
    }

    const memoised = this.memo.get(this.cacheKey);
    if (memoised !== undefined && memoised.expiresAtMs > Date.now()) {
      return { token: memoised.token, renewable: true };
    }
    if (this.cache !== undefined) {
      const cached = await this.cache.get<ShopifyTokenMemoEntry>(this.cacheKey).catch(() => null);
      if (cached !== null && cached.expiresAtMs > Date.now()) {
        this.memo.set(this.cacheKey, cached);
        return { token: cached.token, renewable: true };
      }
    }
    return { token: await this.mint(), renewable: true };
  }

  /** Drop a token the API rejected, so the next `get` mints a fresh one. */
  async invalidate(): Promise<void> {
    this.memo.delete(this.cacheKey);
    if (this.cache !== undefined) {
      await this.cache.delete(this.cacheKey).catch(() => undefined);
    }
  }

  private async mint(): Promise<string> {
    const clientId = this.credentials.clientId?.trim() ?? '';
    const clientSecret = this.credentials.clientSecret?.trim() ?? '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(`https://${this.storeDomain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        redirect: 'manual',
        signal: controller.signal,
      });
      text = await readShopifyBody(response);
    } catch (error) {
      if (error instanceof RateLimitTimeoutError || error instanceof RateLimitAbortedError) {
        throw error;
      }
      if (error instanceof ShopifyNetworkError) {
        throw error;
      }
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new ShopifyNetworkError(
        controller.signal.aborted
          ? `Shopify token request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `Shopify token request failed: ${cause.message}`,
        controller.signal.aborted,
        cause,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status < 200 || response.status >= 300) {
      // The body names the grant error (e.g. `invalid_client`); it never echoes the secret.
      throw new ShopifyApiError(response.status, `client_credentials grant refused: ${text}`);
    }
    const body = parseShopifyJson<TokenEndpointBody>(text);
    const token = body?.access_token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new ShopifyNetworkError('Shopify token endpoint answered without an access_token');
    }

    const life =
      typeof body?.expires_in === 'number' && body.expires_in > 0
        ? body.expires_in
        : DEFAULT_TOKEN_LIFE_SECONDS;
    const cacheSeconds = Math.max(MIN_CACHE_SECONDS, life - TOKEN_SAFETY_MARGIN_SECONDS);
    const entry: ShopifyTokenMemoEntry = { token, expiresAtMs: Date.now() + cacheSeconds * 1000 };
    this.memo.set(this.cacheKey, entry);
    if (this.cache !== undefined) {
      await this.cache.set(this.cacheKey, entry, cacheSeconds).catch(() => undefined);
    }
    return token;
  }
}
