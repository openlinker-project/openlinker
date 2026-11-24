import { keptAtStandaloneRefundHint, splitBundleAmount } from './bundle-return-split.domain-service';

describe('splitBundleAmount', () => {
  it('should split proportionally to standalone price and sum exactly to the paid amount', () => {
    const result = splitBundleAmount(100, [
      { variantId: 'a', quantity: 1, unitPrice: 60 },
      { variantId: 'b', quantity: 1, unitPrice: 30 },
      { variantId: 'c', quantity: 1, unitPrice: 30 },
    ]);
    expect(result.status).toBe('split');
    if (result.status !== 'split') return;
    expect(result.shares.reduce((s, x) => s + Math.round(x.shareGross * 100), 0)).toBe(10000);
    expect(result.shares[0].shareGross).toBeGreaterThan(result.shares[1].shareGross);
  });

  it('should give the remainder to the largest component', () => {
    const result = splitBundleAmount(10, [
      { variantId: 'a', quantity: 1, unitPrice: 1 },
      { variantId: 'b', quantity: 1, unitPrice: 1 },
      { variantId: 'big', quantity: 1, unitPrice: 2 },
    ]);
    if (result.status !== 'split') throw new Error('expected split');
    // 10.00 over weights 1:1:2 = 2.50 / 2.50 / 5.00, exact; use an awkward total instead
    const awkward = splitBundleAmount(10.01, [
      { variantId: 'a', quantity: 1, unitPrice: 1 },
      { variantId: 'b', quantity: 1, unitPrice: 1 },
      { variantId: 'big', quantity: 1, unitPrice: 2 },
    ]);
    if (awkward.status !== 'split') throw new Error('expected split');
    expect(awkward.shares.map((s) => s.shareGross)).toEqual([2.5, 2.5, 5.01]);
  });

  it('should fall back to cost when a component has no standalone price', () => {
    const result = splitBundleAmount(10, [
      { variantId: 'a', quantity: 1, unitPrice: 8 },
      { variantId: 'b', quantity: 1, unitCost: 2 },
    ]);
    if (result.status !== 'split') throw new Error('expected split');
    expect(result.shares[1].basis).toBe('cost');
  });

  it('should refuse and name the component when neither price nor cost exists', () => {
    expect(
      splitBundleAmount(10, [
        { variantId: 'a', quantity: 1, unitPrice: 8 },
        { variantId: 'b', quantity: 1 },
      ])
    ).toEqual({ status: 'refused', reason: 'no-price-no-cost', variantIds: ['b'] });
  });

  it('should refuse an empty component list and a negative total', () => {
    expect(splitBundleAmount(10, [])).toMatchObject({ reason: 'no-components' });
    expect(splitBundleAmount(-1, [{ variantId: 'a', quantity: 1, unitPrice: 1 }])).toMatchObject({
      reason: 'bad-total',
    });
  });
});

describe('keptAtStandaloneRefundHint', () => {
  it('should subtract the full price of what the buyer keeps', () => {
    expect(keptAtStandaloneRefundHint(100, 30)).toBe(70);
  });

  it('should never go below zero', () => {
    expect(keptAtStandaloneRefundHint(50, 80)).toBe(0);
  });
});
