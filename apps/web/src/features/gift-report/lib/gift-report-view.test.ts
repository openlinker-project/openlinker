import { describe, expect, it } from 'vitest';
import type { GiftReportGroup } from '../api/gift-report.types';
import { groupByGiftProduct, niceAxis } from './gift-report-view';

const group = (over: Partial<GiftReportGroup>): GiftReportGroup => ({
  key: 'k',
  giftSource: 'ol-rule',
  ruleRef: 'r1',
  ruleName: 'Rule',
  productId: 'p1',
  variantId: 'v1',
  sku: 'S',
  name: 'Mug',
  currency: 'PLN',
  units: 2,
  orders: 2,
  paidGross: 0,
  costNet: 8,
  unknownCostUnits: 0,
  sourceConnectionIds: ['c1'],
  ...over,
});

describe('groupByGiftProduct', () => {
  it('should add one gift product across promotions and merge its channels once', () => {
    const rows = groupByGiftProduct([
      group({ key: 'a', sourceConnectionIds: ['c1', 'c2'] }),
      group({ key: 'b', ruleRef: null, giftSource: 'operator', units: 1, orders: 1, costNet: 4, unknownCostUnits: 1, sourceConnectionIds: ['c2'] }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ units: 3, orders: 3, costNet: 12, unknownCostUnits: 1 });
    expect(rows[0].sourceConnectionIds).toEqual(['c1', 'c2']);
  });

  it('should never add across currencies and sort by cost', () => {
    const rows = groupByGiftProduct([group({ costNet: 1 }), group({ currency: 'EUR', costNet: 9 })]);
    expect(rows.map((r) => r.currency)).toEqual(['EUR', 'PLN']);
  });
});

describe('niceAxis', () => {
  it('should reach at least the tallest bar in four round steps', () => {
    expect(niceAxis(98)).toEqual({ top: 100, ticks: [0, 25, 50, 75, 100] });
    expect(niceAxis(0)).toEqual({ top: 20, ticks: [0, 5, 10, 15, 20] });
    expect(niceAxis(801).top).toBe(1000);
  });
});
