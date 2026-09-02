/**
 * Automation Evaluation Vocabulary (#2359, Wave-2 spec §5.5 / §5.6)
 *
 * The two closed vocabularies `evaluateAutomationRules` answers with: how one
 * condition resolved, and — when a rule did not fire — why.
 *
 * **These live here, not in the domain service that produces them**, for the
 * same reason every other automation vocabulary got its own `*.types.ts` in
 * #2358: `AutomationNonFiringReason` is operator-facing copy that #2363 returns
 * over HTTP and #2364 renders, and the way this repo keeps such a union honest
 * across the frontend boundary is a mirror script that parses a `*.types.ts`
 * (`check-sales-document-reason-mirror.mjs`, `check-order-lifecycle-phase-mirror.mjs`).
 * A mirror pointed at a domain-service file would be parsing a file full of
 * unrelated logic.
 *
 * The structural result shapes (`AutomationConditionTrace`,
 * `AutomationRuleEvaluation`, the evaluator's input/output) stay with the
 * function, following the `SalesDocumentRuleEngineInput` precedent — they are
 * that function's signature, not a vocabulary anything else mirrors.
 *
 * @module libs/core/src/automation/domain/types
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.5, §5.6
 */

/**
 * How one condition resolved.
 *
 * `unknown` and `currency-mismatch` are both distinct from `false` on purpose:
 * *"the order is DE, your rule says PL"* is a rule the operator may want to
 * keep, whereas *"we never learned the country"* and *"your threshold is in PLN
 * and the order is in EUR"* are things they can fix. Collapsing the three into
 * one boolean is how an operator concludes their rule is wrong when the data is.
 */
export const AutomationConditionOutcomeValues = [
  'true',
  'false',
  'unknown',
  'currency-mismatch',
] as const;
export type AutomationConditionOutcome = (typeof AutomationConditionOutcomeValues)[number];

/** Coerce an untrusted value to the outcome union. No default. */
export function isAutomationConditionOutcome(
  value: unknown,
): value is AutomationConditionOutcome {
  return (
    typeof value === 'string' &&
    (AutomationConditionOutcomeValues as readonly string[]).includes(value)
  );
}

/**
 * Why a rule did not fire. Closed, and every member is reachable.
 *
 * Ordered as the evaluator tests them, which is also roughly cheapest-first: a
 * rule ruled out by its trigger is never asked about its conditions.
 *
 * Every member exists because the alternative was silence. Returning a bare
 * list of matches would make *"your rule is inactive"*, *"its window closed"*,
 * *"a condition was unknown"* and *"it does not apply to this trigger"* the
 * same observation — nothing — which is the silent decline ADR-041 §54 forbids
 * one context over.
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

/**
 * The two reasons that mean *"this rule is about a different event"* rather
 * than *"this rule looked at your subject and declined"*.
 *
 * Exported because it is the rule deciding whether a condition trace is built
 * at all: a rule scoped elsewhere had its conditions never asked, and rendering
 * a trace for it would answer a question nobody put.
 */
export const AUTOMATION_OUT_OF_SCOPE_REASONS: readonly AutomationNonFiringReason[] = [
  'trigger-mismatch',
  'unknown-trigger',
];
