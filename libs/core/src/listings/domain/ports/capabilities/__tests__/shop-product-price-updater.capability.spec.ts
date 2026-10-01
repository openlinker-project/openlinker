/**
 * Shop Product Price Updater Capability — type guard spec (#3505, G01-10)
 *
 * Coverage for `isShopProductPriceUpdater(adapter)`. Mirrors
 * `shop-currency-declarer.capability.spec.ts`.
 *
 * @module libs/core/src/listings/domain/ports/capabilities/__tests__
 */

import type { ShopProductManagerPort } from '../../shop-product-manager.port';
import { isShopProductPriceUpdater } from '../shop-product-price-updater.capability';

function makeAdapter(extra: Record<string, unknown> = {}): ShopProductManagerPort {
  return { publishProduct: jest.fn(), ...extra } as unknown as ShopProductManagerPort;
}

describe('isShopProductPriceUpdater', () => {
  it('should return true when `updateShopProductPrice` is a function', () => {
    expect(isShopProductPriceUpdater(makeAdapter({ updateShopProductPrice: jest.fn() }))).toBe(
      true
    );
  });

  it('should return false when `updateShopProductPrice` is absent', () => {
    expect(isShopProductPriceUpdater(makeAdapter())).toBe(false);
  });

  it('should return false when `updateShopProductPrice` is present but not callable', () => {
    expect(isShopProductPriceUpdater(makeAdapter({ updateShopProductPrice: 'nope' }))).toBe(false);
  });
});
