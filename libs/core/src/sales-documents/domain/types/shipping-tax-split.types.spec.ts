/**
 * Shipping Tax Split Tests (#2248 / #2252, ADR-063 § 5)
 *
 * The property that matters is arithmetic: however the parts fall, they add
 * back up to the shipping the buyer actually paid. Everything else is about
 * refusing to guess when the basket's rate mix is unknown.
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import { minorUnitExponentFor, splitShippingAcrossRates } from './shipping-tax-split.types';
import type { ShippingSplitLine } from './shipping-tax-split.types';

function line(taxRate: string | null, gross: number): ShippingSplitLine {
  return { taxRate, gross };
}

function sum(parts: { amount: number }[]): number {
  return Math.round(parts.reduce((total, part) => total + part.amount, 0) * 100) / 100;
}

describe('splitShippingAcrossRates', () => {
  describe('nothing to bill', () => {
    it('should produce no line when shipping is zero', () => {
      expect(splitShippingAcrossRates(0, [line('23', 100)])).toEqual([]);
    });

    it('should produce no line when shipping is negative or not a number', () => {
      expect(splitShippingAcrossRates(-5, [line('23', 100)])).toEqual([]);
      expect(splitShippingAcrossRates(Number.NaN, [line('23', 100)])).toEqual([]);
    });
  });

  describe('uncomputable', () => {
    it('should refuse when any line carries no rate', () => {
      // The unknown line's share cannot be attributed to somebody else's rate.
      expect(splitShippingAcrossRates(10, [line('23', 100), line(null, 50)])).toBeNull();
      expect(splitShippingAcrossRates(10, [line('23', 100), line('  ', 50)])).toBeNull();
    });

    it('should refuse when there are no lines to be proportional to', () => {
      expect(splitShippingAcrossRates(10, [])).toBeNull();
    });

    it('should refuse when every line gross is zero', () => {
      expect(splitShippingAcrossRates(10, [line('23', 0), line('8', 0)])).toBeNull();
    });
  });

  describe('single rate', () => {
    it('should produce one part carrying the whole shipping amount', () => {
      expect(splitShippingAcrossRates(12.34, [line('23', 100), line('23', 50)])).toEqual([
        { taxRate: '23', amount: 12.34 },
      ]);
    });
  });

  describe('mixed rates', () => {
    it('should split in proportion to line gross', () => {
      const parts = splitShippingAcrossRates(30, [line('23', 200), line('8', 100)]);
      expect(parts).toEqual([
        { taxRate: '23', amount: 20 },
        { taxRate: '8', amount: 10 },
      ]);
    });

    it('should sum exactly to the shipping paid when the split does not divide evenly', () => {
      // 10.00 across 1:1:1 is 3.3333 each; the remainder has to land somewhere.
      const parts = splitShippingAcrossRates(10, [line('23', 100), line('8', 100), line('5', 100)]);
      expect(parts).not.toBeNull();
      expect(sum(parts!)).toBe(10);
    });

    it('should put the rounding remainder on the largest part', () => {
      const parts = splitShippingAcrossRates(10, [line('23', 100), line('8', 100), line('5', 100)]);
      // Equal grosses tie, so ordering falls to the rate code; whichever part
      // sorts first absorbs the cent.
      expect(parts?.[0].amount).toBeGreaterThanOrEqual(parts?.[1].amount ?? 0);
    });

    it('should handle three or more rate buckets and still sum exactly', () => {
      const parts = splitShippingAcrossRates(19.99, [
        line('23', 349.99),
        line('8', 17.5),
        line('5', 3.33),
        line('0', 120),
      ]);
      expect(parts).toHaveLength(4);
      expect(sum(parts!)).toBe(19.99);
    });

    it('should group several lines that share a rate into one part', () => {
      const parts = splitShippingAcrossRates(20, [
        line('23', 100),
        line('23', 100),
        line('8', 200),
      ]);
      expect(parts).toHaveLength(2);
      expect(parts?.find((p) => p.taxRate === '23')?.amount).toBe(10);
    });

    it('should treat a zero rate as a rate rather than as a gap', () => {
      const parts = splitShippingAcrossRates(10, [line('0', 100), line('23', 100)]);
      expect(parts?.map((p) => p.taxRate).sort()).toEqual(['0', '23']);
    });

    it('should drop a part that rounds away to nothing', () => {
      // A 0.01 shipping charge cannot be meaningfully split; a 0.00 line would
      // state that nothing was charged at a rate, which is noise.
      const parts = splitShippingAcrossRates(0.01, [line('23', 100000), line('8', 1)]);
      expect(parts?.every((p) => p.amount !== 0)).toBe(true);
      expect(sum(parts!)).toBe(0.01);
    });
  });
});

describe('minorUnitExponentFor', () => {
  it('should report zero decimals for a zero-decimal currency', () => {
    expect(minorUnitExponentFor('JPY')).toBe(0);
  });

  it('should report three decimals for a three-decimal currency', () => {
    expect(minorUnitExponentFor('KWD')).toBe(3);
  });

  it('should report four decimals for a four-decimal unit of account', () => {
    expect(minorUnitExponentFor('CLF')).toBe(4);
  });

  it('should report two decimals for an ordinary currency', () => {
    expect(minorUnitExponentFor('PLN')).toBe(2);
  });

  it('should fall back to two decimals for an unrecognised code', () => {
    // Degrading to today's behaviour beats a split that loses the fraction.
    expect(minorUnitExponentFor('ZZZ')).toBe(2);
  });

  it('should accept a lowercase code', () => {
    expect(minorUnitExponentFor('jpy')).toBe(0);
  });

  it('should accept an untrimmed code', () => {
    expect(minorUnitExponentFor('  kwd \n')).toBe(3);
  });

  it('should fall back to two decimals when the currency is absent', () => {
    expect(minorUnitExponentFor(null)).toBe(2);
    expect(minorUnitExponentFor(undefined)).toBe(2);
    expect(minorUnitExponentFor('')).toBe(2);
  });
});
