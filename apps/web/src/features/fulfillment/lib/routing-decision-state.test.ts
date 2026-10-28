import { describe, expect, it } from 'vitest';

import type { RoutingDecisionStatus } from '../api/fulfillment.types';
import { ApiError } from '../../../shared/api/api-error';
import { describeRetryRoutingError } from './routing-decision.copy';
import { canRetryRouting, resolveRoutingDecisionState } from './routing-decision-state';

function decision(overrides: Partial<RoutingDecisionStatus> = {}): RoutingDecisionStatus {
  return {
    decisionId: 'ol_routingdecision_1',
    state: 'live',
    routerConnectionId: 'router-1',
    createdAt: '2026-10-28T08:00:00.000Z',
    ageMs: 1000,
    ttlMs: 3_600_000,
    strandedSince: null,
    abandonReason: null,
    terminalisedAt: null,
    ...overrides,
  };
}

describe('resolveRoutingDecisionState', () => {
  it('should read a live decision past its limit as stuck', () => {
    expect(
      resolveRoutingDecisionState(decision({ strandedSince: '2026-10-28T09:00:00.000Z' }))
    ).toBe('stuck');
  });

  it('should say nothing about a live decision still inside its limit', () => {
    expect(resolveRoutingDecisionState(decision())).toBeNull();
  });

  it('should read a decision the reaper closed as resolved', () => {
    expect(
      resolveRoutingDecisionState(
        decision({ state: 'abandoned', abandonReason: 'stranded-past-ttl' })
      )
    ).toBe('resolved');
  });

  it('should say nothing about a decision abandoned for another reason', () => {
    expect(
      resolveRoutingDecisionState(
        decision({ state: 'abandoned', abandonReason: 'plan-carries-unfulfillable' })
      )
    ).toBeNull();
  });

  it('should read a committed decision as healthy', () => {
    expect(resolveRoutingDecisionState(decision({ state: 'committed' }))).toBe('healthy');
  });

  it('should say nothing for no decision or an unknown state', () => {
    expect(resolveRoutingDecisionState(null)).toBeNull();
    expect(resolveRoutingDecisionState(decision({ state: 'something-new' }))).toBeNull();
  });
});

describe('canRetryRouting', () => {
  it.each(['routing-refused', 'routing-failed'])('should allow a retry when held as %s', (r) => {
    expect(canRetryRouting(r)).toBe(true);
  });

  it.each([null, undefined, 'routing-no-shipping-address', 'routing-in-doubt'])(
    'should not offer a retry for %s',
    (r) => {
      expect(canRetryRouting(r)).toBe(false);
    }
  );
});

describe('describeRetryRoutingError', () => {
  it('should name the refusal from the 409 code, never the server message', () => {
    const error = new ApiError('boom secret', 409, { code: 'not-held' });
    const text = describeRetryRoutingError(error);
    expect(text).toContain('not waiting on routing');
    expect(text).not.toContain('secret');
  });

  it('should fall back for an unknown 409 code', () => {
    expect(describeRetryRoutingError(new ApiError('x', 409, { code: 'new' }))).toContain(
      'cannot be retried'
    );
  });

  it('should map 503 and 404 and anything else', () => {
    expect(describeRetryRoutingError(new ApiError('x', 503, null))).toContain('Try again');
    expect(describeRetryRoutingError(new ApiError('x', 404, null))).toContain('no longer exists');
    expect(describeRetryRoutingError(new Error('net'))).toContain('Try again');
  });
});
