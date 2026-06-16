/**
 * Category Provisioner Capability — type guard spec
 *
 * Coverage for `isCategoryProvisioner(adapter)`: true when `provisionCategory`
 * is a function on the `ShopProductManagerPort` adapter, false when absent, and
 * false when the slot exists but is not callable. Mirrors
 * `offer-manager-capabilities.spec.ts`.
 *
 * @module libs/core/src/listings/domain/ports/capabilities/__tests__
 */

import type { ShopProductManagerPort } from '../../shop-product-manager.port';
import { isCategoryProvisioner } from '../category-provisioner.capability';

function makeAdapter(extra: Record<string, unknown> = {}): ShopProductManagerPort {
  return { publishProduct: jest.fn(), ...extra } as unknown as ShopProductManagerPort;
}

describe('isCategoryProvisioner', () => {
  it('returns true when `provisionCategory` is a function', () => {
    expect(isCategoryProvisioner(makeAdapter({ provisionCategory: jest.fn() }))).toBe(true);
  });

  it('returns false when `provisionCategory` is absent', () => {
    expect(isCategoryProvisioner(makeAdapter())).toBe(false);
  });

  it('returns false when `provisionCategory` is present but non-function', () => {
    expect(isCategoryProvisioner(makeAdapter({ provisionCategory: 'not a function' }))).toBe(false);
  });
});
