import { OAuthCodeExchangeException } from '@openlinker/core/integrations';

import { SHOPIFY_REQUIRED_SCOPES } from '../../../shopify.constants';
import { ShopifyOAuthCompletionAdapter } from '../shopify-oauth-completion.adapter';

const CONFIG = { storeDomain: 'my-shop.myshopify.com' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('ShopifyOAuthCompletionAdapter', () => {
  it('should build the store authorize URL with the scopes the capabilities need', () => {
    const url = new URL(
      new ShopifyOAuthCompletionAdapter(jest.fn()).buildAuthorizationUrl({
        clientId: 'id',
        redirectUri: 'https://ol.example.com/cb',
        state: 'st',
        config: CONFIG,
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe('https://my-shop.myshopify.com/admin/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe(SHOPIFY_REQUIRED_SCOPES.join(','));
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.has('grant_options[]')).toBe(false);
  });

  it('should exchange the code for an expiring offline token and return the OAuth blob', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      json({
        access_token: 'shpat_new',
        scope: SHOPIFY_REQUIRED_SCOPES.join(','),
        expires_in: 3600,
        refresh_token: 'shprt_1',
        refresh_token_expires_in: 7_776_000,
      }),
    );

    const blob = await new ShopifyOAuthCompletionAdapter(fetchImpl).exchangeCode({
      code: 'c0de',
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'https://ol.example.com/cb',
      config: CONFIG,
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const form = new URLSearchParams(String(init.body));
    expect(form.get('expiring')).toBe('1');
    expect(form.get('code')).toBe('c0de');
    expect(blob).toMatchObject({
      grant: 'oauth',
      accessToken: 'shpat_new',
      refreshToken: 'shprt_1',
      clientId: 'id',
      clientSecret: 'secret',
    });
    expect(typeof blob.expiresAt).toBe('string');
  });

  it('should refuse a grant with fewer scopes than asked', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ access_token: 't', scope: 'read_products' }));

    await expect(
      new ShopifyOAuthCompletionAdapter(fetchImpl).exchangeCode({
        code: 'c',
        clientId: 'id',
        clientSecret: 's',
        redirectUri: 'r',
        config: CONFIG,
      }),
    ).rejects.toBeInstanceOf(OAuthCodeExchangeException);
  });

  it('should map a refused code to the neutral exchange exception', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ error: 'invalid_request' }, 400));

    await expect(
      new ShopifyOAuthCompletionAdapter(fetchImpl).exchangeCode({
        code: 'c',
        clientId: 'id',
        clientSecret: 's',
        redirectUri: 'r',
        config: CONFIG,
      }),
    ).rejects.toBeInstanceOf(OAuthCodeExchangeException);
  });

  it('should anchor the connection to the shop GID', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(json({ data: { shop: { id: 'gid://shopify/Shop/7', myshopifyDomain: 'my-shop.myshopify.com' } } }));

    await expect(
      new ShopifyOAuthCompletionAdapter(fetchImpl).fetchAccountIdentity({
        credentials: { accessToken: 'shpat_new' },
        config: CONFIG,
      }),
    ).resolves.toEqual({ accountId: 'gid://shopify/Shop/7', label: 'my-shop.myshopify.com' });
  });
});
