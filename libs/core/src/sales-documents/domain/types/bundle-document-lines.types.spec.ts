import {
  presentBundleComponents,
  readBundleDocumentForm,
  type BundleDocumentPresentation,
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
    isGift: boolean;
    referenceUnitPriceGross?: number;
  },
): TestLine => ({
  ...parent,
  id: part.component.lineId,
  name: part.component.name ?? parent.name,
  quantity: part.quantity,
  unitPriceGross: part.unitPriceGross,
  isGift: part.isGift,
  ...(part.referenceUnitPriceGross !== undefined && {
    referenceUnitPriceGross: part.referenceUnitPriceGross,
  }),
});

const minor = (lines: readonly TestLine[]): number =>
  lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitPriceGross * 100), 0);

const present = (
  lines: TestLine[],
  components: DocumentBundleComponent[],
  form: BundleDocumentPresentation['form'] = 'components',
) =>
  presentBundleComponents(
    lines,
    (l) => l.id,
    { form, byLineId: { L1: components } },
    make,
    { currency: 'PLN' },
  );

describe('readBundleDocumentForm', () => {
  it('should default to one-line for anything unrecognised', () => {
    expect(readBundleDocumentForm(undefined)).toBe('one-line');
    expect(readBundleDocumentForm({ giftOnDocuments: { bundleForm: 'nope' } })).toBe('one-line');
  });

  it('should read the components form', () => {
    expect(readBundleDocumentForm({ giftOnDocuments: { bundleForm: 'components' } })).toBe(
      'components',
    );
  });
});

describe('validateGiftOnDocumentsShape bundleForm', () => {
  it('should refuse an unknown bundleForm and accept the two known ones', () => {
    expect(validateGiftOnDocumentsShape({ form: 'omit', bundleForm: 'x' })).toHaveLength(1);
    expect(validateGiftOnDocumentsShape({ form: 'omit', bundleForm: 'components' })).toEqual([]);
    expect(validateGiftOnDocumentsShape({ form: 'omit' })).toEqual([]);
  });
});

describe('presentBundleComponents', () => {
  it('should keep the set as one line for the one-line form', () => {
    const result = present([set()], [component({ unitPriceGross: 60 })], 'one-line');
    expect(result.lines).toHaveLength(1);
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

  it('should keep one line and report a note when there is nothing to split by', () => {
    const result = present([set()], [component({}), component({ lineId: 'L1~c:b', variantId: 'b' })]);
    expect(result.lines).toHaveLength(1);
    expect(result.notes).toEqual([{ code: 'bundle-split-missing', lineId: 'L1' }]);
  });

  it('should leave other lines untouched and keep every line rate', () => {
    const other = set({ id: 'L2', name: 'Plain', taxRate: '8', unitPriceGross: 10 });
    const result = present([other, set()], [
      component({ lineId: 'L1~c:a', variantId: 'a', unitPriceGross: 5 }),
    ]);
    expect(result.lines[0]).toBe(other);
    expect(result.lines.slice(1).every((l) => l.taxRate === '23')).toBe(true);
  });
});
