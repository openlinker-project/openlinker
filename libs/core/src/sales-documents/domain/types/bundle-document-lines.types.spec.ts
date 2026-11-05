import {
  BundleSplitUnknownError,
  presentBundleComponents,
  type DocumentBundleComponent,
} from './bundle-document-lines.types';
import { validateGiftOnDocumentsShape, type GiftPresentationLine } from './gift-lines.types';

interface TestLine extends GiftPresentationLine {
  id: string;
  name: string;
}

const set = (over: Partial<TestLine> = {}): TestLine => ({
  id: 'L1',
  name: 'Set',
  quantity: 1,
  unitPriceGross: 100,
  taxRate: '23',
  ...over,
});

const component = (over: Partial<DocumentBundleComponent>): DocumentBundleComponent => ({
  taxRate: '8',
  lineId: 'L1~c:v1',
  variantId: 'v1',
  productId: 'p1',
  name: 'Mug',
  quantity: 1,
  ...over,
});

const make = (
  parent: TestLine,
  part: {
    component: DocumentBundleComponent;
    quantity: number;
    unitPriceGross: number;
    taxRate: string;
    isGift: boolean;
    referenceUnitPriceGross?: number;
  },
): TestLine => ({
  ...parent,
  id: part.component.lineId,
  name: part.component.name ?? parent.name,
  quantity: part.quantity,
  unitPriceGross: part.unitPriceGross,
  taxRate: part.taxRate,
  isGift: part.isGift,
  ...(part.referenceUnitPriceGross !== undefined && {
    referenceUnitPriceGross: part.referenceUnitPriceGross,
  }),
});

const minor = (lines: readonly TestLine[]): number =>
  lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitPriceGross * 100), 0);

const present = (lines: TestLine[], components: DocumentBundleComponent[]) =>
  presentBundleComponents(lines, (l) => l.id, { byLineId: { L1: components } }, make, {
    currency: 'PLN',
  });

describe('validateGiftOnDocumentsShape', () => {
  it('should refuse an unknown form and ignore the legacy differentRateGift', () => {
    expect(validateGiftOnDocumentsShape({ form: 'nope', differentRateGift: 'x' })).toHaveLength(1);
    expect(validateGiftOnDocumentsShape({ form: 'omit', differentRateGift: 'technical-cent' })).toEqual([]);
    expect(validateGiftOnDocumentsShape({ form: 'omit' })).toEqual([]);
  });
});

describe('presentBundleComponents', () => {
  it('should keep the set as one line when every component has the set rate', () => {
    const result = present([set()], [
      component({ taxRate: '23', unitPriceGross: 60 }),
      component({ lineId: 'L1~c:b', variantId: 'b', taxRate: '23.00', unitPriceGross: 30 }),
    ]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].unitPriceGross).toBe(100);
  });

  it('should hold when a component rate is unknown, even if the others match', () => {
    expect(() =>
      present([set()], [
        component({ taxRate: '23', unitPriceGross: 60 }),
        component({ lineId: 'L1~c:b', variantId: 'b', taxRate: null, unitPriceGross: 30 }),
      ]),
    ).toThrow(BundleSplitUnknownError);
  });

  it('should present mixed rates as components at their own rates summing to the paid price', () => {
    const result = present([set()], [
      component({ lineId: 'L1~c:a', variantId: 'a', name: 'A', taxRate: '23', unitPriceGross: 60 }),
      component({ lineId: 'L1~c:b', variantId: 'b', name: 'B', taxRate: '8', unitPriceGross: 30 }),
    ]);
    expect(result.lines.map((l) => [l.name, l.taxRate, l.unitPriceGross])).toEqual([
      ['A', '23', 66.67],
      ['B', '8', 33.33],
    ]);
    const perRate = (rate: string) =>
      minor(result.lines.filter((l) => l.taxRate === rate));
    expect(perRate('23') + perRate('8')).toBe(10000);
  });

  it('should split the paid price by standalone price and keep the total', () => {
    const result = present(
      [set()],
      [
        component({ lineId: 'L1~c:a', variantId: 'a', name: 'A', unitPriceGross: 60 }),
        component({ lineId: 'L1~c:b', variantId: 'b', name: 'B', unitPriceGross: 30 }),
      ],
    );
    expect(result.lines.map((l) => [l.name, l.unitPriceGross])).toEqual([
      ['A', 66.67],
      ['B', 33.33],
    ]);
    expect(minor(result.lines)).toBe(10000);
  });

  it('should price the gift slot at 0 with its standalone price as the reference', () => {
    const result = present(
      [set()],
      [
        component({ lineId: 'L1~c:a', variantId: 'a', name: 'A', unitPriceGross: 50 }),
        component({
          lineId: 'L1~c:g',
          variantId: 'g',
          name: 'Gift',
          giftSlot: true,
          unitPriceGross: 20,
        }),
      ],
    );
    const gift = result.lines.find((l) => l.name === 'Gift');
    expect(gift).toMatchObject({ unitPriceGross: 0, isGift: true, referenceUnitPriceGross: 20 });
    expect(minor(result.lines)).toBe(10000);
  });

  it('should carry the whole total when a quantity does not divide evenly', () => {
    const result = present(
      [set({ quantity: 3, unitPriceGross: 33.33 })],
      [
        component({ lineId: 'L1~c:a', variantId: 'a', quantity: 3, unitPriceGross: 7 }),
        component({ lineId: 'L1~c:b', variantId: 'b', quantity: 6, unitPriceGross: 3 }),
      ],
    );
    expect(minor(result.lines)).toBe(9999);
  });

  it('should fall back to costs as weights when a component has no price', () => {
    const result = present(
      [set()],
      [
        component({ lineId: 'L1~c:a', variantId: 'a', unitCostNet: 30 }),
        component({ lineId: 'L1~c:b', variantId: 'b', unitCostNet: 10 }),
      ],
    );
    expect(result.lines.map((l) => l.unitPriceGross)).toEqual([75, 25]);
  });

  it('should hold, not guess, when there is nothing to split by', () => {
    expect(() =>
      present([set()], [component({}), component({ lineId: 'L1~c:b', variantId: 'b' })]),
    ).toThrow(BundleSplitUnknownError);
  });

  it('should leave other lines untouched and give a component its own rate', () => {
    const other = set({ id: 'L2', name: 'Plain', taxRate: '8', unitPriceGross: 10 });
    const result = present([other, set()], [
      component({ lineId: 'L1~c:a', variantId: 'a', unitPriceGross: 5 }),
    ]);
    expect(result.lines[0]).toBe(other);
    expect(result.lines.slice(1).every((l) => l.taxRate === '8')).toBe(true);
  });
});
