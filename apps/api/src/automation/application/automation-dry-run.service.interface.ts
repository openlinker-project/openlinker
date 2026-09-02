/**
 * Automation Dry-Run Service Interface (#2363, Wave-2 spec §5.6a)
 *
 * The §5.6(a) gate an operator passes before arming a rule that spends money:
 * *"would this rule have fired for that order, and if not, which condition
 * stopped it?"*
 *
 * @module apps/api/src/automation/application
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.6
 */
import type {
  AutomationBlockedRule,
  AutomationConditionTrace,
  AutomationNonFiringReason,
  AutomationRuleInput,
  AutomationSubjectFacts,
  AutomationTrigger,
} from '@openlinker/core/automation';

/** The id given to the transient rule built from a draft. Never persisted. */
export const AUTOMATION_DRAFT_RULE_ID = '__draft__';

export interface AutomationDryRunRuleVerdict {
  readonly ruleId: string;
  readonly ruleName: string;
  /** `true` when this verdict is about the rule the caller asked about. */
  readonly isSubject: boolean;
  /** The rule is armed. A disarmed rule still gets a full verdict, and says so. */
  readonly isActive: boolean;
  /** The evaluator matched it. Not the same as `wouldFire` — see below. */
  readonly matches: boolean;
  /**
   * `matches` AND the #2362 at-most-one gate let it through. The two differ
   * exactly when another matched rule wants the same irreversible action, which
   * is the S3-3 scenario the dry run exists to make visible before it costs a
   * second label.
   */
  readonly wouldFire: boolean;
  readonly nonFiringReason: AutomationNonFiringReason | null;
  /** Every condition in the rule's own order. Empty only for a rule about a different event. */
  readonly conditionTraces: readonly AutomationConditionTrace[];
  /**
   * `true` when the retroactivity floor WOULD have blocked this rule and the dry
   * run waived it. The preview then says *"this matches, but it would not have
   * fired for this order"*, which is the true sentence.
   */
  readonly retroactivityFloorWaived: boolean;
  /** Populated when the gate refused it: which rules collided, and on which actions. */
  readonly blockedBy: AutomationBlockedRule | null;
  /** Per-step availability in this build, in the rule's own step order. */
  readonly stepAvailability: readonly {
    readonly action: string;
    readonly availability: string;
    readonly reason: string | null;
  }[];
}

export interface AutomationDryRunResult {
  readonly trigger: AutomationTrigger;
  /** The facts the evaluator actually used — a projection, never the order snapshot. */
  readonly facts: AutomationSubjectFacts;
  readonly evaluatedAt: Date;
  /** Every rule scoped to the trigger, plus the subject. */
  readonly verdicts: readonly AutomationDryRunRuleVerdict[];
}

export interface AutomationDryRunInput {
  readonly orderId: string;
  /** Exactly one of these two is set; the controller's DTO enforces it. */
  readonly ruleId?: string;
  readonly draft?: AutomationRuleInput;
}

export interface IAutomationDryRunService {
  /**
   * Evaluate one order against a saved rule or an unsaved draft.
   *
   * **Commits nothing and dispatches nothing.** Structurally: this service reads
   * three things, calls two pure functions, and holds no reference to any
   * repository, to `AUTOMATION_DISPATCH_SERVICE_TOKEN`, or to the job queue.
   */
  evaluate(input: AutomationDryRunInput): Promise<AutomationDryRunResult>;
}
