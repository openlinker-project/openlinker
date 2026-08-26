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
 * ## Three properties that are contract, not implementation detail
 *
 * **1. Every condition is evaluated; nothing short-circuits.** Unlike #2170,
 * which stops at the first false condition because it only needs a verdict,
 * this returns a per-condition trace **whether or not the rule matched** —
 * that trace IS the dry run's rendering. An operator debugging *"why didn't
 * this fire?"* needs the row for condition three even when condition one
 * already failed, or they fix one thing, re-test, and discover the next.
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
import { isLegalAutomationPair } from '../types/automation-legality.types';
import { isAutomationTriggerConfig } from '../types/automation-trigger-config.types';
import type { AutomationTrigger } from '../types/automation-trigger.types';
import { isAutomationTrigger } from '../types/automation-trigger.types';

/**
 * How one condition resolved.
 *
 * `unknown` and `currency-mismatch` are both distinct from `false` on purpose:
 * *"the order is DE, your rule says PL"* is a rule the operator may want to
 * keep, whereas *"we never learned the country"* and *"your threshold is in PLN
 * and the order is in EUR"* are things they can fix.
 */
export const AutomationConditionOutcomeValues = [
  'true',
  'false',
  'unknown',
  'currency-mismatch',
] as const;
export type AutomationConditionOutcome = (typeof AutomationConditionOutcomeValues)[number];

/** One row of the dry run's per-condition table. */
export interface AutomationConditionTrace {
  readonly field: AutomationConditionField;
  readonly condition: AutomationCondition;
  readonly outcome: AutomationConditionOutcome;
}

/**
 * Why a rule did not fire. Closed, and every member is reachable.
 *
 * Ordered as the evaluator tests them, which is also roughly cheapest-first:
 * a rule ruled out by its trigger is never asked about its conditions.
 */
export const AutomationNonFiringReasonValues = [
  /** The rule is scoped to a different trigger than the one that fired. */
  'trigger-mismatch',
  /** The rule's persisted trigger is not a member of the v1 vocabulary (#2358's read-path cast). */
  'unknown-trigger',
  /** The rule is not armed. */
  'rule-inactive',
  /** `effectiveFrom` is in the future. */
  'not-yet-effective',
  /** `effectiveTo` has passed. */
  'no-longer-effective',
  /** The fact occurred before the rule was saved (spec §5.2: rules are never retroactive). */
  'fact-precedes-rule',
  /** The caller did not assert when the fact occurred, so the retroactivity floor cannot be cleared. */
  'fact-time-unknown',
  /** A persisted pair the §5.4 matrix forbids — the rule could never meaningfully fire. */
  'illegal-trigger-action-pair',
  /** Every step was dropped by the read-path narrower; there is nothing to run. */
  'no-actions',
  /** `triggerConfig` does not narrow against this trigger (a T3/T4 rule with no threshold). */
  'trigger-config-invalid',
  /** A condition evaluated false. */
  'condition-not-met',
  /** A condition referenced a fact the caller did not assert. */
  'condition-fact-unknown',
  /** An amount condition's currency differs from the order's. Never converted (spec §5.5). */
  'condition-currency-mismatch',
] as const;
export type AutomationNonFiringReason = (typeof AutomationNonFiringReasonValues)[number];

/** Coerce an untrusted value to the reason union. No default. */
export function isAutomationNonFiringReason(value: unknown): value is AutomationNonFiringReason {
  return (
    typeof value === 'string' &&
    (AutomationNonFiringReasonValues as readonly string[]).includes(value)
  );
}

/** One rule's verdict. Returned for EVERY input rule, matched or not. */
export interface AutomationRuleEvaluation {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly matches: boolean;
  /**
   * Every condition, in the rule's own order, always — including for a rule
   * ruled out before its conditions were relevant, where it is empty rather
   * than absent. The dry run renders this table either way.
   */
  readonly conditionTraces: readonly AutomationConditionTrace[];
  /** `null` if and only if `matches` is `true`. */
  readonly nonFiringReason: AutomationNonFiringReason | null;
}

export interface AutomationEvaluationInput {
  /** The trigger that actually fired — the caller's fact, not a rule's scope. */
  readonly trigger: AutomationTrigger;
  readonly facts: AutomationSubjectFacts;
  /** Candidate rules, already loaded. May include rules on other triggers; they report `trigger-mismatch`. */
  readonly rules: readonly AutomationRule[];
  /** Evaluation instant — never read from the system clock inside this function. */
  readonly now: Date;
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
 * Everything that rules a rule out BEFORE its conditions are relevant.
 *
 * Kept separate so the condition trace is only built for rules whose conditions
 * mean something — a rule scoped to another trigger reports `trigger-mismatch`
 * with an empty trace, which is honest: its conditions were never asked.
 */
function checkRuleApplicability(
  rule: AutomationRule,
  input: AutomationEvaluationInput,
): AutomationNonFiringReason | null {
  // The repository casts an unrecognised persisted trigger through (#2358), so
  // this is reachable and must not throw or fall through to a firing path.
  if (!isAutomationTrigger(rule.trigger)) return 'unknown-trigger';
  if (rule.trigger !== input.trigger) return 'trigger-mismatch';
  if (!rule.isActive) return 'rule-inactive';

  const now = input.now.getTime();
  if (rule.effectiveFrom.getTime() > now) return 'not-yet-effective';
  if (rule.effectiveTo !== null && rule.effectiveTo.getTime() < now) return 'no-longer-effective';

  // Spec §5.2: an automation only acts on things that happen after it is saved.
  // An UNKNOWN occurrence time does not waive the floor — it means the floor
  // cannot be shown to be cleared, and the wrong guess here buys 40 labels.
  const occurredAt = input.facts.occurredAt;
  if (occurredAt === undefined) return 'fact-time-unknown';
  if (occurredAt.getTime() < rule.createdAt.getTime()) return 'fact-precedes-rule';

  if (!isAutomationTriggerConfig(rule.trigger, rule.triggerConfig)) return 'trigger-config-invalid';

  // An empty list is what a rule whose every step was dropped by the read-path
  // narrower looks like (#2358); the write path would have refused it.
  if (rule.actions.length === 0) return 'no-actions';
  // The §5.4 matrix is enforced on the write path too, so this catches a row
  // that predates the table or was written around it. Every step must be legal:
  // a rule that would run one legal step and skip an impossible one is a rule
  // whose behaviour nobody declared.
  if (rule.actions.some((step) => !isLegalAutomationPair(rule.trigger, step.action))) {
    return 'illegal-trigger-action-pair';
  }
  return null;
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
    const applicability = checkRuleApplicability(rule, input);
    if (applicability !== null) {
      evaluations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        matches: false,
        conditionTraces: [],
        nonFiringReason: applicability,
      });
      continue;
    }

    // Deliberately NOT short-circuited — the dry run renders every row.
    const conditionTraces: AutomationConditionTrace[] = rule.conditions.map((condition) => ({
      field: condition.field,
      condition,
      outcome: evaluateCondition(condition, input.facts),
    }));

    // AND-only (spec §5.5), so the first non-`true` outcome in the operator's
    // own condition order is the reason. Order-stable rather than
    // severity-ranked: the operator reads the trace top to bottom and the
    // headline reason should name the first row they will look at.
    const firstProblem = conditionTraces.find((trace) => trace.outcome !== 'true');

    evaluations.push({
      ruleId: rule.id,
      ruleName: rule.name,
      matches: firstProblem === undefined,
      conditionTraces,
      nonFiringReason: firstProblem === undefined ? null : reasonForOutcome(firstProblem.outcome),
    });
  }

  return { evaluations, matched: evaluations.filter((evaluation) => evaluation.matches) };
}
