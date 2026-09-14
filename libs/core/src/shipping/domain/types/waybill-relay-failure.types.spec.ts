/**
 * Waybill Relay Failure Types — Unit Tests (#2073)
 *
 * @module libs/core/src/shipping/domain/types
 */
import {
  isWaybillRelayStuck,
  readWaybillRelayFailureReason,
  resolveWaybillRelayAlertThreshold,
  WaybillRelayFailureReasonValues,
  type WaybillRelayFailure,
} from './waybill-relay-failure.types';

const failure = (count: number): WaybillRelayFailure => ({
  count,
  firstFailedAt: new Date('2026-05-19T10:00:00Z'),
  lastFailedAt: new Date('2026-05-19T12:00:00Z'),
  reason: 'rejected',
  connectionId: '00000000-0000-0000-0000-0000000000aa',
});

describe('resolveWaybillRelayAlertThreshold', () => {
  it('should default to 3 when the variable is unset', () => {
    expect(resolveWaybillRelayAlertThreshold(undefined)).toBe(3);
  });

  it('should default when the variable is empty or blank', () => {
    expect(resolveWaybillRelayAlertThreshold('')).toBe(3);
    expect(resolveWaybillRelayAlertThreshold('   ')).toBe(3);
  });

  it('should default when the variable is not a number', () => {
    // A mistyped env var must not take the shipments list down, and must not
    // silently resolve to NaN — which would make every comparison false and
    // quietly switch the escalation off.
    expect(resolveWaybillRelayAlertThreshold('three')).toBe(3);
    expect(resolveWaybillRelayAlertThreshold('Infinity')).toBe(3);
  });

  it('should honour a value inside the supported range', () => {
    expect(resolveWaybillRelayAlertThreshold('5')).toBe(5);
    expect(resolveWaybillRelayAlertThreshold('2')).toBe(2);
  });

  it('should clamp a threshold of 1 up to 2 so a single blip can never escalate', () => {
    // THE load-bearing clamp (#2073 AC-4). Without it an operator could set 1
    // and turn every transient failure into an alarm — the lower bound makes
    // that unreachable rather than merely not the default.
    expect(resolveWaybillRelayAlertThreshold('1')).toBe(2);
    expect(resolveWaybillRelayAlertThreshold('0')).toBe(2);
    expect(resolveWaybillRelayAlertThreshold('-7')).toBe(2);
  });

  it('should clamp an absurdly large threshold to the ceiling', () => {
    expect(resolveWaybillRelayAlertThreshold('100000')).toBe(100);
  });

  it('should truncate a fractional value rather than rejecting it', () => {
    expect(resolveWaybillRelayAlertThreshold('4.9')).toBe(4);
  });
});

describe('readWaybillRelayFailureReason', () => {
  it.each(WaybillRelayFailureReasonValues)('should accept the known reason %s', (reason) => {
    expect(readWaybillRelayFailureReason(reason)).toBe(reason);
  });

  it('should read an unrecognised stored value as absent, never assert it onward', () => {
    // The column is plain `text`. A value written by a future build, or by
    // hand, must reach the frontend as "no reason recorded" rather than as a
    // reason it cannot render.
    expect(readWaybillRelayFailureReason('no-capability')).toBeNull();
    expect(readWaybillRelayFailureReason('')).toBeNull();
    expect(readWaybillRelayFailureReason(null)).toBeNull();
    expect(readWaybillRelayFailureReason(undefined)).toBeNull();
    expect(readWaybillRelayFailureReason(7)).toBeNull();
    expect(readWaybillRelayFailureReason({ reason: 'rejected' })).toBeNull();
  });
});

describe('isWaybillRelayStuck', () => {
  it('should report a shipment with no failure history as not stuck', () => {
    expect(isWaybillRelayStuck(null, 3)).toBe(false);
  });

  it('should not escalate below the threshold', () => {
    expect(isWaybillRelayStuck(failure(1), 3)).toBe(false);
    expect(isWaybillRelayStuck(failure(2), 3)).toBe(false);
  });

  it('should escalate at the threshold and above', () => {
    // Inclusive: N consecutive failures IS the condition, not N + 1.
    expect(isWaybillRelayStuck(failure(3), 3)).toBe(true);
    expect(isWaybillRelayStuck(failure(40), 3)).toBe(true);
  });
});
