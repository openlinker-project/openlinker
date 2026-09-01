/**
 * AF-X derivation + retry eligibility (#2387, chain terminality #2666)
 */
import {
  AUTOMATION_MAX_RETRY_ATTEMPTS,
  AutomationRunOutcomeValues,
  RetryRefusalReasonValues,
  isAutomationRunAttentionWorthy,
  resolveRetryEligibility,
} from '../automation-run.types';

describe('isAutomationRunAttentionWorthy', () => {
  const base = { dismissedAt: null, supersededByRetry: false } as const;

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

  it('should stop needing attention when a retry of THAT firing exists', () => {
    // The property the whole `retryOfRunId` column exists for: a derived state
    // is only self-clearing if the derivation can see the thing that clears it.
    expect(
      isAutomationRunAttentionWorthy({
        ...base,
        outcome: 'failed',
        supersededByRetry: true,
      }),
    ).toBe(false);
  });

  it('should stop needing attention even when the retry ITSELF failed (#2666)', () => {
    // Outcome-blind on purpose. A chain is ONE underlying failure with one live
    // end, so only the newest link is the operator's handle — keying on a
    // SUCCESSFUL retry badged all three rows of a three-deep chain, and made the
    // operator dismiss each one to silence a single problem. The failed retry
    // carries its own badge as the chain head.
    expect(
      isAutomationRunAttentionWorthy({ ...base, outcome: 'failed', supersededByRetry: true }),
    ).toBe(false);
  });

  it('should keep needing attention when only an unrelated later firing succeeded', () => {
    // An unrelated firing carries no `retryOfRunId`, so it never lands in the
    // superseded set — which is exactly why latest-run-wins was rejected.
    expect(
      isAutomationRunAttentionWorthy({
        ...base,
        outcome: 'failed',
        supersededByRetry: false,
      }),
    ).toBe(true);
  });
});

describe('resolveRetryEligibility', () => {
  const base = {
    outcome: 'failed',
    subjectKind: 'order',
    ruleExists: true,
    retryAttempt: 0,
    supersededByRetry: false,
  } as const;

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
    expect(resolveRetryEligibility({ ...base, outcome: 'done', ruleExists: false })).toEqual({
      retryable: false,
      reason: 'not-failed',
    });
  });

  it('should refuse with superseded when a newer attempt already exists (#2666)', () => {
    // This is the FORK guard. Without it a direct API call could retry an
    // already-superseded parent, minting a second chain head whose budget
    // restarts at 1 — so the budget would bound each branch while the number of
    // branches stayed unbounded, which is defect (b) restored by another route.
    expect(resolveRetryEligibility({ ...base, supersededByRetry: true })).toEqual({
      retryable: false,
      reason: 'superseded',
    });
  });

  it('should refuse with retry-exhausted once the chain has spent its budget (#2666)', () => {
    expect(
      resolveRetryEligibility({ ...base, retryAttempt: AUTOMATION_MAX_RETRY_ATTEMPTS }),
    ).toEqual({ retryable: false, reason: 'retry-exhausted' });
  });

  it('should still allow the LAST attempt within the budget', () => {
    // The boundary, asserted from both sides so an off-by-one cannot pass: a
    // chain must be able to spend its final attempt.
    expect(
      resolveRetryEligibility({ ...base, retryAttempt: AUTOMATION_MAX_RETRY_ATTEMPTS - 1 }),
    ).toEqual({ retryable: true });
  });

  it('should report superseded AHEAD of retry-exhausted', () => {
    // "Act on the newer row" and "stop retrying" are different instructions,
    // and while a newer row exists the first is the useful one.
    expect(
      resolveRetryEligibility({
        ...base,
        supersededByRetry: true,
        retryAttempt: AUTOMATION_MAX_RETRY_ATTEMPTS,
      }),
    ).toEqual({ retryable: false, reason: 'superseded' });
  });

  it.each(['not-failed', 'subject-unsupported', 'rule-deleted'] as const)(
    'should report %s ahead of the chain reasons',
    (reason) => {
      // The three pre-#2666 refusals keep their precedence: a run refused for a
      // more specific cause must keep reporting that cause.
      const exhaustedAndSuperseded = {
        ...base,
        retryAttempt: AUTOMATION_MAX_RETRY_ATTEMPTS,
        supersededByRetry: true,
      };
      const input =
        reason === 'not-failed'
          ? { ...exhaustedAndSuperseded, outcome: 'done' as const }
          : reason === 'subject-unsupported'
            ? { ...exhaustedAndSuperseded, subjectKind: 'return' as const }
            : { ...exhaustedAndSuperseded, ruleExists: false };
      expect(resolveRetryEligibility(input)).toEqual({ retryable: false, reason });
    },
  );

  it('should only ever report a declared refusal reason', () => {
    const reason = resolveRetryEligibility({ ...base, ruleExists: false });
    expect(reason.retryable).toBe(false);
    if (!reason.retryable) {
      expect(RetryRefusalReasonValues).toContain(reason.reason);
    }
  });
});
