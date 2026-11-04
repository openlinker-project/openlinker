import {
  buildComponentLineId,
  componentLineIdsFor,
  expandBundleLines,
  readLineExpansion,
  type BundleDefinition,
} from '../bundle.types';

const definition: BundleDefinition = {
  variantId: 'v-set',
  version: 1,
  components: [
    { variantId: 'v-a', productId: 'p-a', quantity: 2 },
    { variantId: 'v-b', productId: 'p-b', quantity: 1, giftSlot: true },
    { variantId: 'v-a', productId: 'p-a', quantity: 1 },
  ],
};

const items = [
  { id: 'l1', productId: 'p-set', variantId: 'v-set', quantity: 2 },
  { id: 'l2', productId: 'p-x', variantId: 'v-x', quantity: 1 },
];

describe('expandBundleLines', () => {
  it('should return the items untouched when there are no definitions', () => {
    expect(expandBundleLines(items, [])).toEqual(items);
  });

  it('should expand a bundle line to aggregated components carrying productId', () => {
    const result = expandBundleLines(items, [definition]);
    expect(result.map((l) => [l.id, l.productId, l.variantId, l.quantity])).toEqual([
      [buildComponentLineId('l1', 'v-a'), 'p-a', 'v-a', 6],
      [buildComponentLineId('l1', 'v-b'), 'p-b', 'v-b', 2],
      ['l2', 'p-x', 'v-x', 1],
    ]);
    expect(result[0].parentLineId).toBe('l1');
    expect(result[1].giftSlot).toBe(true);
  });

  it('should never produce duplicate ids', () => {
    const ids = expandBundleLines(items, [definition]).map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('componentLineIdsFor', () => {
  it('should answer the component ids for a bundle line and the line itself otherwise', () => {
    expect(componentLineIdsFor('l1', items, [definition])).toEqual([
      'l1~c:v-a',
      'l1~c:v-b',
    ]);
    expect(componentLineIdsFor('l2', items, [definition])).toEqual(['l2']);
    expect(componentLineIdsFor('gone', items, [definition])).toEqual(['gone']);
  });
});

describe('readLineExpansion', () => {
  it('should round-trip a valid expansion and read garbage as null', () => {
    expect(readLineExpansion({ v: 1, definitions: [definition] })).toEqual({
      v: 1,
      definitions: [definition],
    });
    expect(readLineExpansion(null)).toBeNull();
    expect(readLineExpansion({ v: 2, definitions: [] })).toBeNull();
    expect(readLineExpansion({ v: 1, definitions: [{ variantId: 'x' }] })).toEqual({
      v: 1,
      definitions: [],
    });
  });
});
