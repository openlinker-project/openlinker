/**
 * Automation Run Recorder Interface (#2361, the seam #2385 implements)
 *
 * Where a firing's outcome is reported once it has run. Declared here with a
 * logging implementation so that #2385's `automation_runs` write path arrives as
 * a PROVIDER SWAP — the same discipline #2360 applied to the dispatch seam this
 * slice just replaced.
 *
 * **Every dispatch path calls this exactly once per rule**, including the paths
 * where nothing executed. A silent decline is the defect class this programme
 * keeps closing (the `SalesDocumentBlockOutcome` precedent, #2100 §54): an
 * operator must be able to tell "the rule fired and did nothing" from "the rule
 * never fired", and only a recorded outcome distinguishes them.
 *
 * **The recorder never throws.** It is a reporting seam on the tail of a
 * firing whose effects have already happened; letting a logging failure
 * propagate would turn a recorded success into a job retry that re-runs the
 * steps. #2385 inherits that contract.
 *
 * @module libs/core/src/automation/application/interfaces
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.6
 */
import type { AutomationRule } from '../../domain/entities/automation-rule.entity';
import type { AutomationSubjectFacts } from '../../domain/types/automation-facts.types';
import type { AutomationRunOutcome } from '../../domain/types/automation-run.types';
import type { AutomationStepResult } from '../../domain/types/automation-step-result.types';
import type { AutomationTrigger } from '../../domain/types/automation-trigger.types';

export interface AutomationRunRecord {
  readonly rule: AutomationRule;
  readonly trigger: AutomationTrigger;
  readonly facts: AutomationSubjectFacts;
  readonly outcome: AutomationRunOutcome;
  readonly steps: readonly AutomationStepResult[];
  readonly firedAt: Date;
  /**
   * Only on `outcome === 'blocked'` (#2362): every rule in the collision,
   * INCLUDING `rule` itself. Persisted verbatim as
   * `automation_runs.blockedByRuleIds`, whose column already exists (#2358) —
   * §5.6 requires a blocked row to say which rules collided, and a single
   * `ruleId` can name only one of them.
   *
   * **Widened, never forked.** #2385 persists this record as it stands; a
   * second record shape is how one firing renders differently in the run log
   * and the timeline, which §5.6's "one record, four readings" exists to
   * prevent. Optional so every pre-#2362 caller compiles untouched.
   */
  readonly blockedByRuleIds?: readonly string[];
}

export interface IAutomationRunRecorderService {
  record(run: AutomationRunRecord): Promise<void>;
}
