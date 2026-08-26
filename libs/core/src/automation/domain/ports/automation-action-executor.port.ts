/**
 * Automation Action Executor Port (#2361, Wave-2 spec §5.3)
 *
 * The contract one action step runs behind. Spec §5.3's admission rule is the
 * whole design: an action is admissible only if it invokes an operation
 * OpenLinker ALREADY ships end to end, with its own idempotency and failure
 * handling solved — so an executor DELEGATES and adds nothing of its own.
 *
 * **An executor never throws for a business condition.** A refusal, a missing
 * recipient, an unresolvable delegate: each is a returned `failed` step. The
 * runner catches a throw as a backstop, but a thrown business condition loses
 * the `detail` an operator needs and makes the step indistinguishable from a
 * defect. Returning is what keeps every non-executing exit observable.
 *
 * @module libs/core/src/automation/domain/ports
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.3
 */
import type { AutomationRule } from '../entities/automation-rule.entity';
import type { AutomationAction } from '../types/automation-action.types';
import type { AutomationSubjectFacts } from '../types/automation-facts.types';
import type { AutomationStepResult } from '../types/automation-step-result.types';

export interface AutomationActionExecutionInput {
  /** This step's own action, already narrowed by the registry's key. */
  readonly action: AutomationAction;
  /** The subject the trigger fired about — see `AutomationSubjectFacts`. */
  readonly facts: AutomationSubjectFacts;
  /** The firing rule. Carries `{rule.name}` for templated parameters (§5.3b). */
  readonly rule: AutomationRule;
  /** Position in the rule's `actions` array. */
  readonly stepIndex: number;
  /** The emitting caller's instant. Never read from a clock below this line. */
  readonly now: Date;
}

export interface AutomationActionExecutorPort {
  execute(input: AutomationActionExecutionInput): Promise<AutomationStepResult>;
}
