/**
 * Order Discount Tests (#3543)
 *
 * @module libs/core/src/orders/domain/types
 */
import {
  applyDiscountToLines,
  decimalPlaces,
  discountedUnitPriceGross,
  effectiveDiscountAmount,
  goodsGrossValue,
  isDecimalAmountText,
  planOrderDiscount,
  readOrderDiscountEdit,
  restateTotalsForDiscount,
} from './order-discount.types';

const stamp = { changeId: 'chg-1', editedAt: '2026-10-26T10:00:00.000Z', editedBy: 'u1' };

const lines = [
  { id: 'l1', quantity: 3, price: 10 },
  { id: 'l2', quantity: 1, price: 20 },
];

describe('planOrderDiscount', () => {
  it('should cut the amount so the shares sum back to it exactly', () => {
    const plan = planOrderDiscount(lines, 10, 'PLN');

    expect(plan?.perLine.map((line) => line.share)).toEqual([6, 4]);
    expect(plan?.perLine.reduce((sum, line) => sum + line.share, 0)).toBe(10);
  });

  it('should leave the remainder on the largest line at every minor unit', () => {
    expect(planOrderDiscount(lines, 0.01, 'PLN')?.perLine.map((l) => l.share)).toEqual([0.01, 0]);
    expect(planOrderDiscount(lines, 1, 'JPY')?.perLine.map((l) => l.share)).toEqual([1, 0]);
    expect(planOrderDiscount(lines, 0.001, 'KWD')?.perLine.map((l) => l.share)).toEqual([0.001, 0]);
  });

  it('should never over-subtract: shares always sum to the amount, however awkward the split', () => {
    const awkward = [
      { id: 'a', quantity: 1, price: 3.33 },
      { id: 'b', quantity: 1, price: 3.33 },
      { id: 'c', quantity: 1, price: 3.34 },
    ];
    for (const amount of [0.01, 0.02, 0.5, 1, 5.55, 9.98]) {
      const plan = planOrderDiscount(awkward, amount, 'PLN');
      const sum = plan?.perLine.reduce((acc, line) => acc + Math.round(line.share * 100), 0);
      expect(sum).toBe(Math.round(amount * 100));
    }
  });

  it('should refuse an amount that is not strictly less than the goods', () => {
    expect(planOrderDiscount(lines, 50, 'PLN')).toBeNull();
    expect(planOrderDiscount(lines, 0, 'PLN')).toBeNull();
    expect(planOrderDiscount([], 1, 'PLN')).toBeNull();
  });
});

describe('applyDiscountToLines', () => {
  it('should round each unit price to the minor unit and move price only on a gross-priced source', () => {
    const discount = { ...stamp, amount: '10', currency: 'JPY', perLine: [] };
    const single = [{ id: 'l1', quantity: 3, price: 100 }];

    expect(applyDiscountToLines(single, discount, 'JPY', true).items[0].price).toBe(97);
    expect(applyDiscountToLines(single, discount, 'JPY', false).items[0].price).toBe(100);
  });

  it('should not move a line that has no share', () => {
    const discount = { ...stamp, amount: '0.01', currency: 'PLN', perLine: [] };
    const out = applyDiscountToLines(lines, discount, 'PLN', true);

    expect(out.items[1]).toBe(lines[1]);
  });

  it('should be a no-op for a missing, zero or undistributable discount', () => {
    expect(applyDiscountToLines(lines, undefined, 'PLN', true).amount).toBe(0);
    expect(applyDiscountToLines(lines, { ...stamp, amount: '0.00', currency: 'PLN', perLine: [] }, 'PLN', true).amount).toBe(0);
    expect(applyDiscountToLines(lines, { ...stamp, amount: '99', currency: 'PLN', perLine: [] }, 'PLN', true).amount).toBe(0);
  });
});

describe('restateTotalsForDiscount', () => {
  it('should lower total, subtotal (gross only) and accumulate discountTotal', () => {
    const totals = { total: 50, subtotal: 50, currency: 'PLN', discountTotal: 1 };

    expect(restateTotalsForDiscount(totals, 10, true)).toEqual({
      total: 40,
      subtotal: 40,
      currency: 'PLN',
      discountTotal: 11,
    });
    expect(restateTotalsForDiscount(totals, 10, false).subtotal).toBe(50);
    expect(restateTotalsForDiscount(totals, 0, true)).toBe(totals);
  });
});

describe('discountedUnitPriceGross', () => {
  it('should compute the absolute price from the channel line, so a removed discount restores it', () => {
    const channel = { id: 'l1', quantity: 3, price: 10 };

    expect(discountedUnitPriceGross(channel, 6, 'PLN')).toBe(8);
    expect(discountedUnitPriceGross(channel, 0, 'PLN')).toBe(10);
    expect(discountedUnitPriceGross({ id: 'l1', quantity: 3, price: 100 }, 10, 'JPY')).toBe(97);
  });
});

describe('readOrderDiscountEdit', () => {
  it('should coerce a persisted value and read anything malformed as no discount', () => {
    expect(readOrderDiscountEdit(null)).toBeUndefined();
    expect(readOrderDiscountEdit({ ...stamp, amount: 'x', currency: 'PLN' })).toBeUndefined();
    expect(readOrderDiscountEdit({ ...stamp, amount: '1.00' })).toBeUndefined();
    expect(readOrderDiscountEdit({ ...stamp, amount: '1.00', currency: 'PLN' })?.perLine).toEqual([]);
  });

  it('should read a zero discount as no effective discount', () => {
    expect(effectiveDiscountAmount(readOrderDiscountEdit({ ...stamp, amount: '0.00', currency: 'PLN' }))).toBe(0);
    expect(effectiveDiscountAmount(undefined)).toBe(0);
  });
});

describe('helpers', () => {
  it('should read decimals strictly and count their places', () => {
    expect(isDecimalAmountText('12.50')).toBe(true);
    for (const bad of ['-1', '1e3', '1,5', '', ' 1', '1.']) {
      expect(isDecimalAmountText(bad)).toBe(false);
    }
    expect(decimalPlaces('12.50')).toBe(2);
    expect(decimalPlaces('12')).toBe(0);
    expect(goodsGrossValue(lines)).toBe(50);
  });
});
