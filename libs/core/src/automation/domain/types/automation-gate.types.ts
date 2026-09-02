/**
 * Automation Irreversible-Action Gate Vocabulary (#2362, Wave-2 spec §5.5 divergence 3)
 *
 * What the gate decides about a set of matched rules, before any of them runs.
 *
 * **`collidingRuleIds` includes the blocked rule itself.** The `AutomationRun`
 * entity's own docblock defines `blockedByRuleIds` as *"every rule that
 * collided, this one included"*, and §5.6 requires the row to say which rules
 * collided — a set that omitted its own subject would make a two-rule collision
 * render as a row naming one other rule, which reads as "that rule blocked me"
 * rather than "we blocked each other".
 *
 * **`actions` names WHICH irreversible actions collided**, not merely that one
 * did. A rule may carry both A1 and A2, and an operator reading the block needs
 * to know which of them has a rival — otherwise the remediation is a guess.
 *
 * @module libs/core/src/automation/domain/types
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.5, §5.6
 */
import type { AutomationActionKind } from './automation-action.types';
import type { AutomationRule } from '../entities/automation-rule.entity';

/** One rule that will NOT run, and the rules it collided with. */
export interface AutomationBlockedRule {
  readonly ruleId: string;
  /**
   * Every rule in the collision, INCLUDING `ruleId` itself. This is what is
   * persisted as `automation_runs.blockedByRuleIds`.
   */
  readonly collidingRuleIds: readonly string[];
  /** The irreversible action kinds that collided, in `AutomationActionValues` order. */
  readonly actions: readonly AutomationActionKind[];
}

/**
 * The partition of one matched-rule set.
 *
 * `dispatchable` preserves the caller's (evaluation) order, so the dispatcher
 * sees rules in the same sequence it would have without the gate.
 */
export interface AutomationGateResult {
  readonly dispatchable: readonly AutomationRule[];
  readonly blocked: readonly AutomationBlockedRule[];
}
