import { describe, expect, it } from 'vitest';
import {
  SHOPIFY_SETUP_DEFAULT_VALUES,
  shopifyOAuthRedirectUri,
  shopifySetupSchema,
  toCreateConnectionInput,
} from './shopify-setup.schema';

const VALID = {
  ...SHOPIFY_SETUP_DEFAULT_VALUES,
  name: 'Store',
  storeDomain: 'https://My-Shop.myshopify.com/',
  clientId: 'id',
  clientSecret: 'secret',
};

describe('shopifySetupSchema', () => {
  it('should normalise the store domain', () => {
    const parsed = shopifySetupSchema.parse(VALID);
    expect(parsed.storeDomain).toBe('my-shop.myshopify.com');
  });

  it('should refuse a domain that is not *.myshopify.com', () => {
    const result = shopifySetupSchema.safeParse({ ...VALID, storeDomain: 'shop.example.com' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['storeDomain'], message: 'storeDomainInvalid' });
  });

  it('should require the access token only in access-token mode', () => {
    const result = shopifySetupSchema.safeParse({ ...VALID, mode: 'access-token', clientId: '', clientSecret: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(['accessToken']);
  });

  it('should require the client id and secret for an OAuth install', () => {
    const result = shopifySetupSchema.safeParse({ ...VALID, mode: 'oauth', clientSecret: '' });
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(['clientSecret']);
  });
});

describe('toCreateConnectionInput', () => {
  it('should send app credentials with the store config and no empty location', () => {
    expect(toCreateConnectionInput(shopifySetupSchema.parse(VALID))).toEqual({
      name: 'Store',
      platformType: 'shopify',
      adapterKey: 'shopify.admin.v1',
      config: { storeDomain: 'my-shop.myshopify.com' },
      credentials: { clientId: 'id', clientSecret: 'secret' },
    });
  });

  it('should send only the access token in access-token mode', () => {
    const values = shopifySetupSchema.parse({ ...VALID, mode: 'access-token', accessToken: 'shpat_x', locationId: '7' });
    expect(toCreateConnectionInput(values)).toMatchObject({
      config: { storeDomain: 'my-shop.myshopify.com', locationId: '7' },
      credentials: { accessToken: 'shpat_x' },
    });
  });
});

describe('shopifyOAuthRedirectUri', () => {
  it('should point at the callback route', () => {
    expect(shopifyOAuthRedirectUri('https://ol.example.com')).toBe(
      'https://ol.example.com/integrations/shopify/connect/callback',
    );
  });
});
