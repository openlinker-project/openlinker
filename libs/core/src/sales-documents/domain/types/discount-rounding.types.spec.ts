import { reconcileDiscountRounding } from './discount-rounding.types';

describe('reconcileDiscountRounding', () => {
  const totals = { total: 100.01, currency: 'PLN', discountTotal: 5 };

  it('should move a rounding gap onto a paid single-unit line', () => {
    const lines = [
      { quantity: 1, unitPriceGross: 100 },
      { quantity: 1, unitPriceGross: 0 },
    ];
    expect(reconcileDiscountRounding(lines, 2, totals)[0].unitPriceGross).toBe(100.01);
  });

  it('should never move a rounding gap onto a gift line', () => {
    const lines = [
      { quantity: 1, unitPriceGross: 0.01, isGift: true },
      { quantity: 2, unitPriceGross: 50 },
    ];
    const result = reconcileDiscountRounding(lines, 2, { ...totals, total: 100.01 });
    expect(result[0]).toEqual({ quantity: 1, unitPriceGross: 0.01, isGift: true });
    const sum = result.reduce((n, l) => n + Math.round(l.quantity * l.unitPriceGross * 100), 0);
    expect(sum).toBe(10001);
  });
});
