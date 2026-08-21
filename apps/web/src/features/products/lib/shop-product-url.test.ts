import { describe, expect, it } from 'vitest';
import { buildShopProductUrl } from './shop-product-url';

describe('buildShopProductUrl', () => {
  it('should build a WooCommerce editor link from the store base URL', () => {
    expect(buildShopProductUrl('woocommerce', { baseUrl: 'https://shop.example' }, '42')).toBe(
      'https://shop.example/wp-admin/post.php?post=42&action=edit',
    );
  });

  it('should tolerate a trailing slash on the configured URL', () => {
    expect(buildShopProductUrl('woocommerce', { baseUrl: 'https://shop.example/' }, '42')).toBe(
      'https://shop.example/wp-admin/post.php?post=42&action=edit',
    );
  });

  it('should return null for PrestaShop, where no URL is constructible', () => {
    // The admin directory is randomised at install and editing needs a
    // per-employee token. A guess would send the operator somewhere wrong.
    expect(buildShopProductUrl('prestashop', { baseUrl: 'https://shop.example' }, '42')).toBeNull();
  });

  it('should return null when the store URL is not configured', () => {
    expect(buildShopProductUrl('woocommerce', {}, '42')).toBeNull();
    expect(buildShopProductUrl('woocommerce', undefined, '42')).toBeNull();
  });

  it('should return null with no external id to link to', () => {
    expect(buildShopProductUrl('woocommerce', { baseUrl: 'https://shop.example' }, null)).toBeNull();
  });
});
