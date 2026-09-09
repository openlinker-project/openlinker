/**
 * Dispatch-Relay Reconcile pure rules — spec (#2728)
 *
 * @module libs/core/src/fulfillment/domain/types/__tests__
 */
import {
  describeFulfillmentRelayStuck,
  isFulfillmentRelayStuck,
  resolveFulfillmentRelayGraceMs,
  resolveFulfillmentRelayStuckAfterMs,
} from '../fulfillment-relay-reconcile.types';

describe('resolveFulfillmentRelayGraceMs', () => {
  it('should return the 15-minute default when the value is absent', () => {
    expect(resolveFulfillmentRelayGraceMs(undefined)).toBe(900_000);
  });

  it.each([['not-a-number'], [''], ['0'], ['-1'], ['NaN'], ['Infinity']])(
    'should fall back to the default rather than throwing when the value is %p',
    (raw) => {
      // A malformed env var must not wedge a sweep — the
      // `resolveFulfillmentDispatchTimeoutMs` / `resolveSweepLockTtlMs` idiom.
      expect(resolveFulfillmentRelayGraceMs(raw)).toBe(900_000);
    }
  );

  it('should clamp UP to the one-minute floor when the value is below it', () => {
    // The floor is the safety bound: below it the sweep spends outbound adapter
    // calls racing relays that are still in flight.
    expect(resolveFulfillmentRelayGraceMs('1000')).toBe(60_000);
  });

  it('should clamp DOWN to one day when the value is above it', () => {
    expect(resolveFulfillmentRelayGraceMs('999999999')).toBe(86_400_000);
  });

  it('should honour a value inside the band', () => {
    expect(resolveFulfillmentRelayGraceMs('300000')).toBe(300_000);
  });
});

describe('resolveFulfillmentRelayStuckAfterMs', () => {
  it('should return the 24-hour default when the value is absent', () => {
    expect(resolveFulfillmentRelayStuckAfterMs(undefined)).toBe(86_400_000);
  });

  it('should clamp UP to the one-hour floor when the value is below it', () => {
    // Below an hour the escalation fires on candidates a single transient
    // outage produced, which is the "an alert that fires on a healthy install
    // is worse than no alert" failure.
    expect(resolveFulfillmentRelayStuckAfterMs('60000')).toBe(3_600_000);
  });

  it('should clamp DOWN to ninety days when the value is above it', () => {
    expect(resolveFulfillmentRelayStuckAfterMs('99999999999')).toBe(7_776_000_000);
  });

  it('should fall back to the default when the value is non-finite', () => {
    expect(resolveFulfillmentRelayStuckAfterMs('abc')).toBe(86_400_000);
  });

  it('should resolve INDEPENDENTLY of the grace window', () => {
    // No ordering between the two bounds is enforced, deliberately: coupling the
    // clamps would silently rewrite one operator-set number from the other,
    // which is the reported-versus-enforced gap #2229 exists to close. A stuck
    // age below the grace window is noisy and harmless — it changes what is
    // logged, never what is re-driven.
    expect(resolveFulfillmentRelayStuckAfterMs('3600000')).toBe(3_600_000);
    expect(resolveFulfillmentRelayGraceMs('86400000')).toBe(86_400_000);
  });
});

describe('isFulfillmentRelayStuck', () => {
  const now = new Date('2026-09-08T12:00:00.000Z');

  it('should report stuck when the work shipped longer ago than the bound', () => {
    const shippedAt = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    expect(isFulfillmentRelayStuck(shippedAt, now, 86_400_000)).toBe(true);
  });

  it('should NOT report stuck exactly at the bound', () => {
    // Strictly greater than — the conservative direction for a signal whose
    // whole purpose is to be believed.
    const shippedAt = new Date(now.getTime() - 86_400_000);
    expect(isFulfillmentRelayStuck(shippedAt, now, 86_400_000)).toBe(false);
  });

  it('should not report stuck when the work shipped inside the bound', () => {
    const shippedAt = new Date(now.getTime() - 60_000);
    expect(isFulfillmentRelayStuck(shippedAt, now, 86_400_000)).toBe(false);
  });

  it('should not report stuck for a future instant', () => {
    const shippedAt = new Date(now.getTime() + 60_000);
    expect(isFulfillmentRelayStuck(shippedAt, now, 86_400_000)).toBe(false);
  });

  it('should mutate neither argument', () => {
    const shippedAt = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const shippedAtMs = shippedAt.getTime();
    const nowMs = now.getTime();
    isFulfillmentRelayStuck(shippedAt, now, 86_400_000);
    expect(shippedAt.getTime()).toBe(shippedAtMs);
    expect(now.getTime()).toBe(nowMs);
  });
});

describe('describeFulfillmentRelayStuck', () => {
  it('should render hours below two days', () => {
    expect(describeFulfillmentRelayStuck(86_400_000)).toBe(
      'The source has not been told this work dispatched, 24 hours after it shipped'
    );
  });

  it('should render days at two days and above', () => {
    expect(describeFulfillmentRelayStuck(7 * 86_400_000)).toBe(
      'The source has not been told this work dispatched, 7 days after it shipped'
    );
  });

  it('should carry a duration and nothing else, so it is PII-free by construction', () => {
    const sentence = describeFulfillmentRelayStuck(86_400_000);
    expect(sentence).not.toMatch(/@/);
    expect(sentence).toMatch(/^[A-Za-z0-9 ,.]+$/);
  });
});
