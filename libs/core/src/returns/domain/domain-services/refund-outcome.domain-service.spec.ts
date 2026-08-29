/**
 * Refund Outcome Classification Tests (#2371, ADR-056)
 *
 * Table-driven over the three inversions the classifier's header names, plus
 * the acceptance criterion that `RefundExecutor` is implemented by nobody.
 *
 * @module domain/domain-services
 */
import type { RefundExecutionResult } from '@openlinker/core/orders';
import { isRefundExecutor } from '@openlinker/core/orders';

import {
  classifyRefundFailure,
  classifyRefundOutcome,
  refundConfirmedOutOfBand,
} from './refund-outcome.domain-service';

const INSTANT = new Date('2026-08-26T10:00:00.000Z');

function result(overrides: Partial<RefundExecutionResult>): RefundExecutionResult {
  return {
    outcome: 'accepted',
    providerRefundId: null,
    refundedAt: null,
    providerMessage: null,
    ...overrides,
  };
}

describe('classifyRefundOutcome', () => {
  it.each([
    ['refunded with an instant', { outcome: 'refunded' as const, refundedAt: INSTANT }, 'refunded', true],
    ['refunded with NO instant', { outcome: 'refunded' as const, refundedAt: null }, 'triggered', true],
    ['accepted', { outcome: 'accepted' as const }, 'triggered', true],
    ['denied', { outcome: 'denied' as const }, 'denied', false],
  ])('should map %s to %s', (_label, overrides, expectedState, movesMoney) => {
    const outcome = classifyRefundOutcome(result(overrides));

    expect(outcome.moneyState).toBe(expectedState);
    expect(outcome.movesMoney).toBe(movesMoney);
    expect(outcome.executedBy).toBe('refund_executor');
  });

  it('should stamp settledAt only from the provider instant, never its own clock', () => {
    expect(classifyRefundOutcome(result({ outcome: 'refunded', refundedAt: INSTANT })).settledAt).toBe(
      INSTANT
    );
    expect(classifyRefundOutcome(result({ outcome: 'refunded', refundedAt: null })).settledAt).toBeNull();
    expect(classifyRefundOutcome(result({ outcome: 'accepted' })).settledAt).toBeNull();
  });

  it('should treat an outcome this build does not know as in doubt, never a success or a denial', () => {
    const outcome = classifyRefundOutcome(
      result({ outcome: 'settled-later' as unknown as RefundExecutionResult['outcome'] })
    );

    expect(outcome.moneyState).toBe('in_doubt');
    expect(outcome.movesMoney).toBe(false);
  });
});

describe('classifyRefundFailure', () => {
  it('should classify ANY throw as in doubt rather than denied', () => {
    // The inversion from the restock classifier: both directions are
    // unrecoverable here, so a failure must never unblock a second attempt.
    for (const error of [new Error('timeout'), 'a string', undefined, { code: 502 }]) {
      const outcome = classifyRefundFailure(error);
      expect(outcome.moneyState).toBe('in_doubt');
      expect(outcome.movesMoney).toBe(false);
    }
  });

  it('should carry the source message verbatim, with a fallback when there is none', () => {
    expect(classifyRefundFailure(new Error('refund rejected by PSP')).providerMessage).toBe(
      'refund rejected by PSP'
    );
    expect(classifyRefundFailure(new Error('   ')).providerMessage).toContain('without a message');
  });
});

describe('refundConfirmedOutOfBand', () => {
  it('should be triggered and operator-attributed, never in doubt', () => {
    const outcome = refundConfirmedOutOfBand(INSTANT);

    // No boundary was crossed, so there is nothing to be in doubt about.
    expect(outcome.moneyState).toBe('triggered');
    expect(outcome.executedBy).toBe('operator_out_of_band');
    expect(outcome.movesMoney).toBe(true);
    expect(outcome.settledAt).toBe(INSTANT);
  });
});

describe('RefundExecutor', () => {
  it('should be implemented by nobody, so the out-of-band path is the shipped behaviour', () => {
    // AC-4 as a test rather than a promise: the day an adapter implements this,
    // that adapter's own spec is the deliberate edit that supersedes this one.
    expect(isRefundExecutor({})).toBe(false);
    expect(isRefundExecutor({ executeRefund: 'not a function' })).toBe(false);
    expect(isRefundExecutor({ executeRefund: (): void => undefined })).toBe(true);
  });
});
