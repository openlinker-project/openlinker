import {
  DEFAULT_GIFT_LINE_FORM,
  offeredGiftLineForms,
  presentGiftLines,
  readGiftLineForm,
  validateGiftOnDocumentsShape,
  type GiftPresentationLine,
} from './gift-lines.types';

const line = (
  over: Partial<GiftPresentationLine> & { name?: string },
): GiftPresentationLine & { name: string } => ({
  name: 'Item',
  quantity: 1,
  unitPriceGross: 10,
  taxRate: '23',
  ...over,
});

const gift = (over: Partial<GiftPresentationLine> & { name?: string } = {}) =>
  line({ name: 'Gift', unitPriceGross: 0, isGift: true, ...over });

/** Minor-unit sum per tax rate, the number that must equal what was paid. */
function sumByRate(lines: readonly GiftPresentationLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    out[l.taxRate] = (out[l.taxRate] ?? 0) + l.quantity * Math.round(l.unitPriceGross * 100);
  }
  return out;
}

describe('presentGiftLines', () => {
  const paidOnly = [line({ name: 'Set', unitPriceGross: 64.99 })];

  it('should leave lines untouched when no line is a gift', () => {
    const lines = [line({ unitPriceGross: 0 }), line({ unitPriceGross: 5 })];
    const result = presentGiftLines(lines, 'omit', true);
    expect(result.lines).toEqual(lines);
  });

  it('should omit a gift by default and keep the paid total', () => {
    const lines = [...paidOnly, gift()];
    const result = presentGiftLines(lines, DEFAULT_GIFT_LINE_FORM, undefined);
    expect(result.lines.map((l) => l.name)).toEqual(['Set']);
    expect(sumByRate(result.lines)).toEqual({ '23': 6499 });
  });

  it('should not treat a marked line the source priced above zero as a gift', () => {
    const lines = [...paidOnly, gift({ unitPriceGross: 3 })];
    const result = presentGiftLines(lines, 'omit', undefined);
    expect(sumByRate(result.lines)).toEqual({ '23': 6799 });
  });

  describe('show', () => {
    it('should keep the gift at 0,00 when the provider accepts zero', () => {
      const result = presentGiftLines([...paidOnly, gift()], 'show', true);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[1].unitPriceGross).toBe(0);
      expect(sumByRate(result.lines)).toEqual({ '23': 6499 });
    });

    it('should take 0,01 from a same-rate paid line when the provider refuses zero', () => {
      const result = presentGiftLines([...paidOnly, gift()], 'show', false);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[1].unitPriceGross).toBeCloseTo(0.01);
      expect(result.lines[0].unitPriceGross).toBeCloseTo(64.98);
      expect(sumByRate(result.lines)).toEqual({ '23': 6499 });
    });

    it('should split a multi-unit donor so the line still sums exactly', () => {
      const lines = [line({ quantity: 3, unitPriceGross: 10 }), gift()];
      const result = presentGiftLines(lines, 'show', false);
      expect(sumByRate(result.lines)).toEqual({ '23': 3000 });
      expect(result.lines.reduce((n, l) => n + l.quantity, 0)).toBe(4);
    });

    it('should fall back to priced-in when no paid line has the gift rate', () => {
      const lines = [
        line({ unitPriceGross: 50 }),
        gift({ taxRate: '8', referenceUnitPriceGross: 10 }),
      ];
      const result = presentGiftLines(lines, 'show', false);
      expect(result.notes).toContain('rate-not-on-document');
      const total = result.lines.reduce((n, l) => n + l.quantity * Math.round(l.unitPriceGross * 100), 0);
      expect(total).toBe(5000);
    });

    it('should not offer show when the provider declares nothing', () => {
      const result = presentGiftLines([...paidOnly, gift()], 'show', undefined);
      expect(result.notes).toContain('show-not-offered');
      expect(result.lines.map((l) => l.name)).toEqual(['Set']);
      expect(offeredGiftLineForms(undefined)).not.toContain('show');
      expect(offeredGiftLineForms(false)).toContain('show');
    });
  });

  describe('priced-in', () => {
    it('should move part of the payment to the gift and keep the total', () => {
      const lines = [
        line({ name: 'A', unitPriceGross: 30 }),
        line({ name: 'B', unitPriceGross: 30, taxRate: '5' }),
        gift({ referenceUnitPriceGross: 10 }),
      ];
      const result = presentGiftLines(lines, 'priced-in', true);
      const total = result.lines.reduce((n, l) => n + l.quantity * Math.round(l.unitPriceGross * 100), 0);
      expect(total).toBe(6000);
      const giftLine = result.lines.find((l) => l.name === 'Gift');
      expect(giftLine?.unitPriceGross).toBeGreaterThan(0);
      expect(giftLine?.taxRate).toBe('23');
    });

    it('should allocate the rounding remainder once to the largest paid line', () => {
      const lines = [
        line({ name: 'Big', unitPriceGross: 33.33 }),
        line({ name: 'Small', unitPriceGross: 10.01 }),
        gift({ referenceUnitPriceGross: 7.77 }),
      ];
      const result = presentGiftLines(lines, 'priced-in', true);
      const total = result.lines.reduce((n, l) => n + l.quantity * Math.round(l.unitPriceGross * 100), 0);
      expect(total).toBe(4334);
    });

    it('should omit a gift with no reference price, since there is nothing to price in', () => {
      const result = presentGiftLines([...paidOnly, gift()], 'priced-in', true);
      expect(result.notes).toContain('no-reference-price');
      expect(sumByRate(result.lines)).toEqual({ '23': 6499 });
    });
  });

  it('should price in automatically a gift in a rate no paid line has', () => {
    const lines = [
      line({ unitPriceGross: 50 }),
      gift({ taxRate: '8', referenceUnitPriceGross: 10 }),
    ];
    const result = presentGiftLines(lines, 'omit', undefined);
    expect(result.appliedForm).toBe('priced-in');
    expect(result.notes).toContain('rate-not-on-document');
    const total = result.lines.reduce((n, l) => n + l.quantity * Math.round(l.unitPriceGross * 100), 0);
    expect(total).toBe(5000);
    expect(result.lines.find((l) => l.taxRate === '8')?.unitPriceGross).toBeGreaterThan(0);
  });

  it('should keep a gift off the document and return it for the internal record', () => {
    const result = presentGiftLines([...paidOnly, gift()], 'internal-record', true);
    expect(result.lines.map((l) => l.name)).toEqual(['Set']);
    expect(result.internalRecordLines.map((l) => l.name)).toEqual(['Gift']);
    expect(sumByRate(result.lines)).toEqual({ '23': 6499 });
  });

  it('should respect the currency minor unit', () => {
    const lines = [line({ unitPriceGross: 1000 }), gift()];
    const result = presentGiftLines(lines, 'show', false, { currency: 'JPY' });
    expect(result.lines[1].unitPriceGross).toBe(1);
    expect(result.lines[0].unitPriceGross + result.lines[1].unitPriceGross).toBe(1000);
  });
});

describe('readGiftLineForm', () => {
  it('should default to omit', () => {
    expect(readGiftLineForm(null)).toBe('omit');
    expect(readGiftLineForm({})).toBe('omit');
    expect(readGiftLineForm({ giftOnDocuments: { form: 'nonsense' } })).toBe('omit');
  });

  it('should read a recognised form', () => {
    expect(readGiftLineForm({ giftOnDocuments: { form: 'priced-in' } })).toBe('priced-in');
  });
});

describe('validateGiftOnDocumentsShape', () => {
  it('should accept a recognised form', () => {
    expect(validateGiftOnDocumentsShape({ form: 'show' })).toEqual([]);
  });

  it('should refuse a non-object and an unknown form', () => {
    expect(validateGiftOnDocumentsShape('show')).toHaveLength(1);
    expect(validateGiftOnDocumentsShape({ form: 'hold' })).toHaveLength(1);
    expect(validateGiftOnDocumentsShape({})).toHaveLength(1);
  });
});

describe('presentGiftLines differentRateGift and zero floor', () => {
  const paid = line({ name: 'Paid', unitPriceGross: 100, taxRate: '23' });
  const otherPaid = line({ name: 'Other', unitPriceGross: 50, taxRate: '23' });
  const sum = (lines: readonly { quantity: number; unitPriceGross: number }[]) =>
    lines.reduce((n, l) => n + Math.round(l.quantity * Math.round(l.unitPriceGross * 100)), 0);

  it('should price a different-rate gift in by default, each line at its own rate', () => {
    const result = presentGiftLines(
      [paid, gift({ taxRate: '8', referenceUnitPriceGross: 20 })],
      'omit',
      false,
    );
    expect(result.notes).toContain('rate-not-on-document');
    const giftLine = result.lines.find((l) => l.taxRate === '8');
    expect(giftLine?.unitPriceGross).toBeGreaterThan(0);
    expect(sum(result.lines)).toBe(10000);
  });

  it('should take the technical cent from the largest paid line when asked', () => {
    const result = presentGiftLines(
      [paid, otherPaid, gift({ taxRate: '8', referenceUnitPriceGross: 20 })],
      'omit',
      false,
      { differentRateGift: 'technical-cent' },
    );
    expect(result.lines.find((l) => l.taxRate === '8')?.unitPriceGross).toBeCloseTo(0.01);
    expect(result.lines.find((l) => l.name === 'Paid')?.unitPriceGross).toBeCloseTo(99.99);
    expect(sum(result.lines)).toBe(15000);
  });

  it('should fall back to priced-in when no paid line can spare the cent', () => {
    const result = presentGiftLines(
      [line({ unitPriceGross: 0.01 }), gift({ taxRate: '8', referenceUnitPriceGross: 20 })],
      'omit',
      false,
      { differentRateGift: 'technical-cent' },
    );
    expect(result.notes).toContain('technical-cent-no-donor');
  });

  it('should never leave a 0.00 line when the provider refuses zero', () => {
    const result = presentGiftLines([paid, line({ name: 'Free', unitPriceGross: 0 })], 'omit', false);
    expect(result.lines.every((l) => Math.round(l.unitPriceGross * 100) > 0)).toBe(true);
    expect(sum(result.lines)).toBe(10000);
  });

  it('should name a zero line it cannot floor', () => {
    const result = presentGiftLines(
      [line({ name: 'Free', unitPriceGross: 0, taxRate: '8' }), paid],
      'omit',
      false,
    );
    expect(result.notes).toContain('zero-line-unfloorable');
  });
});
