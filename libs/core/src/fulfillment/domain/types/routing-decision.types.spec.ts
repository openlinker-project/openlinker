/**
 * Routing Decision vocabulary specs (#2394).
 *
 * @module libs/core/src/fulfillment/domain/types
 */
import {
  deriveRouteIdempotencyKey,
  isRoutingDecisionAbandonReason,
  isRoutingDecisionState,
  readRoutingDecisionAbandonReason,
  RoutingDecisionAbandonReasonValues,
  RoutingDecisionStateValues,
} from './routing-decision.types';

describe('RoutingDecisionState', () => {
  it('should declare exactly one live state and two terminal states', () => {
    expect([...RoutingDecisionStateValues]).toEqual(['live', 'committed', 'abandoned']);
  });

  it('should narrow every declared member and reject anything else', () => {
    for (const value of RoutingDecisionStateValues) {
      expect(isRoutingDecisionState(value)).toBe(true);
    }
    expect(isRoutingDecisionState('pending')).toBe(false);
    expect(isRoutingDecisionState(undefined)).toBe(false);
  });
});

describe('RoutingDecisionAbandonReason', () => {
  it('should declare only reasons grounded in shipped code', () => {
    // #2393 ships `PendingRoutingPlanNotSupportedError` and
    // `checkRoutingPlanConservesQuantities`; #2395 adds the two Wave-3a
    // refusals of a plan that cannot be committed whole.
    expect([...RoutingDecisionAbandonReasonValues]).toEqual([
      'plan-pending',
      'plan-not-conserving',
      'plan-carries-holds',
      'plan-carries-unfulfillable',
    ]);
  });

  it('should NOT declare a reason for a timeout or a throwing route()', () => {
    // The finding of #2395, pinned so it cannot be undone by someone adding the
    // "obviously missing" member. A timeout is IN-DOUBT, not nothing-happened:
    // `abandoned` leaves the live partial-unique index, so a re-route mints a
    // new decision id and therefore a NEW idempotency key that the vendor cannot
    // dedup against a first call which may still be committing — two plans, two
    // shipments. In-doubt leaves the decision `live` instead.
    expect([...RoutingDecisionAbandonReasonValues]).not.toContain('router-timeout');
    expect([...RoutingDecisionAbandonReasonValues]).not.toContain('router-failed');
  });

  it('should read an unrecognised persisted value as absent rather than throwing', () => {
    // The #2100 rule: a value written by a NEWER build (#2395 widens this union
    // with no migration) must read as absent on an older one, never crash it.
    expect(readRoutingDecisionAbandonReason('lock-lost')).toBeNull();
    expect(readRoutingDecisionAbandonReason(null)).toBeNull();
    expect(readRoutingDecisionAbandonReason('plan-pending')).toBe('plan-pending');
    expect(isRoutingDecisionAbandonReason('plan-pending')).toBe(true);
  });
});

describe('deriveRouteIdempotencyKey', () => {
  it('should be a pure function of the decision id', () => {
    expect(deriveRouteIdempotencyKey('ol_routingdecision_abc')).toBe(
      'route:ol_routingdecision_abc',
    );
  });

  it('should re-derive an identical key for a retry of the same decision', () => {
    // The row's id is immutable, so a crash mid-route retries under the same
    // key — issue AC 3.
    const decisionId = 'ol_routingdecision_deadbeef';
    expect(deriveRouteIdempotencyKey(decisionId)).toBe(deriveRouteIdempotencyKey(decisionId));
  });

  it('should derive a DIFFERENT key for a re-route, which is a different decision', () => {
    // The #2039 `reconcileId` lesson inverted: a genuinely new decision must
    // NOT dedup against the previous one, which is why the key comes from the
    // row rather than from the order or the job.
    expect(deriveRouteIdempotencyKey('ol_routingdecision_first')).not.toBe(
      deriveRouteIdempotencyKey('ol_routingdecision_second'),
    );
  });
});
