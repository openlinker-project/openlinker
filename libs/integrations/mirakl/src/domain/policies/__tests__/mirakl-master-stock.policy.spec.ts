/**
 * Mirakl Master Stock Policy: unit tests (#4284)
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import {
  computeMiraklStockTarget,
  MIRAKL_PENDING_STOCK_TRUST_MS,
  readMiraklOfferQuantity,
  resolveMiraklCurrentStock,
} from '../mirakl-master-stock.policy';

const NOW = new Date('2026-11-23T12:00:00.000Z');

function pending(
  ageMs: number,
  target = 7
): { target: number; importId: string; submittedAt: string } {
  return { target, importId: '1', submittedAt: new Date(NOW.getTime() - ageMs).toISOString() };
}

describe('resolveMiraklCurrentStock', () => {
  it('should read OF21 when nothing is pending', () => {
    expect(resolveMiraklCurrentStock(10, null, NOW)).toBe(10);
  });

  it('should read the pending target while it is fresh', () => {
    expect(resolveMiraklCurrentStock(10, pending(5_000), NOW)).toBe(7);
  });

  it('should read OF21 once the pending target is older than the trust window', () => {
    expect(resolveMiraklCurrentStock(9, pending(MIRAKL_PENDING_STOCK_TRUST_MS + 1), NOW)).toBe(9);
  });

  it('should read OF21 when the pending timestamp is unreadable or in the future', () => {
    expect(
      resolveMiraklCurrentStock(9, { target: 1, importId: '1', submittedAt: 'garbage' }, NOW)
    ).toBe(9);
    expect(resolveMiraklCurrentStock(9, pending(-60_000), NOW)).toBe(9);
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
