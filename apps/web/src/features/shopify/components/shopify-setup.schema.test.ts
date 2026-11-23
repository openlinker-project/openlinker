import { describe, expect, it } from 'vitest';
import {
  SHOPIFY_ROLE_CAPABILITIES,
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
      enabledCapabilities: SHOPIFY_ROLE_CAPABILITIES.master,
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

describe('Shopify role presets', () => {
  it('should never combine ProductMaster and ProductPublisher, which core refuses', () => {
    for (const capabilities of Object.values(SHOPIFY_ROLE_CAPABILITIES)) {
      expect(capabilities.includes('ProductMaster') && capabilities.includes('ProductPublisher')).toBe(false);
    }
  });

  it('should default to the master role and send its capabilities on create', () => {
    const input = toCreateConnectionInput(shopifySetupSchema.parse(VALID));
    expect(input.enabledCapabilities).toEqual(SHOPIFY_ROLE_CAPABILITIES.master);
  });

  it('should send the publisher capabilities when that role is chosen', () => {
    const input = toCreateConnectionInput(shopifySetupSchema.parse({ ...VALID, role: 'publisher' }));
    expect(input.enabledCapabilities).toEqual(SHOPIFY_ROLE_CAPABILITIES.publisher);
  });

  it('should default the order start to now and send nothing for it', () => {
    const parsed = shopifySetupSchema.parse(VALID);
    expect(parsed.orderSyncStart).toEqual({ mode: 'now' });
    expect(toCreateConnectionInput(parsed).orderSyncStart).toBeUndefined();
  });

  it('should send the chosen start for the master role and never for a publisher or OAuth', () => {
    const chosen = { ...VALID, orderSyncStart: { mode: 'from' as const, from: '2024-03-01' } };
    expect(toCreateConnectionInput(shopifySetupSchema.parse(chosen)).orderSyncStart).toEqual({
      mode: 'from',
      from: '2024-03-01',
    });
    expect(
      toCreateConnectionInput(shopifySetupSchema.parse({ ...chosen, role: 'publisher' })).orderSyncStart,
    ).toBeUndefined();
    expect(
      toCreateConnectionInput(shopifySetupSchema.parse({ ...chosen, mode: 'oauth' })).orderSyncStart,
    ).toBeUndefined();
  });

  it('should refuse a start date with no day or in the future', () => {
    expect(
      shopifySetupSchema.safeParse({ ...VALID, orderSyncStart: { mode: 'from' } }).success,
    ).toBe(false);
    expect(
      shopifySetupSchema.safeParse({ ...VALID, orderSyncStart: { mode: 'from', from: '2999-01-01' } }).success,
    ).toBe(false);
  });
});
