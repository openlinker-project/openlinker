/**
 * AF-X derivation + retry eligibility (#2387)
 */
import {
  AutomationRunOutcomeValues,
  RetryRefusalReasonValues,
  isAutomationRunAttentionWorthy,
  resolveRetryEligibility,
} from '../automation-run.types';

describe('isAutomationRunAttentionWorthy', () => {
  const base = { dismissedAt: null, supersededBySuccessfulRetry: false } as const;

  it('should need attention when a firing failed and nothing has cleared it', () => {
    expect(isAutomationRunAttentionWorthy({ ...base, outcome: 'failed' })).toBe(true);
  });

  it.each(AutomationRunOutcomeValues.filter((outcome) => outcome !== 'failed'))(
    'should not need attention when the outcome is %s',
    (outcome) => {
      // `nothing-to-do` is the rule finding the work already done and `blocked`
      // is a configuration collision #2362 reports separately. Counting either
      // would put a red number on a healthy install.
      expect(isAutomationRunAttentionWorthy({ ...base, outcome })).toBe(false);
    },
  );

  it('should stop needing attention once an operator says they handled it', () => {
    expect(
      isAutomationRunAttentionWorthy({
        ...base,
        outcome: 'failed',
        dismissedAt: new Date('2026-08-20T10:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('should stop needing attention when a retry of THAT firing succeeded', () => {
    // The property the whole `retryOfRunId` column exists for: a derived state
    // is only self-clearing if the derivation can see the thing that clears it.
    expect(
      isAutomationRunAttentionWorthy({
        ...base,
        outcome: 'failed',
        supersededBySuccessfulRetry: true,
      }),
    ).toBe(false);
  });

  it('should keep needing attention when only an unrelated later firing succeeded', () => {
    // An unrelated firing carries no `retryOfRunId`, so it never lands in the
    // superseded set — which is exactly why latest-run-wins was rejected.
    expect(
      isAutomationRunAttentionWorthy({
        ...base,
        outcome: 'failed',
        supersededBySuccessfulRetry: false,
      }),
    ).toBe(true);
  });
});

describe('resolveRetryEligibility', () => {
  const base = { outcome: 'failed', subjectKind: 'order', ruleExists: true } as const;

  it('should allow a retry of a failed order firing whose rule still exists', () => {
    expect(resolveRetryEligibility(base)).toEqual({ retryable: true });
  });

  it.each(AutomationRunOutcomeValues.filter((outcome) => outcome !== 'failed'))(
    'should refuse with not-failed when the outcome is %s',
    (outcome) => {
      expect(resolveRetryEligibility({ ...base, outcome })).toEqual({
        retryable: false,
        reason: 'not-failed',
      });
    },
  );

  it('should refuse with subject-unsupported for a return', () => {
    expect(resolveRetryEligibility({ ...base, subjectKind: 'return' })).toEqual({
      retryable: false,
      reason: 'subject-unsupported',
    });
  });

  it('should refuse with rule-deleted when the rule is gone', () => {
    expect(resolveRetryEligibility({ ...base, ruleExists: false })).toEqual({
      retryable: false,
      reason: 'rule-deleted',
    });
  });

  it('should report not-failed ahead of a missing rule', () => {
    // Order matters for the sentence an operator reads: a succeeded run whose
    // rule was deleted has nothing to re-run for the simpler reason.
    expect(resolveRetryEligibility({ outcome: 'done', subjectKind: 'order', ruleExists: false })).toEqual(
      { retryable: false, reason: 'not-failed' },
    );
  });

  it('should only ever report a declared refusal reason', () => {
    const reason = resolveRetryEligibility({ ...base, ruleExists: false });
    expect(reason.retryable).toBe(false);
    if (!reason.retryable) {
      expect(RetryRefusalReasonValues).toContain(reason.reason);
    }
  });
});
