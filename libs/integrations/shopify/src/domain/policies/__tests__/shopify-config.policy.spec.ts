import { parseShopifyConfig } from '../shopify-config.policy';

describe('parseShopifyConfig', () => {
  it('should normalise the store domain and default the API version when the config is minimal', () => {
    const result = parseShopifyConfig({ storeDomain: ' https://My-Shop.myshopify.com/ ' });

    expect(result).toEqual({
      ok: true,
      config: {
        storeDomain: 'my-shop.myshopify.com',
        apiVersion: '2026-10',
        locationGid: null,
        unmanagedStockQuantity: null,
      },
    });
  });

  it('should refuse a custom storefront domain naming storeDomain', () => {
    const result = parseShopifyConfig({ storeDomain: 'shop.example.com' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((i) => i.path)).toEqual(['storeDomain']);
  });

  it.each(['2026-13', '2025-01', 'latest', 42])(
    'should refuse the API version %p naming apiVersion (K06)',
    (apiVersion) => {
      const result = parseShopifyConfig({ storeDomain: 'a.myshopify.com', apiVersion });

      expect(!result.ok && result.issues.map((i) => i.path)).toEqual(['apiVersion']);
    },
  );

  it.each([
    ['123', 'gid://shopify/Location/123'],
    [123, 'gid://shopify/Location/123'],
    ['gid://shopify/Location/9', 'gid://shopify/Location/9'],
  ])('should turn the location id %p into a Location GID', (locationId, gid) => {
    const result = parseShopifyConfig({ storeDomain: 'a.myshopify.com', locationId });

    expect(result.ok && result.config.locationGid).toBe(gid);
  });

  it('should refuse a malformed location id naming locationId', () => {
    const result = parseShopifyConfig({ storeDomain: 'a.myshopify.com', locationId: 'abc' });

    expect(!result.ok && result.issues.map((i) => i.path)).toEqual(['locationId']);
  });

  it.each([-1, 1.5, '3'])('should refuse the unmanaged stock quantity %p', (value) => {
    const result = parseShopifyConfig({ storeDomain: 'a.myshopify.com', unmanagedStockQuantity: value });

    expect(!result.ok && result.issues.map((i) => i.path)).toEqual(['unmanagedStockQuantity']);
  });

  it('should report every bad field at once when several are wrong', () => {
    const result = parseShopifyConfig({ storeDomain: 'x', apiVersion: 'y', locationId: 'z' });

    expect(!result.ok && result.issues.map((i) => i.path)).toEqual(['storeDomain', 'apiVersion', 'locationId']);
  });
});
