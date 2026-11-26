/**
 * Mirakl Master Stock Policy: unit tests (#4284)
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import {
  computeMiraklStockTarget,
  readMiraklOfferQuantity,
  resolveMiraklCurrentStock,
} from '../mirakl-master-stock.policy';

describe('resolveMiraklCurrentStock', () => {
  it('should read OF21 when nothing is queued', () => {
    expect(resolveMiraklCurrentStock(10, null)).toBe(10);
  });

  it('should read a queued or sent target that Mirakl has not settled yet', () => {
    expect(resolveMiraklCurrentStock(10, { status: 'pending', value: '7' })).toBe(7);
    expect(resolveMiraklCurrentStock(10, { status: 'submitted', value: '6' })).toBe(6);
  });

  it('should read OF21 once the write is settled, either way', () => {
    expect(resolveMiraklCurrentStock(9, { status: 'applied', value: '7' })).toBe(9);
    expect(resolveMiraklCurrentStock(9, { status: 'failed', value: '7' })).toBe(9);
  });

  it('should read OF21 when the queued value is not a quantity', () => {
    expect(resolveMiraklCurrentStock(9, { status: 'pending', value: 'abc' })).toBe(9);
  });
});

describe('computeMiraklStockTarget', () => {
  it('should add the delta', () => {
    expect(computeMiraklStockTarget(10, -3)).toEqual({ target: 7, clamped: false });
    expect(computeMiraklStockTarget(10, 2)).toEqual({ target: 12, clamped: false });
  });

  it('should clamp at zero and say so', () => {
    expect(computeMiraklStockTarget(2, -5)).toEqual({ target: 0, clamped: true });
  });
});

describe('readMiraklOfferQuantity', () => {
  it('should read a missing or invalid quantity as zero', () => {
    expect(readMiraklOfferQuantity(undefined)).toBe(0);
    expect(readMiraklOfferQuantity(Number.NaN)).toBe(0);
    expect(readMiraklOfferQuantity(-1)).toBe(0);
    expect(readMiraklOfferQuantity(4)).toBe(4);
  });
});
