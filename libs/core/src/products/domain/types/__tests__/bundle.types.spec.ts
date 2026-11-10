import {
  buildComponentLineId,
  buildPackLineDefinitions,
  componentLineIdsFor,
  expandBundleLines,
  readLineExpansion,
  type BundleDefinition,
  type ExpandableLine,
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

describe('line-scoped pack definitions (#3624)', () => {
  const item = (id: string, variantId: string, packQuantity?: number): ExpandableLine & { packQuantity?: number } => ({
    id,
    productId: `p-${variantId}`,
    variantId,
    quantity: 2,
    ...(packQuantity === undefined ? {} : { packQuantity }),
  });

  it('should expand a confirmed multipack to N units of its own variant per sold unit', () => {
    const items = [item('L1', 'v-coffee', 3), item('L2', 'v-coffee')];
    const lineDefs = buildPackLineDefinitions(items, [], [{ variantId: 'v-coffee', packQuantity: 3 }]);
    const physical = expandBundleLines(items, lineDefs);
    expect(physical.map((l) => [l.id, l.variantId, l.quantity])).toEqual([
      ['L1~c:v-coffee', 'v-coffee', 6],
      ['L2', 'v-coffee', 2],
    ]);
  });

  it('should not expand an unconfirmed multipack', () => {
    expect(buildPackLineDefinitions([item('L1', 'v-coffee', 3)], [], [])).toEqual([]);
  });

  it('should multiply a bundle by the pack quantity on that line only', () => {
    const bundle = {
      variantId: 'v-set',
      version: 2,
      components: [{ variantId: 'v-a', productId: 'p-a', quantity: 2 }],
    };
    const items = [item('L1', 'v-set', 3), item('L2', 'v-set')];
    const defs = [bundle, ...buildPackLineDefinitions(items, [bundle], [])];
    const physical = expandBundleLines(items, defs);
    expect(physical.map((l) => [l.id, l.quantity])).toEqual([
      ['L1~c:v-a', 12],
      ['L2~c:v-a', 4],
    ]);
  });

  it('should keep the line scope through a persisted round trip', () => {
    const lineDefs = buildPackLineDefinitions([item('L1', 'v-coffee', 3)], [], [
      { variantId: 'v-coffee', packQuantity: 3 },
    ]);
    const read = readLineExpansion(JSON.parse(JSON.stringify({ v: 1, definitions: lineDefs })));
    expect(read?.definitions[0].lineId).toBe('L1');
  });

  it('should read the old shape (no line scope) unchanged', () => {
    const read = readLineExpansion({
      v: 1,
      definitions: [{ variantId: 'v-set', version: 1, components: [{ variantId: 'v-a', productId: 'p-a', quantity: 1 }] }],
    });
    expect(read?.definitions[0].lineId).toBeUndefined();
  });
});
