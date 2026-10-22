/**
 * Sale-Decrement Reconcile Sweep - domain rule tests (#3629)
 *
 * Pins the single resolution path for the grace window: default, clamp on both
 * ends, and fall-back for a malformed value.
 */

import {
  resolveSaleDecrementReconcileGraceMs,
  resolveSaleDecrementReconcileLookbackMs,
} from '../fulfillment-sale-decrement-reconcile.types';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

describe('resolveSaleDecrementReconcileGraceMs', () => {
  it('should return the 10 minute default when the value is absent', () => {
    expect(resolveSaleDecrementReconcileGraceMs(undefined)).toBe(10 * MINUTE_MS);
  });

  it.each(['', 'abc', 'NaN', 'Infinity', '0', '-5'])(
    'should fall back to the default when the value is malformed (%p)',
    (raw) => {
      expect(resolveSaleDecrementReconcileGraceMs(raw)).toBe(10 * MINUTE_MS);
    }
  );

  it('should honour a value inside the bounds', () => {
    expect(resolveSaleDecrementReconcileGraceMs(String(30 * MINUTE_MS))).toBe(30 * MINUTE_MS);
  });

  it('should clamp a value below one minute up to one minute', () => {
    expect(resolveSaleDecrementReconcileGraceMs('1000')).toBe(MINUTE_MS);
  });

  it('should clamp a value above 24 hours down to 24 hours', () => {
    expect(resolveSaleDecrementReconcileGraceMs(String(72 * 60 * MINUTE_MS))).toBe(
      24 * 60 * MINUTE_MS
    );
  });
});

describe('resolveSaleDecrementReconcileLookbackMs', () => {
  it('should return the 7 day default when the value is absent or malformed', () => {
    expect(resolveSaleDecrementReconcileLookbackMs(undefined)).toBe(7 * DAY_MS);
    expect(resolveSaleDecrementReconcileLookbackMs('abc')).toBe(7 * DAY_MS);
    expect(resolveSaleDecrementReconcileLookbackMs('-1')).toBe(7 * DAY_MS);
  });

  it('should honour a value inside the bounds', () => {
    expect(resolveSaleDecrementReconcileLookbackMs(String(3 * DAY_MS))).toBe(3 * DAY_MS);
  });

  it('should clamp to one hour at the bottom', () => {
    expect(resolveSaleDecrementReconcileLookbackMs('1000')).toBe(60 * MINUTE_MS);
  });

  it('should clamp to 14 days at the top, below the 30 day sync_jobs retention', () => {
    const clamped = resolveSaleDecrementReconcileLookbackMs(String(90 * DAY_MS));

    expect(clamped).toBe(14 * DAY_MS);
    expect(clamped).toBeLessThan(30 * DAY_MS);
  });
});
