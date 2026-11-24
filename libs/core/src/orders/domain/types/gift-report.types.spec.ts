import { bucketGiftCosts, summarizeGiftReport, type GiftReportEntry } from './gift-report.types';

function entry(overrides: Partial<GiftReportEntry>): GiftReportEntry {
  return {
    internalOrderId: 'o1',
    orderNumber: null,
    placedAt: null,
    sourceConnectionId: 'c1',
    customerId: null,
    currency: 'PLN',
    lineId: 'l1',
    origin: 'line',
    giftSource: 'ol-rule',
    ruleRef: 'r1',
    documentForm: null,
    productId: 'p1',
    variantId: 'v1',
    sku: 'SKU',
    name: 'Gift',
    quantity: 1,
    paidGross: 0,
    unitCostNet: 2,
    totalCostNet: 2,
    costBasis: 'catalogue',
    ...overrides,
  };
}

describe('summarizeGiftReport', () => {
  it('should group per promotion and gift and count orders once', () => {
    const summary = summarizeGiftReport([
      entry({ internalOrderId: 'o1', quantity: 2, totalCostNet: 4 }),
      entry({ internalOrderId: 'o1', lineId: 'l2', quantity: 1, totalCostNet: 2 }),
      entry({ internalOrderId: 'o2', quantity: 1, totalCostNet: 2 }),
    ]);
    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0]).toMatchObject({ units: 4, orders: 2, costNet: 8, unknownCostUnits: 0 });
  });

  it('should keep an unknown cost out of the amount and count its units, never as zero', () => {
    const summary = summarizeGiftReport([
      entry({ quantity: 3, totalCostNet: null, unitCostNet: null, costBasis: 'unknown' }),
      entry({ internalOrderId: 'o2', quantity: 1, totalCostNet: 2 }),
    ]);
    expect(summary.totals).toEqual([
      { currency: 'PLN', orders: 2, units: 4, paidGross: 0, costNet: 2, unknownCostUnits: 3 },
    ]);
  });

  it('should separate a rule gift from a manual one of the same product', () => {
    const summary = summarizeGiftReport([
      entry({}),
      entry({ giftSource: 'operator', ruleRef: null, internalOrderId: 'o2' }),
    ]);
    expect(summary.groups.map((g) => g.giftSource).sort()).toEqual(['ol-rule', 'operator']);
  });

  it('should never add costs across currencies', () => {
    const summary = summarizeGiftReport([
      entry({}),
      entry({ currency: 'EUR', internalOrderId: 'o2', totalCostNet: 5 }),
    ]);
    expect(summary.totals.map((t) => [t.currency, t.costNet]).sort()).toEqual([
      ['EUR', 5],
      ['PLN', 2],
    ]);
  });

  it('should answer nothing for no entries', () => {
    expect(summarizeGiftReport([])).toEqual({ groups: [], totals: [] });
  });

  it('should count an order with gifts from two promotions once in the totals', () => {
    const summary = summarizeGiftReport([
      entry({ internalOrderId: 'o1' }),
      entry({ internalOrderId: 'o1', ruleRef: 'r2', variantId: 'v2' }),
    ]);
    expect(summary.groups.map((g) => g.orders)).toEqual([1, 1]);
    expect(summary.totals[0].orders).toBe(1);
  });

  it('should list each channel that sent a gift once, sorted', () => {
    const summary = summarizeGiftReport([
      entry({ sourceConnectionId: 'c2' }),
      entry({ internalOrderId: 'o2', sourceConnectionId: 'c1' }),
      entry({ internalOrderId: 'o3', sourceConnectionId: 'c1' }),
    ]);
    expect(summary.groups[0].sourceConnectionIds).toEqual(['c1', 'c2']);
  });
});

describe('bucketGiftCosts', () => {
  const day = 24 * 60 * 60 * 1000;
  const from = new Date('2026-10-12T00:00:00.000Z');
  const at = (days: number): Date => new Date(from.getTime() + days * day + 1000);

  it('should bucket a long range by week counted from its start and mark the open last bucket', () => {
    const [series] = bucketGiftCosts(
      [
        entry({ placedAt: at(1), totalCostNet: 4, quantity: 2 }),
        entry({ placedAt: at(8), totalCostNet: 3 }),
        entry({ placedAt: at(29), totalCostNet: 1 }),
      ],
      from,
      new Date(from.getTime() + 30 * day)
    );
    expect(series.granularity).toBe('week');
    expect(series.points).toHaveLength(5);
    expect(series.points.map((p) => p.costNet)).toEqual([4, 3, 0, 0, 1]);
    expect(series.points[0].units).toBe(2);
    expect(series.points.map((p) => p.partial)).toEqual([false, false, false, false, true]);
  });

  it('should bucket a short range by day and keep an unknown cost out of the amount', () => {
    const [series] = bucketGiftCosts(
      [entry({ placedAt: at(0), totalCostNet: null, unitCostNet: null, quantity: 3 })],
      from,
      new Date(from.getTime() + 7 * day)
    );
    expect(series.granularity).toBe('day');
    expect(series.points).toHaveLength(7);
    expect(series.points[0]).toMatchObject({ costNet: 0, units: 3, unknownCostUnits: 3 });
  });

  it('should keep a series per currency and skip undated or out-of-range entries', () => {
    const series = bucketGiftCosts(
      [
        entry({ placedAt: at(1) }),
        entry({ placedAt: at(1), currency: 'EUR', totalCostNet: 9 }),
        entry({ placedAt: null }),
        entry({ placedAt: new Date(from.getTime() - day) }),
      ],
      from,
      new Date(from.getTime() + 7 * day)
    );
    expect(series.map((s) => s.currency).sort()).toEqual(['EUR', 'PLN']);
    expect(series.find((s) => s.currency === 'PLN')?.points[1].costNet).toBe(2);
  });

  it('should answer nothing for an empty range', () => {
    expect(bucketGiftCosts([], from, from)).toEqual([]);
  });
});
