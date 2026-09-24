/**
 * Shop Currency Declarer Capability — type guard spec (#3203)
 *
 * Coverage for `isShopCurrencyDeclarer(adapter)`: true when
 * `getDestinationCurrency` is a function on the `ShopProductManagerPort`
 * adapter, false when absent, and false when the slot exists but is not
 * callable. Mirrors `category-provisioner.capability.spec.ts`.
 *
 * @module libs/core/src/listings/domain/ports/capabilities/__tests__
 */

import type { ShopProductManagerPort } from '../../shop-product-manager.port';
import { isShopCurrencyDeclarer } from '../shop-currency-declarer.capability';

function makeAdapter(extra: Record<string, unknown> = {}): ShopProductManagerPort {
  return { publishProduct: jest.fn(), ...extra } as unknown as ShopProductManagerPort;
}

describe('isShopCurrencyDeclarer', () => {
  it('returns true when `getDestinationCurrency` is a function', () => {
    expect(isShopCurrencyDeclarer(makeAdapter({ getDestinationCurrency: jest.fn() }))).toBe(true);
  });

  it('returns false when `getDestinationCurrency` is absent', () => {
    expect(isShopCurrencyDeclarer(makeAdapter())).toBe(false);
  });

  it('returns false when `getDestinationCurrency` is present but non-function', () => {
    expect(
      isShopCurrencyDeclarer(makeAdapter({ getDestinationCurrency: 'not a function' }))
    ).toBe(false);
  });
});
