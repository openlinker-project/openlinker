/**
 * Manual-route admissibility — unit spec (#2869 R7, M3)
 *
 * @module libs/core/src/fulfillment/domain/types
 */
import { RoutingDecision } from '../entities/routing-decision.entity';
import {
  ManualRouteRefusalReasonValues,
  checkManualRouteAdmissible,
} from './manual-route-admissibility.types';

function liveDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return new RoutingDecision(
    overrides.id ?? 'rd_live_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.routerConnectionId ?? 'conn-router',
    overrides.state ?? 'live',
    overrides.routerDecisionRef ?? null,
    overrides.abandonReason ?? null,
    overrides.terminalisedAt ?? null,
    overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    overrides.updatedAt ?? new Date('2026-01-01T00:00:00Z')
  );
}

describe('checkManualRouteAdmissible', () => {
  it('admits a manual route when no decision is live for the order', () => {
    expect(checkManualRouteAdmissible(null)).toEqual({ status: 'admissible' });
  });

  it('refuses a manual route while a decision is live, naming the decision', () => {
    const live = liveDecision({ id: 'rd_live_42' });

    expect(checkManualRouteAdmissible(live)).toEqual({
      status: 'refused',
      reason: 'routing-in-flight',
      decisionId: 'rd_live_42',
    });
  });

  it('refuses REGARDLESS of which router holds the live decision', () => {
    // M3: the refusal is router-agnostic. `RoutingCommitService.resumeOrRefuse`
    // distinguishes its own router (resume) from a rival (refuse); a manual
    // route has no idempotency key to re-derive, so BOTH are refusals here.
    const mine = checkManualRouteAdmissible(liveDecision({ routerConnectionId: 'conn-a' }));
    const theirs = checkManualRouteAdmissible(liveDecision({ routerConnectionId: 'conn-b' }));

    expect(mine.status).toBe('refused');
    expect(theirs.status).toBe('refused');
  });

  it('exposes exactly one refusal reason today', () => {
    expect(ManualRouteRefusalReasonValues).toEqual(['routing-in-flight']);
  });

  it('is a pure function of its argument — same input, deep-equal output, argument untouched', () => {
    const live = liveDecision();
    const before = JSON.stringify(live);

    const first = checkManualRouteAdmissible(live);
    const second = checkManualRouteAdmissible(live);

    expect(first).toEqual(second);
    expect(JSON.stringify(live)).toBe(before);
  });
});
