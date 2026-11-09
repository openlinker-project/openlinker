/**
 * Shopify OAuth Completion Adapter
 *
 * Implements the neutral `OAuthCompletionPort` (#859) for a Shopify store
 * outside the app's organization (K03), where client credentials cannot
 * reach the store and the merchant installs the app through the
 * authorization-code grant (Admin API 2026-10):
 *
 *   1. `buildAuthorizationUrl` - `https://{shop}/admin/oauth/authorize` with
 *      the scopes the capabilities need. No `grant_options[]=per-user`, so
 *      the install yields an OFFLINE token (not tied to a staff member).
 *   2. `exchangeCode` - `POST https://{shop}/admin/oauth/access_token` with
 *      `expiring=1`: Shopify requires expiring offline tokens for new public
 *      apps. Returns the `grant: 'oauth'` credential blob the token provider
 *      refreshes; a token granted fewer scopes than asked is refused.
 *   3. `fetchAccountIdentity` - the shop's GID, so a re-auth cannot silently
 *      move a connection to another store (#820).
 *
 * The store domain and API version come from the opaque `config` seed. The
 * three calls run before any connection exists, so there is no
 * connection-bound transport to use: like Allegro's OAuth bypass, they are
 * low-volume auth calls on a bare `fetch` with a timeout.
 *
 * The callback's `hmac` / `shop` check happens in the host controller through
 * `checkShopifyOAuthCallback`, before `exchangeCode` is reached.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters
 */
import type {
  BuildAuthorizationUrlInput,
  ExchangeCodeInput,
  FetchAccountIdentityInput,
  OAuthAccountIdentity,
  OAuthCompletionPort,
  OAuthCredentialBlob,
} from '@openlinker/core/integrations';
import { OAuthCodeExchangeException } from '@openlinker/core/integrations';
import type { FetchLike } from '@openlinker/shared/http';

import { ShopifyApiError } from '../../domain/exceptions/shopify-api.error';
import { ShopifyNetworkError } from '../../domain/exceptions/shopify-network.error';
import {
  isShopifyStoreDomain,
  normaliseShopifyStoreDomain,
  parseShopifyConfig,
} from '../../domain/policies/shopify-config.policy';
import type { ShopifyCredentials } from '../../domain/types/shopify-credentials.types';
import { SHOPIFY_REQUESTED_SCOPES, findMissingShopifyScopes } from '../../domain/policies/shopify-scopes.policy';
import { requestShopifyToken, shopifyAuthFetch } from '../http/shopify-token-endpoint';
import { parseShopifyJson, readShopifyBody } from '../http/shopify-response-body';

const IDENTITY_TIMEOUT_MS = 15_000;

const IDENTITY_QUERY = 'query OlOAuthIdentity { shop { id name myshopifyDomain } }';


export class ShopifyOAuthCompletionAdapter implements OAuthCompletionPort {
  // The token and identity calls run before a connection exists, so there is
  // no connection-bound transport to go through.
  constructor(private readonly fetchImpl: FetchLike = shopifyAuthFetch) {}

  buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
    const url = new URL(`https://${this.readStoreDomain(input.config)}/admin/oauth/authorize`);
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('scope', SHOPIFY_REQUESTED_SCOPES.join(','));
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<OAuthCredentialBlob> {
    let body;
    try {
      body = await requestShopifyToken(this.fetchImpl, this.readStoreDomain(input.config), {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        expiring: '1',
      });
    } catch (error) {
      if (error instanceof ShopifyApiError) {
        throw new OAuthCodeExchangeException(
          `Shopify refused the authorization code${error.grantError !== null ? ` (${error.grantError})` : ''}`,
        );
      }
      throw error;
    }
    const granted = new Set((body.scope ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0));
    const missing = findMissingShopifyScopes(granted);
    if (missing.length > 0) {
      throw new OAuthCodeExchangeException(
        `Shopify granted the app fewer scopes than it needs: ${missing.join(', ')}`,
      );
    }
    const now = Date.now();
    const credentials: ShopifyCredentials = {
      grant: 'oauth',
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt:
        typeof body.expires_in === 'number' ? new Date(now + body.expires_in * 1000).toISOString() : undefined,
      refreshTokenExpiresAt:
        typeof body.refresh_token_expires_in === 'number'
          ? new Date(now + body.refresh_token_expires_in * 1000).toISOString()
          : undefined,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    };
    return { ...credentials };
  }

  async fetchAccountIdentity(input: FetchAccountIdentityInput): Promise<OAuthAccountIdentity> {
    const token = input.credentials.accessToken;
    if (typeof token !== 'string' || token.length === 0) {
      throw new ShopifyNetworkError('Shopify account-identity check needs an access token');
    }
    const parsed = parseShopifyConfig(input.config);
    const domain = this.readStoreDomain(input.config);
    const apiVersion = parsed.ok ? parsed.config.apiVersion : undefined;
    if (apiVersion === undefined) {
      throw new ShopifyNetworkError('Shopify account-identity check needs a valid connection config');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ query: IDENTITY_QUERY }),
        redirect: 'manual',
        signal: controller.signal,
      });
      text = await readShopifyBody(response);
    } catch (error) {
      if (error instanceof ShopifyNetworkError) {
        throw error;
      }
      // A bare AbortError or TypeError would reach the operator with no
      // context and read as non-retryable; wrap it like the token call does.
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new ShopifyNetworkError(
        controller.signal.aborted
          ? `Shopify account-identity check timed out after ${IDENTITY_TIMEOUT_MS}ms`
          : `Shopify account-identity check failed: ${cause.message}`,
        controller.signal.aborted,
        cause,
      );
    } finally {
      clearTimeout(timer);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ShopifyApiError(response.status, text);
    }
    const shop = parseShopifyJson<{ data?: { shop?: { id: string; myshopifyDomain: string } } }>(text)?.data?.shop;
    if (shop === undefined) {
      throw new ShopifyNetworkError('Shopify answered the identity check without a shop');
    }
    return { accountId: shop.id, label: shop.myshopifyDomain };
  }

  private readStoreDomain(config?: Record<string, unknown>): string {
    const domain = normaliseShopifyStoreDomain(config?.storeDomain);
    if (!isShopifyStoreDomain(domain)) {
      throw new OAuthCodeExchangeException(
        'The Shopify store domain must be the permanent "my-shop.myshopify.com" domain',
      );
    }
    return domain;
  }
}
