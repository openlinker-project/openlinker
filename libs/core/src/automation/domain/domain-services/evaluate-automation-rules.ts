/**
 * Evaluate Automation Rules (#2359, Wave-2 spec §5.4 / §5.5 / §5.6)
 *
 * The pure heart of automation v1: given the trigger that actually fired, an
 * already-assembled `AutomationSubjectFacts` projection, the caller-loaded
 * candidate rules and an explicit `now`, decide which rules would fire — and,
 * for every rule that would not, say **why**.
 *
 * Plain function. No NestJS, no injected dependency, no I/O, no
 * `new Date()`/`Date.now()`, no argument mutation — the
 * `evaluateSalesDocumentRules` (#2170) / `applyPricingRule` / `checkRequiredToSell`
 * shape. Purity is not stylistic here: an evaluator that touches I/O cannot
 * back the §5.6(a) dry run, which is the gate an operator passes before arming
 * a rule that spends money. If it needs a database it is not this function.
 *
 * ## Four properties that are contract, not implementation detail
 *
 * **1. Every condition is evaluated; nothing short-circuits.** Unlike #2170,
 * which stops at the first false condition because it only needs a verdict,
 * this returns a per-condition trace **whether or not the rule matched** —
 * that trace IS the dry run's rendering. An operator debugging *"why didn't
 * this fire?"* needs the row for condition three even when condition one
 * already failed, or they fix one thing, re-test, and discover the next.
 *
 * The trace is built for every rule SCOPED to the fired trigger, including one
 * already ruled out by something else — it is switched off, its window closed,
 * the retroactivity floor blocked it. Those conditions are still about this
 * rule and this event. The only rules that get an empty trace are the ones
 * about a DIFFERENT event (`trigger-mismatch` / `unknown-trigger`,
 * `AUTOMATION_OUT_OF_SCOPE_REASONS`), whose conditions were never asked and for
 * which a trace would answer a question nobody put.
 *
 * **2. No non-firing exit is silent.** Every rule in `rules` comes back with an
 * evaluation, and a non-matching one carries a closed
 * `AutomationNonFiringReason` — the `SalesDocumentBlockOutcome` precedent
 * (#2100/ADR-041 §54). Returning a bare list of matches would make "your rule
 * is inactive", "its window closed", "a condition was unknown" and "it does
 * not apply to this trigger" the same observation: nothing.
 *
 * **3. An unknown fact never collapses into a known one.** A condition over a
 * fact the caller did not assert reads `unknown`, never `false`. The rule does
 * not fire either way — but the operator is told *"we could not tell"* rather
 * than *"it did not match"*, and those lead to different fixes. See
 * `AutomationSubjectFacts`.
 *
 * ## Three shapes inherited from #2358's read path, honoured deliberately
 *
 * - The repository **casts an unrecognised persisted trigger through** rather
 *   than dropping the row, so `rule.trigger` may not be a union member. Every
 *   lookup here tolerates that and resolves to non-firing, never to a throw and
 *   never to a default that fires.
 * - A rule whose steps were ALL dropped by the read-path narrower **reads back
 *   with an empty `actions` array** the write path would have refused. Empty is
 *   non-firing (`no-actions`): a rule with nothing to do must not be reported
 *   as a match, least of all to #2362's at-most-one gate.
 * - `triggerConfig` **degrades to `{}` when it does not narrow**, so a T3/T4
 *   rule can read back with no threshold. Non-firing (`trigger-config-invalid`),
 *   which is the safe direction and preserves #2358's own choice.
 *
 * **4. The retroactivity floor is a FIRING rule, and can be waived only
 * explicitly.** `enforceRetroactivityFloor` defaults to `true`, so an omission
 * can never widen what fires; the §5.6(a) dry run is its only intended caller,
 * and a waiver is REPORTED on each evaluation rather than merely applied — a
 * preview that silently differs from what would really fire is the shape of a
 * bad surprise.
 *
 * ## What this function is NOT
 *
 * It does not resolve #2362's at-most-one gate for irreversible actions. Spec
 * §5.5 divergence 3 places that at RUNTIME in the dispatcher, over this
 * function's `matched` list — several rules matching is a normal, correct
 * result here, and collapsing it to one would put the money decision in a place
 * the dry run cannot show and the operator cannot see.
 *
 * @module libs/core/src/automation/domain/domain-services
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.4, §5.5, §5.6
 */
import type { AutomationRule } from '../entities/automation-rule.entity';
import type { AutomationCondition } from '../types/automation-condition.types';
import type { AutomationConditionField } from '../types/automation-condition.types';
import type { AutomationSubjectFacts } from '../types/automation-facts.types';
import type {
  AutomationConditionOutcome,
  AutomationNonFiringReason,
} from '../types/automation-evaluation.types';
import { isLegalAutomationPair } from '../types/automation-legality.types';
import { isAutomationTriggerConfig } from '../types/automation-trigger-config.types';
import type { AutomationTrigger } from '../types/automation-trigger.types';
import { isAutomationTrigger } from '../types/automation-trigger.types';

/** One row of the dry run's per-condition table. */
export interface AutomationConditionTrace {
  readonly field: AutomationConditionField;
  readonly condition: AutomationCondition;
  readonly outcome: AutomationConditionOutcome;
}

/** One rule's verdict. Returned for EVERY input rule, matched or not. */
export interface AutomationRuleEvaluation {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly matches: boolean;
  /**
   * Every condition, in the rule's own order — built whenever the rule is
   * SCOPED to the trigger that fired, even when something else already ruled it
   * out (it is inactive, its window closed, the retroactivity floor blocked it).
   * Those conditions are about this rule and this event, and the §5.6(a) dry run
   * renders them either way; withholding them would leave the operator's own
   * test showing nothing.
   *
   * Empty ONLY for `trigger-mismatch` / `unknown-trigger`
   * (`AUTOMATION_OUT_OF_SCOPE_REASONS`), where the rule is about a different
   * event and a trace would answer a question nobody put.
   */
  readonly conditionTraces: readonly AutomationConditionTrace[];
  /** `null` if and only if `matches` is `true`. */
  readonly nonFiringReason: AutomationNonFiringReason | null;
  /**
   * `true` when the retroactivity floor WOULD have blocked this rule and was
   * waived because the caller passed `enforceRetroactivityFloor: false`.
   *
   * A preview that silently differs from what would really fire is the shape of
   * a bad surprise, so the waiver is reported rather than merely applied: the
   * dry run can render *"this matches, but it would not have fired for this
   * order — the order predates the rule"*, which is the true sentence.
   */
  readonly retroactivityFloorWaived: boolean;
}

export interface AutomationEvaluationInput {
  /** The trigger that actually fired — the caller's fact, not a rule's scope. */
  readonly trigger: AutomationTrigger;
  readonly facts: AutomationSubjectFacts;
  /** Candidate rules, already loaded. May include rules on other triggers; they report `trigger-mismatch`. */
  readonly rules: readonly AutomationRule[];
  /** Evaluation instant — never read from the system clock inside this function. */
  readonly now: Date;
  /**
   * Whether spec §5.2's retroactivity floor applies. **Defaults to `true`**, so
   * an omission can never widen what fires.
   *
   * The floor is a FIRING rule, not an evaluation rule: it asks *"did this fact
   * happen after the operator saved the rule?"*, which is the wrong question for
   * a preview run against an order from the last 30 days. **Its only intended
   * caller is the §5.6(a) dry run** (#2363) — passing `false` on any committing
   * path is a defect, not a configuration choice, because it is what stops a
   * brand-new rule buying labels for the 40 orders already on hold.
   *
   * Waiving it does not hide it: see `AutomationRuleEvaluation.retroactivityFloorWaived`.
   */
  readonly enforceRetroactivityFloor?: boolean;
}

export interface AutomationEvaluationResult {
  /** One entry per input rule, in input order. */
  readonly evaluations: readonly AutomationRuleEvaluation[];
  /** The subset that would fire. #2362's gate resolves at-most-one over THIS list, not here. */
  readonly matched: readonly AutomationRuleEvaluation[];
}

/** A non-negative decimal string, already shape-checked by `isAutomationCondition`. */
function parseAmount(amount: string): number | null {
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? parsed : null;
}

function evaluateCondition(
  condition: AutomationCondition,
  facts: AutomationSubjectFacts,
): AutomationConditionOutcome {
  switch (condition.field) {
    case 'sourceConnection':
      if (facts.sourceConnectionId === undefined) return 'unknown';
      return facts.sourceConnectionId === condition.value ? 'true' : 'false';
    case 'orderCountry':
      if (facts.country === undefined) return 'unknown';
      return facts.country === condition.value ? 'true' : 'false';
    case 'holdReason':
      if (facts.holdReason === undefined) return 'unknown';
      return facts.holdReason === condition.value ? 'true' : 'false';
    case 'orderTotalGross': {
      if (facts.totalGross === undefined || facts.currency === undefined) return 'unknown';
      // Spec §5.5: no conversion, EVER. The rule simply does not match, and the
      // operator is told why. The ADR-040 FX stamp is analytics-only and must
      // not be reached for — nothing here imports anything that could.
      if (facts.currency !== condition.currency) return 'currency-mismatch';
      const threshold = parseAmount(condition.amount);
      // Unreachable through the narrower, which enforces a bounded decimal
      // shape. Reported as unknown rather than false, because a threshold we
      // cannot read is not a threshold the order failed.
      if (threshold === null) return 'unknown';
      const matches =
        condition.op === 'gte' ? facts.totalGross >= threshold : facts.totalGross < threshold;
      return matches ? 'true' : 'false';
    }
    default: {
      // Exhaustiveness: a fifth condition field is a compile error rather than a
      // condition that silently reads as satisfied.
      const exhaustive: never = condition;
      void exhaustive;
      return 'unknown';
    }
  }
}

/**
 * Map a failing condition outcome onto the reason the rule reports.
 *
 * A function rather than a lookup keyed by `Exclude<…, 'true'>`, so the `'true'`
 * arm is a compile-checked case rather than a cast at the call site — and so a
 * fifth outcome added later is a compile error here too.
 */
function reasonForOutcome(outcome: AutomationConditionOutcome): AutomationNonFiringReason | null {
  switch (outcome) {
    case 'true':
      return null;
    case 'false':
      return 'condition-not-met';
    case 'unknown':
      return 'condition-fact-unknown';
    case 'currency-mismatch':
      return 'condition-currency-mismatch';
    default: {
      const exhaustive: never = outcome;
      void exhaustive;
      return 'condition-fact-unknown';
    }
  }
}

/**
 * The two facts that mean the rule is about a DIFFERENT event, so its
 * conditions were never asked and no trace should be built for it.
 *
 * Split from the rest of applicability deliberately: everything else
 * (`rule-inactive`, the effective window, the retroactivity floor, an invalid
 * config, an empty or illegal action list) rules the rule out while its
 * conditions remain perfectly meaningful — and the dry run needs to show them.
 */
function checkRuleScope(
  rule: AutomationRule,
  firedTrigger: AutomationTrigger,
): AutomationNonFiringReason | null {
  // The repository casts an unrecognised persisted trigger through (#2358), so
  // this is reachable and must not throw or fall through to a firing path.
  if (!isAutomationTrigger(rule.trigger)) return 'unknown-trigger';
  if (rule.trigger !== firedTrigger) return 'trigger-mismatch';
  return null;
}

/** Whether the retroactivity floor blocks this rule, ignoring whether it is enforced. */
function retroactivityFloorBlocks(
  rule: AutomationRule,
  facts: AutomationSubjectFacts,
): AutomationNonFiringReason | null {
  // Spec §5.2: an automation only acts on things that happen after it is saved.
  // An UNKNOWN occurrence time does not waive the floor — it means the floor
  // cannot be shown to be cleared, and the wrong guess here buys 40 labels.
  if (facts.occurredAt === undefined) return 'fact-time-unknown';
  if (facts.occurredAt.getTime() < rule.createdAt.getTime()) return 'fact-precedes-rule';
  return null;
}

/**
 * Everything that rules an IN-SCOPE rule out independently of its conditions.
 *
 * Returns the headline reason and whether the retroactivity floor was waived —
 * the two travel together because waiving the floor is the only way a reason
 * this function found can be suppressed.
 */
function checkRuleEligibility(
  rule: AutomationRule,
  input: AutomationEvaluationInput,
): { reason: AutomationNonFiringReason | null; retroactivityFloorWaived: boolean } {
  if (!rule.isActive) return { reason: 'rule-inactive', retroactivityFloorWaived: false };

  const now = input.now.getTime();
  if (rule.effectiveFrom.getTime() > now) {
    return { reason: 'not-yet-effective', retroactivityFloorWaived: false };
  }
  if (rule.effectiveTo !== null && rule.effectiveTo.getTime() < now) {
    return { reason: 'no-longer-effective', retroactivityFloorWaived: false };
  }

  // Defaults to enforced: an omitted flag must never widen what fires.
  const enforceFloor = input.enforceRetroactivityFloor ?? true;
  const floorReason = retroactivityFloorBlocks(rule, input.facts);
  if (floorReason !== null && enforceFloor) {
    return { reason: floorReason, retroactivityFloorWaived: false };
  }
  const retroactivityFloorWaived = floorReason !== null;

  if (!isAutomationTriggerConfig(rule.trigger, rule.triggerConfig)) {
    return { reason: 'trigger-config-invalid', retroactivityFloorWaived };
  }
  // An empty list is what a rule whose every step was dropped by the read-path
  // narrower looks like (#2358); the write path would have refused it.
  if (rule.actions.length === 0) return { reason: 'no-actions', retroactivityFloorWaived };
  // The §5.4 matrix is enforced on the write path too, so this catches a row
  // that predates the table or was written around it. Every step must be legal:
  // a rule that would run one legal step and skip an impossible one is a rule
  // whose behaviour nobody declared.
  if (rule.actions.some((step) => !isLegalAutomationPair(rule.trigger, step.action))) {
    return { reason: 'illegal-trigger-action-pair', retroactivityFloorWaived };
  }
  return { reason: null, retroactivityFloorWaived };
}

/**
 * Evaluate every candidate rule against one triggering fact. See the module doc
 * comment for the purity contract and the three read-path shapes it honours.
 */
export function evaluateAutomationRules(
  input: AutomationEvaluationInput,
): AutomationEvaluationResult {
  const evaluations: AutomationRuleEvaluation[] = [];

  for (const rule of input.rules) {
    const outOfScope = checkRuleScope(rule, input.trigger);
    if (outOfScope !== null) {
      evaluations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        matches: false,
        conditionTraces: [],
        nonFiringReason: outOfScope,
        retroactivityFloorWaived: false,
      });
      continue;
    }

    const { reason: eligibilityReason, retroactivityFloorWaived } = checkRuleEligibility(
      rule,
      input,
    );

    // Built for every in-scope rule, and deliberately NOT short-circuited: the
    // dry run renders every row, and it renders them even for a rule something
    // else already ruled out.
    const conditionTraces: AutomationConditionTrace[] = rule.conditions.map((condition) => ({
      field: condition.field,
      condition,
      outcome: evaluateCondition(condition, input.facts),
    }));

    // AND-only (spec §5.5), so the first non-`true` outcome in the operator's
    // own condition order is the reason. Order-stable rather than
    // severity-ranked: the operator reads the trace top to bottom and the
    // headline reason should name the first row they will look at. An
    // eligibility reason outranks it — a rule that is switched off did not fail
    // a condition.
    const firstProblem = conditionTraces.find((trace) => trace.outcome !== 'true');
    const nonFiringReason =
      eligibilityReason ?? (firstProblem === undefined ? null : reasonForOutcome(firstProblem.outcome));

    evaluations.push({
      ruleId: rule.id,
      ruleName: rule.name,
      matches: nonFiringReason === null,
      conditionTraces,
      nonFiringReason,
      retroactivityFloorWaived,
    });
  }

  return { evaluations, matched: evaluations.filter((evaluation) => evaluation.matches) };
}
