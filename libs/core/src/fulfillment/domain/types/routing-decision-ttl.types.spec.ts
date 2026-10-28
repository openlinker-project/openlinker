import {
  FULFILLMENT_ROUTE_LOCK_TTL_MAX_MS,
} from '../../application/services/routing-commit-lock';
import {
  describeRoutingDecisionTtl,
  isRoutingDecisionStranded,
  resolveRoutingDecisionTtlMs,
  ROUTING_DECISION_TTL_DEFAULT_MS,
  ROUTING_DECISION_TTL_MAX_MS,
  ROUTING_DECISION_TTL_MIN_MS,
  routingDecisionStrandedBefore,
} from './routing-decision-ttl.types';

describe('resolveRoutingDecisionTtlMs (#2731)', () => {
  it('should default to one hour when the value is unset', () => {
    expect(resolveRoutingDecisionTtlMs(undefined)).toBe(60 * 60 * 1000);
    expect(ROUTING_DECISION_TTL_DEFAULT_MS).toBe(60 * 60 * 1000);
  });

  it.each(['', 'abc', '0', '-5', 'NaN', 'Infinity'])(
    'should fall back to the default when the value is %p',
    (raw) => {
      expect(resolveRoutingDecisionTtlMs(raw)).toBe(ROUTING_DECISION_TTL_DEFAULT_MS);
    }
  );

  it('should clamp a value below the floor up to the floor', () => {
    expect(resolveRoutingDecisionTtlMs(String(60_000))).toBe(ROUTING_DECISION_TTL_MIN_MS);
  });

  it('should clamp a value above the ceiling down to the ceiling', () => {
    expect(resolveRoutingDecisionTtlMs(String(30 * 24 * 60 * 60 * 1000))).toBe(
      ROUTING_DECISION_TTL_MAX_MS
    );
  });

  it('should accept a value inside the range unchanged', () => {
    expect(resolveRoutingDecisionTtlMs(String(2 * 60 * 60 * 1000))).toBe(2 * 60 * 60 * 1000);
  });

  it('should keep the floor above the longest route() budget any configuration allows', () => {
    // A margin, not the guarantee: the reaper also takes the routing lock, which
    // covers a RESUMED call the createdAt-based age cannot see. The floor keeps
    // a decision's own first call out of reach even before the lock is asked.
    // The budget is half the lock TTL, so the lock TTL's maximum is a safe
    // (stricter) bound to assert against.
    expect(ROUTING_DECISION_TTL_MIN_MS).toBeGreaterThan(FULFILLMENT_ROUTE_LOCK_TTL_MAX_MS);
  });
});

describe('describeRoutingDecisionTtl (#2731)', () => {
  it('should state minutes below two hours', () => {
    expect(describeRoutingDecisionTtl(60 * 60 * 1000)).toBe(
      'Routing got no answer within 60 minutes; it will be retried'
    );
  });

  it('should state hours from two hours up', () => {
    expect(describeRoutingDecisionTtl(24 * 60 * 60 * 1000)).toBe(
      'Routing got no answer within 24 hours; it will be retried'
    );
  });
});

describe('isRoutingDecisionStranded (#2731)', () => {
  const now = new Date('2026-10-27T12:00:00.000Z');
  const ttlMs = 60 * 60 * 1000;

  it('should treat a live decision older than the TTL as stranded', () => {
    expect(
      isRoutingDecisionStranded(
        { state: 'live', createdAt: new Date('2026-10-27T10:59:59.000Z') },
        now,
        ttlMs
      )
    ).toBe(true);
  });

  it('should not treat a live decision inside the TTL as stranded', () => {
    expect(
      isRoutingDecisionStranded(
        { state: 'live', createdAt: new Date('2026-10-27T11:30:00.000Z') },
        now,
        ttlMs
      )
    ).toBe(false);
  });

  it('should never treat a terminal decision as stranded, however old', () => {
    for (const state of ['committed', 'abandoned'] as const) {
      expect(
        isRoutingDecisionStranded({ state, createdAt: new Date('2026-01-01T00:00:00.000Z') }, now, ttlMs)
      ).toBe(false);
    }
  });

  it('should derive the cutoff by subtracting the TTL from now', () => {
    expect(routingDecisionStrandedBefore(now, ttlMs).toISOString()).toBe(
      '2026-10-27T11:00:00.000Z'
    );
  });
});
