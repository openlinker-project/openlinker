/**
 * Dry-run verdict + arming-gate tests (#2366)
 *
 * The gate tests are the issue's own acceptance criterion, and one of them
 * covers the bypass the plan review found: gating on `isActive` would let an
 * operator save an A2 rule inactive and arm it from the rules list untested.
 */
import { describe, expect, it } from 'vitest';
import {
  conditionOutcomeTone,
  describeConditionOutcome,
  describeNonFiringReason,
  draftNeedsDryRun,
  fingerprintDraft,
  resolveDryRunGate,
  siblingVerdicts,
  subjectVerdict,
  verdictHeadline,
} from './dry-run-verdict';
import { newActionDraft, newConditionDraft } from './automation-composer.schema';
import {
  AUTOMATION_CONDITION_OUTCOME_VALUES,
  AUTOMATION_NON_FIRING_REASON_VALUES,
  type AutomationActionVocabulary,
  type AutomationVerdict,
} from '../api/automation.types';

const VOCAB: AutomationActionVocabulary[] = [
  { action: 'relay-status-to-source', availability: 'available', reason: null, irreversible: false },
  { action: 'dispatch-shipment', availability: 'unavailable', reason: 'not built', irreversible: true },
  { action: 'send-email', availability: 'partial', reason: 'api only', irreversible: false },
];

describe('describeConditionOutcome', () => {
  it('should label every outcome without throwing', () => {
    for (const outcome of AUTOMATION_CONDITION_OUTCOME_VALUES) {
      expect(() => describeConditionOutcome(outcome)).not.toThrow();
    }
  });

  it('should throw on a value outside the union', () => {
    expect(() =>
      describeConditionOutcome('maybe' as Parameters<typeof describeConditionOutcome>[0]),
    ).toThrow(/Unhandled automation condition outcome/);
  });

  it('should not tone unknown or currency-mismatch as a plain no', () => {
    // Both are things the operator can act on; only `false` is the rule simply
    // not applying.
    expect(conditionOutcomeTone('false')).toBe('neutral');
    expect(conditionOutcomeTone('unknown')).toBe('warning');
    expect(conditionOutcomeTone('currency-mismatch')).toBe('warning');
    expect(conditionOutcomeTone('true')).toBe('success');
  });
});

describe('describeNonFiringReason', () => {
  it('should label all fourteen declared reasons', () => {
    for (const reason of AUTOMATION_NON_FIRING_REASON_VALUES) {
      expect(describeNonFiringReason(reason)).not.toBe(reason);
    }
  });

  it('should fall back to the raw code for a reason this build does not know', () => {
    // A newer backend must render something true, never `undefined`.
    expect(describeNonFiringReason('some-future-reason')).toBe('some-future-reason');
  });
});

describe('draftNeedsDryRun', () => {
  it('should require a dry run for an irreversible step', () => {
    expect(
      draftNeedsDryRun([{ ...newActionDraft(), action: 'dispatch-shipment' }], VOCAB),
    ).toBe(true);
  });

  it('should not require one for reversible steps', () => {
    expect(draftNeedsDryRun([newActionDraft()], VOCAB)).toBe(false);
    expect(draftNeedsDryRun([{ ...newActionDraft(), action: 'send-email' }], VOCAB)).toBe(false);
  });

  it('should not treat an action the vocabulary does not know as irreversible', () => {
    expect(
      draftNeedsDryRun(
        [{ ...newActionDraft(), action: 'place-hold' }],
        VOCAB,
      ),
    ).toBe(false);
  });
});

describe('resolveDryRunGate', () => {
  it('should lock an untested irreversible draft', () => {
    expect(
      resolveDryRunGate({ needsDryRun: true, testedFingerprint: null, currentFingerprint: 'a' }),
    ).toBe('required');
  });

  it('should unlock once the tested draft matches', () => {
    expect(
      resolveDryRunGate({ needsDryRun: true, testedFingerprint: 'a', currentFingerprint: 'a' }),
    ).toBe('satisfied');
  });

  it('should re-lock as STALE when the draft changed after testing', () => {
    // Distinct from `required`: "you have not tested this" and "you tested it,
    // then changed it" are different situations needing different sentences.
    expect(
      resolveDryRunGate({ needsDryRun: true, testedFingerprint: 'a', currentFingerprint: 'b' }),
    ).toBe('stale');
  });

  it('should never gate a reversible draft', () => {
    expect(
      resolveDryRunGate({ needsDryRun: false, testedFingerprint: null, currentFingerprint: 'a' }),
    ).toBe('not-required');
  });
});

describe('fingerprintDraft', () => {
  const base = {
    trigger: 'order.packed',
    triggerConfigValue: '24',
    conditions: [],
    actions: [{ ...newActionDraft(), action: 'dispatch-shipment' as const, carrierId: 'c1' }],
  };

  it('should change when an action parameter changes', () => {
    expect(fingerprintDraft(base)).not.toBe(
      fingerprintDraft({ ...base, actions: [{ ...base.actions[0], carrierId: 'c2' }] }),
    );
  });

  it('should change when the trigger changes', () => {
    // A rule tested on one event was tested against something else entirely;
    // the verdicts do not transfer.
    expect(fingerprintDraft(base)).not.toBe(
      fingerprintDraft({ ...base, trigger: 'order.on_hold_for' }),
    );
  });

  it('should change when the trigger config changes', () => {
    expect(fingerprintDraft(base)).not.toBe(
      fingerprintDraft({ ...base, triggerConfigValue: '48' }),
    );
  });

  it('should change when a condition is added', () => {
    expect(fingerprintDraft(base)).not.toBe(
      fingerprintDraft({
        ...base,
        conditions: [{ ...newConditionDraft(), field: 'orderCountry' as const, value: 'PL' }],
      }),
    );
  });

  it('should be STABLE across arming, which the evidence still covers', () => {
    // `isActive` / `moneyAcknowledged` are not in the fingerprint's scope at
    // all — folding them in would re-lock the gate for a change that alters
    // neither what the rule does nor what the dry run evaluated, sending the
    // operator round a loop with no visible cause.
    const fingerprint = fingerprintDraft(base);
    expect(fingerprintDraft({ ...base })).toBe(fingerprint);
  });
});

describe('verdictHeadline', () => {
  const base: AutomationVerdict = {
    ruleId: 'r1',
    ruleName: 'Mine',
    isSubject: true,
    isActive: true,
    matches: true,
    wouldFire: true,
    nonFiringReason: null,
    conditionTraces: [],
    retroactivityFloorWaived: false,
    blockedBy: null,
    stepAvailability: [],
  };

  it('should affirm only when the rule would fire AND the floor was not waived', () => {
    expect(verdictHeadline(base)).toBe('would-fire');
  });

  it('should NOT affirm when the retroactivity floor was waived', () => {
    // The dry run waives the floor the real path enforces, so "would have run"
    // is false — and it is the headline an operator scans, not the note below.
    expect(verdictHeadline({ ...base, retroactivityFloorWaived: true })).toBe(
      'would-match-not-fire',
    );
  });

  it('should report a non-firing rule regardless of the waiver', () => {
    expect(verdictHeadline({ ...base, wouldFire: false })).toBe('would-not-fire');
    expect(
      verdictHeadline({ ...base, wouldFire: false, retroactivityFloorWaived: true }),
    ).toBe('would-not-fire');
  });
});

describe('verdict selection', () => {
  const subject: AutomationVerdict = {
    ruleId: 'r1',
    ruleName: 'Mine',
    isSubject: true,
    isActive: true,
    matches: true,
    wouldFire: false,
    nonFiringReason: null,
    conditionTraces: [],
    retroactivityFloorWaived: false,
    blockedBy: { collidingRuleIds: ['r1', 'r2'], actions: ['dispatch-shipment'] },
    stepAvailability: [],
  };
  const sibling: AutomationVerdict = { ...subject, ruleId: 'r2', ruleName: 'Theirs', isSubject: false };

  it('should find the rule the caller asked about', () => {
    expect(subjectVerdict([sibling, subject])?.ruleId).toBe('r1');
  });

  it('should return null when no verdict is the subject', () => {
    expect(subjectVerdict([sibling])).toBeNull();
  });

  it('should list the siblings a collision would involve', () => {
    expect(siblingVerdicts([subject, sibling]).map((v) => v.ruleId)).toEqual(['r2']);
  });

  it('should keep matches and wouldFire distinguishable', () => {
    // They differ exactly when the at-most-one gate refused a rule that DID
    // match — rendering readiness from `matches` would show green on a rule
    // that will be held back.
    expect(subject.matches).toBe(true);
    expect(subject.wouldFire).toBe(false);
  });
});
