/**
 * Automation Trigger Emission Service Interface (#2360, Wave-2 spec §5.2)
 *
 * The ONE seam every trigger emits through, whatever its firing mode. Both
 * shipped triggers call it (T5 `order.packed` from its write site, T4
 * `order.dispatch_deadline_near` from the deadline sweep), and each of the six
 * deferred triggers becomes one call site plus a facts projection — nothing
 * about this contract is shaped around either current consumer.
 *
 * @module libs/core/src/automation/application/interfaces
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.2
 */
import type { AutomationRule } from '../../domain/entities/automation-rule.entity';
import type { AutomationSubjectFacts } from '../../domain/types/automation-facts.types';
import type { AutomationTrigger } from '../../domain/types/automation-trigger.types';

export interface AutomationEmissionInput {
  readonly trigger: AutomationTrigger;
  /** Already assembled by the caller — see `AutomationSubjectFacts`. */
  readonly facts: AutomationSubjectFacts;
  /**
   * The caller's instant, passed straight to the pure evaluator.
   *
   * An ARGUMENT, never a clock read: #2359's evaluator must never read the
   * system clock, and a `new Date()` here would put one back one layer up,
   * where the specs and the dry run can no longer control it.
   */
  readonly now: Date;
  /**
   * Rules already loaded by the caller, to be used instead of re-reading them.
   *
   * The deadline sweep holds the rule set for its whole page (it needs the widest
   * window before it can even build the candidate query), and emits once per
   * (candidate x threshold) — so without this the seam would re-read the same
   * rows up to `pageBudget x thresholds` times per tick, for data the caller is
   * holding in memory.
   *
   * Omit it and the seam loads its own, which is what the T5 write-site caller
   * does: it has one subject and no rules in hand.
   *
   * Pass ONLY rules genuinely scoped to `trigger` — the seam does not re-filter,
   * and the evaluator would report a foreign rule as `trigger-mismatch` rather
   * than refusing it.
   */
  readonly rules?: readonly AutomationRule[];
}

export interface AutomationEmissionResult {
  /** Rules that matched AND (for a sweep trigger) won their firing claim — i.e. what was dispatched. */
  readonly firedRuleIds: readonly string[];
  /** Matched but already recorded as fired for this subject; `deadline-sweep` only. */
  readonly alreadyFiredRuleIds: readonly string[];
  /** How many rules were evaluated, so a caller can tell "no rules" from "no matches". */
  readonly evaluatedRuleCount: number;
}

export interface IAutomationTriggerEmissionService {
  emit(input: AutomationEmissionInput): Promise<AutomationEmissionResult>;
}
