/**
 * Distributing an order-level discount (#3365 audit).
 *
 * Allegro reduces the ORDER total and touches no line price, so a ZK built from
 * the lines alone recorded MORE than the buyer paid. These cases pin the two
 * properties that make the split safe to write to an ERP: the parts sum back
 * exactly, and the function refuses rather than inventing an answer.
 */
import { distributeOrderDiscount } from './order-discount-split.types';

describe('distributeOrderDiscount', () => {
  it('cuts the discount so the parts sum to the buyer-paid total, exactly', () => {
    const split = distributeOrderDiscount([100, 50, 25], 35, 2);
    expect(split).not.toBeNull();
    const paid = split!.reduce((sum, line) => sum + line.grossTotalAfterDiscount, 0);
    expect(Math.round(paid * 100)).toBe(Math.round((175 - 35) * 100));
  });

  // The remainder must land somewhere, and on the largest line it is least
  // visible and cannot push a small line negative.
  it('places an indivisible remainder on the largest line', () => {
    const split = distributeOrderDiscount([100, 0.02], 0.01, 2)!;
    const paid = split.reduce((sum, line) => sum + line.grossTotalAfterDiscount, 0);
    expect(Math.round(paid * 100)).toBe(Math.round(100.01 * 100));
    expect(split[1].grossTotalAfterDiscount).toBe(0.02);
  });

  it('keeps each line as listed in grossTotal', () => {
    const split = distributeOrderDiscount([100, 50], 30, 2)!;
    expect(split.map((l) => l.grossTotal)).toEqual([100, 50]);
  });

  // `null` means "bill as listed" - the behaviour every caller had before this
  // existed - so every refusal must be a case where distributing would be a
  // guess rather than a division.
  it.each([
    ['no discount', [100, 50], 0],
    ['a negative discount', [100, 50], -5],
    ['a non-finite discount', [100, 50], Number.NaN],
    ['no lines', [], 10],
    ['a zero line sum', [0, 0], 10],
    ['a discount equal to the whole order', [100], 100],
    ['a discount larger than the order', [100], 150],
  ])('answers nothing for %s', (_label, totals, discount) => {
    expect(distributeOrderDiscount(totals, discount, 2)).toBeNull();
  });

  // Two decimals is false for JPY and for KWD, and the only property this
  // promises is that the parts sum back exactly.
  it('is exact in the currency own smallest unit, not in cents', () => {
    const jpy = distributeOrderDiscount([1000, 500], 300, 0)!;
    const paidJpy = jpy.reduce((sum, line) => sum + line.grossTotalAfterDiscount, 0);
    expect(paidJpy).toBe(1200);

    const kwd = distributeOrderDiscount([10.555, 5.25], 3.125, 3)!;
    const paidKwd = kwd.reduce((sum, line) => sum + line.grossTotalAfterDiscount, 0);
    expect(Math.round(paidKwd * 1000)).toBe(Math.round((10.555 + 5.25 - 3.125) * 1000));
  });

  it('never drives a line below zero', () => {
    const split = distributeOrderDiscount([100, 0.01], 99, 2)!;
    expect(split.every((line) => line.grossTotalAfterDiscount >= 0)).toBe(true);
  });
});
