import { summarizeGiftReport, type GiftReportEntry } from './gift-report.types';

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
      { currency: 'PLN', units: 4, paidGross: 0, costNet: 2, unknownCostUnits: 3 },
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
});
