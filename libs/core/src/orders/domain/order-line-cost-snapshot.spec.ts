/**
 * orderLineCostSnapshot Unit Tests (#3588)
 *
 * @module libs/core/src/orders/domain
 */
import {
  carryForwardLineCosts,
  NOT_RECORDED_LINE_COST,
  recordedLineCost,
  type LineCostSnapshot,
  type PriorLineCostRow,
} from './order-line-cost-snapshot';

const rec = (amount: string): LineCostSnapshot =>
  recordedLineCost({ unitCostNet: amount, currency: 'PLN' });

const draft = (
  lineNumber: number,
  productId: string,
  variantId: string | null,
  cost: LineCostSnapshot
) => ({ lineNumber, productId, variantId, cost });

const prior = (
  lineNumber: number,
  productId: string,
  variantId: string | null,
  cost: LineCostSnapshot
): PriorLineCostRow => ({ lineNumber, productId, variantId, ...cost });

describe('carryForwardLineCosts', () => {
  it('should keep per-variant cost when the lines are reordered', () => {
    const result = carryForwardLineCosts(
      [prior(0, 'p1', 'v1', rec('1.0000')), prior(1, 'p2', 'v2', rec('2.0000'))],
      [
        draft(0, 'p2', 'v2', rec('9.0000')),
        draft(1, 'p1', 'v1', rec('9.0000')),
      ]
    );

    expect(result[0].cost.unitCostNet).toBe('2.0000');
    expect(result[1].cost.unitCostNet).toBe('1.0000');
  });

  it('should not touch the snapshot when only the quantity changes', () => {
    const result = carryForwardLineCosts(
      [prior(0, 'p1', 'v1', rec('1.0000'))],
      [{ ...draft(0, 'p1', 'v1', rec('7.0000')), quantity: 5 }]
    );

    expect(result[0].cost.unitCostNet).toBe('1.0000');
    expect(result[0].quantity).toBe(5);
  });

  it('should drop a removed line and give a new line the candidate cost', () => {
    const result = carryForwardLineCosts(
      [prior(0, 'p1', 'v1', rec('1.0000')), prior(1, 'p2', 'v2', rec('2.0000'))],
      [draft(0, 'p1', 'v1', rec('9.0000')), draft(1, 'p3', 'v3', rec('3.0000'))]
    );

    expect(result).toHaveLength(2);
    expect(result[1].cost.unitCostNet).toBe('3.0000');
  });

  it('should treat a remapped variant as a new key and take the candidate', () => {
    const result = carryForwardLineCosts(
      [prior(0, 'p1', 'v1', rec('1.0000'))],
      [draft(0, 'p1', 'v1b', rec('6.0000'))]
    );

    expect(result[0].cost.unitCostNet).toBe('6.0000');
  });

  it('should let the lowest prior lineNumber win for two lines of the same variant', () => {
    const result = carryForwardLineCosts(
      [prior(2, 'p1', 'v1', rec('8.0000')), prior(0, 'p1', 'v1', rec('1.0000'))],
      [draft(0, 'p1', 'v1', rec('9.0000')), draft(1, 'p1', 'v1', rec('9.0000'))]
    );

    expect(result.map((r) => r.cost.unitCostNet)).toEqual(['1.0000', '1.0000']);
  });

  it('should never upgrade a prior not-recorded line to a now-available cost', () => {
    const result = carryForwardLineCosts(
      [prior(0, 'p1', 'v1', NOT_RECORDED_LINE_COST)],
      [draft(0, 'p1', 'v1', rec('5.0000'))]
    );

    expect(result[0].cost).toEqual(NOT_RECORDED_LINE_COST);
  });

  it('should never replace a prior recorded cost with a changed candidate', () => {
    const result = carryForwardLineCosts(
      [prior(0, 'p1', 'v1', rec('1.0000'))],
      [draft(0, 'p1', 'v1', rec('5.0000'))]
    );

    expect(result[0].cost).toEqual(rec('1.0000'));
  });

  it('should key a product-only line by productId and an empty variant', () => {
    const result = carryForwardLineCosts(
      [prior(0, 'p1', null, NOT_RECORDED_LINE_COST)],
      [draft(0, 'p1', null, NOT_RECORDED_LINE_COST)]
    );

    expect(result[0].cost.costState).toBe('not-recorded');
  });

  it('should keep pre-feature rows (default not-recorded) not-recorded', () => {
    const preFeature: PriorLineCostRow = {
      lineNumber: 0,
      productId: 'p1',
      variantId: 'v1',
      costState: 'not-recorded',
      unitCostNet: null,
      unitCostCurrency: null,
    };

    const result = carryForwardLineCosts([preFeature], [draft(0, 'p1', 'v1', rec('5.0000'))]);

    expect(result[0].cost.costState).toBe('not-recorded');
  });
});
