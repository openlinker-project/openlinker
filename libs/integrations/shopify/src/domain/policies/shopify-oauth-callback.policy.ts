/**
 * Shopify OAuth Callback Policy
 *
 * Checks the query Shopify appends to the OAuth redirect before its `code` is
 * used (authorization-code grant, Admin API 2026-10):
 *   - `hmac` is HMAC-SHA256, hex, over every OTHER query parameter sorted by
 *     name and form-encoded as `name=value&...` (the encoding Shopify's own
 *     libraries sign with: `URLSearchParams` in `@shopify/shopify-api`,
 *     `URI.encode_www_form` in the Ruby gem), keyed by the app's client
 *     secret; compared in constant time. The values are re-encoded on
 *     purpose: `URLSearchParams` hands them back decoded, and the `host`
 *     parameter is base64 that may end in `=` - signed decoded, a valid
 *     redirect would be refused as `bad-hmac`;
 *   - `shop` must be a permanent `*.myshopify.com` host and must be the store
 *     the operator started the install for.
 *
 * The state nonce is the host's to check (`IOAuthConnectionService`). Pure:
 * the caller passes the raw query string exactly as the redirect carried it.
 *
 * @module libs/integrations/shopify/src/domain/policies
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { isShopifyStoreDomain, normaliseShopifyStoreDomain } from './shopify-config.policy';

export const ShopifyOAuthCallbackRefusalValues = [
  'missing-code',
  'missing-hmac',
  'bad-hmac',
  'bad-shop',
  'shop-mismatch',
] as const;
export type ShopifyOAuthCallbackRefusal = (typeof ShopifyOAuthCallbackRefusalValues)[number];

export type ShopifyOAuthCallbackCheck =
  | { readonly ok: true; readonly code: string; readonly state: string | null; readonly shop: string }
  | { readonly ok: false; readonly refusal: ShopifyOAuthCallbackRefusal };

export function computeShopifyCallbackHmac(params: URLSearchParams, clientSecret: string): string {
  const message = new URLSearchParams(
    [...params.entries()]
      .filter(([name]) => name !== 'hmac' && name !== 'signature')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ).toString();
  return createHmac('sha256', clientSecret).update(message).digest('hex');
}

export function checkShopifyOAuthCallback(
  rawQuery: string,
  clientSecret: string,
  expectedStoreDomain: string,
): ShopifyOAuthCallbackCheck {
  const params = new URLSearchParams(rawQuery.replace(/^\?/, ''));
  const code = params.get('code');
  if (code === null || code.length === 0) {
    return { ok: false, refusal: 'missing-code' };
  }
  const hmac = params.get('hmac');
  if (hmac === null || hmac.length === 0) {
    return { ok: false, refusal: 'missing-hmac' };
  }
  const expected = Buffer.from(computeShopifyCallbackHmac(params, clientSecret), 'utf8');
  const received = Buffer.from(hmac.toLowerCase(), 'utf8');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, refusal: 'bad-hmac' };
  }
  const shop = normaliseShopifyStoreDomain(params.get('shop'));
  if (!isShopifyStoreDomain(shop)) {
    return { ok: false, refusal: 'bad-shop' };
  }
  if (shop !== normaliseShopifyStoreDomain(expectedStoreDomain)) {
    return { ok: false, refusal: 'shop-mismatch' };
  }
  return { ok: true, code, state: params.get('state'), shop };
}
