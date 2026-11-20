/**
 * Shopify Token Endpoint
 *
 * One POST to `https://{shop}/admin/oauth/access_token`, shared by the three
 * grants that use it: client credentials (L-C1), the OAuth code exchange and
 * the OAuth refresh (`grant_type=refresh_token`, Admin API 2026-10). Goes
 * through the transport it is handed: the connection transport for the
 * client-credentials mint, so it is paced like any other request to the shop,
 * and `shopifyAuthFetch` for the two OAuth calls. A refusal becomes a `ShopifyApiError` from the token endpoint
 * carrying the grant error code; the secret is never echoed (Shopify does not
 * put it in an error body, and nothing here logs the request).
 *
 * @module libs/integrations/shopify/src/infrastructure/http
 */
import type { FetchLike } from '@openlinker/shared/http';
import { RateLimitAbortedError, RateLimitTimeoutError } from '@openlinker/shared/rate-limit';

import { ShopifyApiError } from '../../domain/exceptions/shopify-api.error';
import { ShopifyNetworkError } from '../../domain/exceptions/shopify-network.error';
import { readShopifyGrantError } from '../../domain/policies/shopify-grant-error.policy';
import { parseShopifyJson, readShopifyBody } from './shopify-response-body';

export const SHOPIFY_TOKEN_REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = SHOPIFY_TOKEN_REQUEST_TIMEOUT_MS;

/**
 * Transport for the auth calls that must not wait in a connection's rate-limit
 * queue: the OAuth install (no connection exists yet) and the OAuth refresh
 * (it runs under a lock its queue time could outlast). Low volume, each call
 * bounded by its own timeout - the Allegro OAuth bypass precedent.
 */
// eslint-disable-next-line no-restricted-globals -- low-volume OAuth auth call outside the connection limiter (the Allegro OAuth bypass precedent)
export const shopifyAuthFetch: FetchLike = (input, init) => fetch(input, init);

export interface ShopifyTokenEndpointResponse {
  readonly access_token?: string;
  readonly scope?: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
  readonly refresh_token_expires_in?: number;
}

export async function requestShopifyToken(
  fetchImpl: FetchLike,
  storeDomain: string,
  form: Readonly<Record<string, string>>,
): Promise<ShopifyTokenEndpointResponse & { readonly access_token: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  let text: string;
  try {
    response = await fetchImpl(`https://${storeDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
      redirect: 'manual',
      signal: controller.signal,
    });
    text = await readShopifyBody(response);
  } catch (error) {
    if (
      error instanceof RateLimitTimeoutError ||
      error instanceof RateLimitAbortedError ||
      error instanceof ShopifyNetworkError
    ) {
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
    throw new ShopifyApiError(response.status, text, 'token-endpoint', readShopifyGrantError(text));
  }
  const body = parseShopifyJson<ShopifyTokenEndpointResponse>(text);
  const token = body?.access_token;
  if (body === null || typeof token !== 'string' || token.length === 0) {
    throw new ShopifyNetworkError('Shopify token endpoint answered without an access_token');
  }
  return { ...body, access_token: token };
}
