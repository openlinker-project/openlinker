/**
 * Gift rule results tests (#3935)
 */
import { describe, expect, it } from 'vitest';
import type { GiftReportGroup } from '../../gift-report';
import { averageUnitCost, summarisePromotionResults } from './promotion-stats';

const group = (over: Partial<GiftReportGroup>): GiftReportGroup => ({
  key: 'k',
  giftSource: 'rule',
  ruleRef: 'r1',
  ruleName: 'n',
  productId: 'p',
  variantId: 'v',
  sku: null,
  name: null,
  currency: 'PLN',
  units: 10,
  orders: 8,
  paidGross: 0,
  costNet: 40,
  unknownCostUnits: 0,
  ...over,
});

describe('summarisePromotionResults', () => {
  it('should sum only the groups of the named promotion', () => {
    const results = summarisePromotionResults(
      [group({}), group({ units: 5, orders: 4, costNet: 20 }), group({ ruleRef: 'r2', units: 99 })],
      'r1',
    );

    expect(results.units).toBe(15);
    expect(results.orders).toBe(12);
    expect(results.costs).toEqual([{ currency: 'PLN', costNet: 60 }]);
  });

  it('should ignore manual gifts and keep currencies apart', () => {
    const results = summarisePromotionResults(
      [group({}), group({ giftSource: 'manual', units: 7 }), group({ currency: 'EUR', costNet: 3 })],
      null,
    );

    expect(results.units).toBe(20);
    expect(results.costs).toEqual([
      { currency: 'PLN', costNet: 40 },
      { currency: 'EUR', costNet: 3 },
    ]);
  });

  it('should carry the pieces that have no purchase cost', () => {
    expect(summarisePromotionResults([group({ unknownCostUnits: 4 })], 'r1').unknownCostUnits).toBe(4);
  });
});

describe('averageUnitCost', () => {
  it('should divide the cost by the units, and say nothing when none were given', () => {
    expect(averageUnitCost(summarisePromotionResults([group({})], 'r1'))).toEqual([
      { currency: 'PLN', costNet: 4 },
    ]);
    expect(averageUnitCost(summarisePromotionResults([], 'r1'))).toBeNull();
  });
});
