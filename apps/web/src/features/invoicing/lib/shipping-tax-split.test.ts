/**
 * splitShippingAcrossRates (frontend mirror) — unit tests (#2254)
 *
 * The core half has its own suite; this one exists because the mirror is what
 * the invoice panel renders from, and the property the operator can check is
 * that the previewed parts add up to the shipping the buyer paid.
 *
 * `scripts/check-shipping-tax-split-mirror.mjs` keeps the two implementations
 * identical; these tests keep the shared behaviour honest on this side.
 */
import { describe, it, expect } from 'vitest';
import { splitShippingAcrossRates } from './shipping-tax-split';

const sum = (parts: { amount: number }[]): number =>
  Math.round(parts.reduce((total, part) => total + part.amount, 0) * 100) / 100;

describe('splitShippingAcrossRates (frontend mirror)', () => {
  it('splits proportionally to line gross', () => {
    const parts = splitShippingAcrossRates(10, [
      { taxRate: '23', gross: 300 },
      { taxRate: '5', gross: 100 },
    ]);
    expect(parts).toEqual([
      { taxRate: '23', amount: 7.5 },
      { taxRate: '5', amount: 2.5 },
    ]);
  });

  it('keeps the parts summing exactly to the shipping paid, remainder on the largest', () => {
    // 10 / 3 does not divide into cents: plain per-part rounding loses a cent.
    const parts = splitShippingAcrossRates(10, [
      { taxRate: '23', gross: 100 },
      { taxRate: '8', gross: 100 },
      { taxRate: '5', gross: 100 },
    ]);
    expect(parts).not.toBeNull();
    expect(sum(parts as { amount: number }[])).toBe(10);
    // Equal gross, so the tie-break is the rate code and index 0 carries the
    // remainder.
    expect((parts as { taxRate: string; amount: number }[])[0]).toEqual({
      taxRate: '23',
      amount: 3.34,
    });
  });

  it('sums back to the shipping paid across a range of awkward baskets', () => {
    const baskets: { shipping: number; gross: number[] }[] = [
      { shipping: 9.99, gross: [1, 2, 3] },
      { shipping: 0.03, gross: [7, 11, 13] },
      { shipping: 15.55, gross: [99.99, 0.01] },
      { shipping: 1234.56, gross: [3, 3, 3, 3, 3, 3, 3] },
    ];
    const codes = ['23', '8', '5', '0', 'zw', 'np', 'oo'];
    for (const { shipping, gross } of baskets) {
      const parts = splitShippingAcrossRates(
        shipping,
        gross.map((value, index) => ({ taxRate: codes[index], gross: value }))
      );
      expect(parts).not.toBeNull();
      expect(sum(parts as { amount: number }[])).toBe(shipping);
    }
  });

  it('groups lines that share a rate into one part', () => {
    const parts = splitShippingAcrossRates(12, [
      { taxRate: '23', gross: 50 },
      { taxRate: '23', gross: 50 },
      { taxRate: '5', gross: 100 },
    ]);
    expect(parts).toEqual([
      { taxRate: '23', amount: 6 },
      { taxRate: '5', amount: 6 },
    ]);
  });

  it('carries an exemption code through untouched', () => {
    const parts = splitShippingAcrossRates(10, [
      { taxRate: 'zw', gross: 100 },
      { taxRate: '23', gross: 100 },
    ]);
    expect(parts?.map((part) => part.taxRate).sort()).toEqual(['23', 'zw']);
  });

  it('returns one part when the basket carries a single rate', () => {
    expect(splitShippingAcrossRates(10, [{ taxRate: '23', gross: 100 }])).toEqual([
      { taxRate: '23', amount: 10 },
    ]);
  });

  it('drops a part that rounds to zero rather than billing zero at a rate', () => {
    const parts = splitShippingAcrossRates(1, [
      { taxRate: '23', gross: 100000 },
      { taxRate: '5', gross: 0.01 },
    ]);
    expect(parts).toEqual([{ taxRate: '23', amount: 1 }]);
  });

  it('is uncomputable when any line has no rate', () => {
    expect(
      splitShippingAcrossRates(10, [
        { taxRate: '23', gross: 100 },
        { taxRate: null, gross: 100 },
      ])
    ).toBeNull();
    expect(
      splitShippingAcrossRates(10, [
        { taxRate: '23', gross: 100 },
        { taxRate: '   ', gross: 100 },
      ])
    ).toBeNull();
  });

  it('is uncomputable when there is nothing to be proportional to', () => {
    expect(splitShippingAcrossRates(10, [])).toBeNull();
    expect(splitShippingAcrossRates(10, [{ taxRate: '23', gross: 0 }])).toBeNull();
  });

  it('bills nothing when there is no shipping', () => {
    expect(splitShippingAcrossRates(0, [{ taxRate: '23', gross: 100 }])).toEqual([]);
    expect(splitShippingAcrossRates(Number.NaN, [{ taxRate: '23', gross: 100 }])).toEqual([]);
  });
});
