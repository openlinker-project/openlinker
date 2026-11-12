import { createHmac } from 'node:crypto';

import { checkShopifyOAuthCallback } from '../shopify-oauth-callback.policy';

const SECRET = 'app-secret';

function signed(params: Record<string, string>, secret = SECRET): string {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const hmac = createHmac('sha256', secret).update(message).digest('hex');
  return new URLSearchParams({ ...params, hmac }).toString();
}

const BASE = { code: 'c0de', shop: 'my-shop.myshopify.com', state: 'st', timestamp: '1700000000', host: 'aG9zdA' };

describe('checkShopifyOAuthCallback', () => {
  it('should accept a redirect signed with the client secret for the expected shop', () => {
    expect(checkShopifyOAuthCallback(`?${signed(BASE)}`, SECRET, 'my-shop.myshopify.com')).toEqual({
      ok: true,
      code: 'c0de',
      state: 'st',
      shop: 'my-shop.myshopify.com',
    });
  });

  it('should refuse a redirect signed with another secret', () => {
    expect(checkShopifyOAuthCallback(signed(BASE, 'other'), SECRET, 'my-shop.myshopify.com')).toEqual({
      ok: false,
      refusal: 'bad-hmac',
    });
  });

  it('should refuse a redirect whose parameters were changed after signing', () => {
    const tampered = signed(BASE).replace('c0de', 'other');
    expect(checkShopifyOAuthCallback(tampered, SECRET, 'my-shop.myshopify.com')).toMatchObject({
      refusal: 'bad-hmac',
    });
  });

  it('should refuse a validly signed redirect for a different store than the install', () => {
    const query = signed({ ...BASE, shop: 'other.myshopify.com' });
    expect(checkShopifyOAuthCallback(query, SECRET, 'my-shop.myshopify.com')).toMatchObject({
      refusal: 'shop-mismatch',
    });
  });

  it('should refuse a lookalike shop host', () => {
    const query = signed({ ...BASE, shop: 'my-shop.myshopify.com.evil.io' });
    expect(checkShopifyOAuthCallback(query, SECRET, 'my-shop.myshopify.com')).toMatchObject({
      refusal: 'bad-shop',
    });
  });

  it.each([
    ['missing-code', 'state=st&hmac=x'],
    ['missing-hmac', 'code=c&state=st'],
  ])('should refuse with %s', (refusal, query) => {
    expect(checkShopifyOAuthCallback(query, SECRET, 'my-shop.myshopify.com')).toEqual({ ok: false, refusal });
  });
});
