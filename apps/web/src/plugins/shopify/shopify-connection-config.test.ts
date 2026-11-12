/**
 * Shopify connection-config contribution tests (#3982)
 *
 * Clearing a field must write `null`, not delete the key: the host submit
 * merges the config shallowly over the refetch, so a deleted key would come
 * back with its old value.
 *
 * @module plugins/shopify
 */
import { describe, expect, it } from 'vitest';
import { readLocationId, shopifyConnectionConfig } from './shopify-connection-config';

const { readConfigToForm, applyToConfig, schemaShape } = shopifyConnectionConfig;

describe('shopifyConnectionConfig', () => {
  it('should read every key back as a form string', () => {
    expect(
      readConfigToForm({
        locationId: 'gid://shopify/Location/42',
        unmanagedStockQuantity: 0,
        salesCountryIso2: 'PL',
        refundsThroughShopify: true,
      }),
    ).toEqual({
      shopifyLocationId: '42',
      shopifyUnmanagedStockQuantity: '0',
      shopifySalesCountryIso2: 'PL',
      shopifyRefundsThroughShopify: 'true',
    });
  });

  it('should read an empty config as empty fields', () => {
    expect(readConfigToForm({ storeDomain: 'x.myshopify.com' })).toEqual({
      shopifyLocationId: '',
      shopifyUnmanagedStockQuantity: '',
      shopifySalesCountryIso2: '',
      shopifyRefundsThroughShopify: '',
    });
  });

  it('should write the typed values and keep unrelated keys', () => {
    const config = { storeDomain: 'x.myshopify.com', custom: 1 };

    expect(
      applyToConfig(config, {
        shopifyLocationId: '42',
        shopifyUnmanagedStockQuantity: ' 5 ',
        shopifySalesCountryIso2: 'de',
        shopifyRefundsThroughShopify: 'true',
      }),
    ).toEqual({
      storeDomain: 'x.myshopify.com',
      custom: 1,
      locationId: '42',
      unmanagedStockQuantity: 5,
      salesCountryIso2: 'DE',
      refundsThroughShopify: true,
    });
  });

  it('should clear a field with null and turn refunds off with an explicit false', () => {
    const config = { locationId: '42', salesCountryIso2: 'PL', refundsThroughShopify: true };

    expect(
      applyToConfig(config, {
        shopifyLocationId: '',
        shopifySalesCountryIso2: '',
        shopifyRefundsThroughShopify: '',
      }),
    ).toEqual({ locationId: null, salesCountryIso2: null, refundsThroughShopify: false });
  });

  it('should touch only the keys on the patch', () => {
    const config = { locationId: '42', unmanagedStockQuantity: 9 };

    expect(applyToConfig(config, { shopifySalesCountryIso2: 'PL' })).toEqual({
      locationId: '42',
      unmanagedStockQuantity: 9,
      salesCountryIso2: 'PL',
    });
  });

  it('should refuse values the API would refuse', () => {
    expect(schemaShape.shopifyLocationId?.safeParse('abc').success).toBe(false);
    expect(schemaShape.shopifyLocationId?.safeParse('gid://shopify/Location/7').success).toBe(true);
    expect(schemaShape.shopifyUnmanagedStockQuantity?.safeParse('-1').success).toBe(false);
    expect(schemaShape.shopifySalesCountryIso2?.safeParse('POL').success).toBe(false);
    expect(schemaShape.shopifySalesCountryIso2?.safeParse('').success).toBe(true);
  });

  it('should read a numeric location id stored as a number', () => {
    expect(readLocationId(7)).toBe('7');
    expect(readLocationId(null)).toBe('');
  });
});
