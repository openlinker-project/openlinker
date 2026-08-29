/**
 * Reading a dry-run verdict, and the arming gate (#2366, spec §5.6)
 *
 * Pure. No I/O, no framework — the rules for the type it sits with.
 *
 * @module apps/web/src/features/automation/lib
 */
import {
  AUTOMATION_CONDITION_OUTCOME_COPY,
  AUTOMATION_NON_FIRING_REASON_COPY,
} from './automation.copy';
import type {
  AutomationActionVocabulary,
  AutomationConditionOutcome,
  AutomationVerdict,
} from '../api/automation.types';
import type {
  AutomationActionDraft,
  AutomationComposerValues,
  AutomationConditionDraft,
} from './automation-composer.schema';
import { toActionInput, toConditionInput } from './automation-composer.schema';

/** Label one per-condition outcome. Exhaustive; a fifth value fails the build. */
export function describeConditionOutcome(outcome: AutomationConditionOutcome): string {
  switch (outcome) {
    case 'true':
      return AUTOMATION_CONDITION_OUTCOME_COPY.true;
    case 'false':
      return AUTOMATION_CONDITION_OUTCOME_COPY.false;
    case 'unknown':
      return AUTOMATION_CONDITION_OUTCOME_COPY.unknown;
    case 'currency-mismatch':
      return AUTOMATION_CONDITION_OUTCOME_COPY['currency-mismatch'];
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unhandled automation condition outcome: ${String(exhaustive)}`);
    }
  }
}

/**
 * Tone for a per-condition outcome.
 *
 * `unknown` and `currency-mismatch` are `warning`, not `error`: the first is
 * something the operator can fix, and the second may be a rule they deliberately
 * want to keep. Only a plain `false` is the rule simply not applying.
 */
export function conditionOutcomeTone(
  outcome: AutomationConditionOutcome,
): 'success' | 'warning' | 'neutral' {
  if (outcome === 'true') return 'success';
  if (outcome === 'false') return 'neutral';
  return 'warning';
}

/**
 * Label a non-firing reason.
 *
 * Falls back to the RAW CODE for a reason this build does not recognise — a
 * fifteenth reason from a newer backend renders something true rather than
 * nothing. The copy table is compile-time total over the union, so a mirrored
 * addition fails the build instead of silently reaching this fallback.
 */
export function describeNonFiringReason(reason: string): string {
  return (AUTOMATION_NON_FIRING_REASON_COPY as Record<string, string>)[reason] ?? reason;
}

/**
 * Whether this draft may be saved without a dry run.
 *
 * **Keyed on `irreversible` ALONE, never on `isActive`.** The money
 * acknowledgement (#2365) is CONSENT and is needed only when arming; this is
 * EVIDENCE and is needed to create the definition at all. Gating on `isActive`
 * would be bypassable in two clicks — save inactive, then arm from the rules
 * list, whose toggle carries no dry-run gate — so the rule would spend money
 * having never been tested. A rule tested before it exists cannot be armed
 * untested by any path, including paths nobody has written yet.
 */
export function draftNeedsDryRun(
  actions: readonly AutomationActionDraft[],
  vocabulary: readonly AutomationActionVocabulary[],
): boolean {
  return actions.some(
    (draft) =>
      vocabulary.find((entry) => entry.action === draft.action)?.irreversible === true,
  );
}

/**
 * Identify the draft a dry run was evidence FOR.
 *
 * Covers exactly `trigger`, `triggerConfig`, `conditions` and `actions` — what
 * the rule DOES. Both halves of that scope are load-bearing:
 *
 * - `isActive` and `moneyAcknowledged` are EXCLUDED. Ticking "turn this on"
 *   changes neither what the rule does nor what the dry run evaluated, so
 *   folding them in would re-lock the gate for a change the evidence still
 *   covers, sending the operator round a loop with no visible cause.
 * - `trigger` and `triggerConfig` are INCLUDED. A rule tested on one event and
 *   switched to another was tested against something else entirely, and the
 *   verdicts do not transfer.
 *
 * Built from the same `toConditionInput` / `toActionInput` the save sends, so
 * key order is structurally identical on both sides. A future hand-built body
 * would break that and silently hold the gate open.
 */
export function fingerprintDraft(
  values: Pick<
    AutomationComposerValues,
    'trigger' | 'triggerConfigValue' | 'conditions' | 'actions'
  >,
): string {
  return JSON.stringify({
    trigger: values.trigger,
    triggerConfigValue: values.triggerConfigValue,
    conditions: values.conditions.map((c: AutomationConditionDraft) => toConditionInput(c)),
    actions: values.actions.map((a: AutomationActionDraft) => toActionInput(a)),
  });
}

export type DryRunGateState = 'not-required' | 'required' | 'stale' | 'satisfied';

/**
 * Resolve the Save gate.
 *
 * `stale` is distinct from `required` deliberately: "you have not tested this"
 * and "you tested it, then changed it" are different operator situations and
 * need different sentences, or the second reads as the gate being broken.
 */
export function resolveDryRunGate(input: {
  needsDryRun: boolean;
  testedFingerprint: string | null;
  currentFingerprint: string;
}): DryRunGateState {
  if (!input.needsDryRun) return 'not-required';
  if (input.testedFingerprint === null) return 'required';
  return input.testedFingerprint === input.currentFingerprint ? 'satisfied' : 'stale';
}

export type VerdictHeadline = 'would-fire' | 'would-match-not-fire' | 'would-not-fire';

/**
 * The headline to put on a verdict.
 *
 * **`wouldFire` alone is not enough to claim the rule would have run.** The dry
 * run waives the retroactivity floor that the real path enforces, so a verdict
 * carrying `retroactivityFloorWaived` matched only because of that waiver — the
 * rule would NOT have acted on this order. Rendering an affirmative headline
 * with the waiver as fine print underneath states the opposite of the truth in
 * the part an operator actually scans.
 */
export function verdictHeadline(verdict: AutomationVerdict): VerdictHeadline {
  if (!verdict.wouldFire) return 'would-not-fire';
  return verdict.retroactivityFloorWaived ? 'would-match-not-fire' : 'would-fire';
}

/** The verdict for the rule the operator asked about, if the response carried one. */
export function subjectVerdict(verdicts: readonly AutomationVerdict[]): AutomationVerdict | null {
  return verdicts.find((verdict) => verdict.isSubject) ?? null;
}

/** Every other rule on the trigger — the siblings a collision would involve. */
export function siblingVerdicts(verdicts: readonly AutomationVerdict[]): AutomationVerdict[] {
  return verdicts.filter((verdict) => !verdict.isSubject);
}
