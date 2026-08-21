/**
 * Modified Product Lister Capability Tests
 *
 * Verifies the guard narrows correctly, which is the ONLY way this rung is ever
 * resolved (#2220, ADR-048 decision 1) — it is deliberately absent from every
 * adapter manifest and from `CoreCapabilityValues`.
 *
 * @module libs/core/src/products/domain/ports/capabilities/__tests__
 */
import { isModifiedProductLister } from '../modified-product-lister.capability';
import type { ModifiedProductLister } from '../modified-product-lister.capability';
import type { ProductMasterPort } from '../../product-master.port';

describe('isModifiedProductLister', () => {
  const baseMaster = (): ProductMasterPort =>
    ({
      listExternalIds: jest.fn(),
      getProduct: jest.fn(),
    }) as unknown as ProductMasterPort;

  it('should return false for a master that only enumerates', () => {
    expect(isModifiedProductLister(baseMaster())).toBe(false);
  });

  it('should return true for a master that implements the rung', () => {
    const adapter = {
      ...baseMaster(),
      listExternalIdsModifiedSince: jest.fn(),
    } as unknown as ProductMasterPort & ModifiedProductLister;

    expect(isModifiedProductLister(adapter)).toBe(true);
  });

  it('should return false when the property is present but not callable', () => {
    // A truthy non-function would otherwise pass a naive `in`/truthiness check and
    // then throw at the call site instead of degrading to enumerate-only.
    const adapter = {
      ...baseMaster(),
      listExternalIdsModifiedSince: 'yes',
    } as unknown as ProductMasterPort;

    expect(isModifiedProductLister(adapter)).toBe(false);
  });
});
