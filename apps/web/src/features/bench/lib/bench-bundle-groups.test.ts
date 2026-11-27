import { describe, expect, it } from 'vitest';
import type { BenchParcelLine } from '../api/bench-parcel.types';
import { bundleBlockingClose, bundleGroups, clusterBundleLines } from './bench-bundle-groups';

function line(over: Partial<BenchParcelLine> & { workLineId: string }): BenchParcelLine {
  return {
    productVariantId: `v-${over.workLineId}`,
    name: over.workLineId,
    sku: `SKU-${over.workLineId}`,
    ean: null,
    gtin: null,
    requiredQuantity: 1,
    verifiedQuantity: 0,
    imageUrl: null,
    attributes: null,
    binCode: null,
    weightGrams: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    ...over,
  };
}

const bundle = { lineId: 'L1', name: 'Zestaw poranny' };

describe('bench bundle groups', () => {
  it('should keep the components of a bundle together at the place of the first', () => {
    const ordered = clusterBundleLines([
      line({ workLineId: 'a', bundle }),
      line({ workLineId: 'solo' }),
      line({ workLineId: 'b', bundle }),
    ]);
    expect(ordered.map((l) => l.workLineId)).toEqual(['a', 'b', 'solo']);
  });

  it('should count the units of a bundle that are in the box', () => {
    const [group] = bundleGroups([
      line({ workLineId: 'a', bundle, requiredQuantity: 2, verifiedQuantity: 2 }),
      line({ workLineId: 'b', bundle, requiredQuantity: 1, verifiedQuantity: 0 }),
    ]);
    expect(group).toMatchObject({ done: 2, total: 3, complete: false, missingNames: ['b'] });
  });

  it('should not refuse while the packer is simply still scanning a bundle that has codes', () => {
    const scanning = [
      line({ workLineId: 'a', bundle, verifiedQuantity: 1 }),
      line({ workLineId: 'b', bundle }),
      line({ workLineId: 'solo', verifiedQuantity: 1 }),
    ];
    expect(bundleBlockingClose(scanning)).toBeNull();
  });

  it('should refuse when a missing component has no code to scan and everything else is done', () => {
    const stuck = [
      line({ workLineId: 'a', bundle, verifiedQuantity: 1 }),
      line({ workLineId: 'b', bundle, sku: null, ean: null, gtin: null }),
      line({ workLineId: 'solo', verifiedQuantity: 1 }),
    ];
    expect(bundleBlockingClose(stuck)?.missingNames).toEqual(['b']);
    // Other items still to scan: not yet the bundle that blocks.
    expect(
      bundleBlockingClose([...stuck.slice(0, 2), line({ workLineId: 'solo' })]),
    ).toBeNull();
  });
});
