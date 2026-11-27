import { describe, expect, it } from 'vitest';
import { splitBundlePrice } from './bundle-price-split';

describe('splitBundlePrice', () => {
  it('should share the bundle price in proportion to the standalone prices', () => {
    const result = splitBundlePrice(60, [
      { variantId: 'a', quantity: 1, standalonePrice: 30 },
      { variantId: 'b', quantity: 1, standalonePrice: 30 },
    ]);
    expect(result).toEqual({
      kind: 'ok',
      lines: [
        { variantId: 'a', amount: 30 },
        { variantId: 'b', amount: 30 },
      ],
    });
  });

  it('should weigh a component by its quantity', () => {
    const result = splitBundlePrice(90, [
      { variantId: 'a', quantity: 2, standalonePrice: 30 },
      { variantId: 'b', quantity: 1, standalonePrice: 30 },
    ]);
    expect(result.kind === 'ok' && result.lines.map((l) => l.amount)).toEqual([60, 30]);
  });

  it('should give the rounding remainder to the largest component so the parts add up', () => {
    const result = splitBundlePrice(10, [
      { variantId: 'a', quantity: 1, standalonePrice: 1 },
      { variantId: 'b', quantity: 1, standalonePrice: 1 },
      { variantId: 'c', quantity: 1, standalonePrice: 1 },
    ]);
    if (result.kind !== 'ok') throw new Error('expected a split');
    const total = result.lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0);
    expect(total).toBe(1000);
    expect(result.lines.map((l) => l.amount)).toEqual([3.34, 3.33, 3.33]);
  });

  it('should leave a gift out of the split', () => {
    const result = splitBundlePrice(50, [
      { variantId: 'a', quantity: 1, standalonePrice: 40 },
      { variantId: 'gift', quantity: 1, standalonePrice: 10, giftSlot: true },
    ]);
    expect(result).toEqual({
      kind: 'ok',
      lines: [
        { variantId: 'a', amount: 50 },
        { variantId: 'gift', amount: 0 },
      ],
    });
  });

  it('should refuse to split when a paid component has no known price', () => {
    expect(
      splitBundlePrice(50, [
        { variantId: 'a', quantity: 1, standalonePrice: 40 },
        { variantId: 'b', quantity: 1, standalonePrice: null },
      ]),
    ).toEqual({ kind: 'unknown-component-price', variantIds: ['b'] });
  });

  it('should say when there is no bundle price or nothing to pay for', () => {
    expect(splitBundlePrice(null, [{ variantId: 'a', quantity: 1, standalonePrice: 1 }])).toEqual({
      kind: 'no-price',
    });
    expect(
      splitBundlePrice(10, [{ variantId: 'a', quantity: 1, standalonePrice: 1, giftSlot: true }]),
    ).toEqual({ kind: 'no-paid-component' });
  });
});
