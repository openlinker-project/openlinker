/**
 * Automation Rules Service Interface (#2358)
 *
 * The write-path contract for `automation_rules` — validation, the computed
 * definition hash, and the save-time duplicate guard. Consumed by #2363's HTTP
 * surface; the evaluator (#2359) and the trigger emitters (#2360) read through
 * the repository port instead, since they need no write semantics.
 *
 * @module libs/core/src/automation/application/interfaces
 */
import type { AutomationRule } from '../../domain/entities/automation-rule.entity';
import type { AutomationTrigger } from '../../domain/types/automation-trigger.types';
import type { AutomationRuleInput } from '../types/automation-rule-write.types';

export interface IAutomationRulesService {
  /**
   * Validate, hash and persist a new rule.
   *
   * @throws {AutomationInvalidTriggerConfigError}
   * @throws {AutomationInvalidConditionError}
   * @throws {AutomationInvalidActionError}
   * @throws {AutomationStepCountError}
   * @throws {AutomationRuleConflictError} an identical definition covers an overlapping window
   */
  createRule(input: AutomationRuleInput): Promise<AutomationRule>;

  /**
   * Re-validate, re-hash and persist an existing rule. The duplicate guard
   * excludes the row being updated, so re-saving a rule unchanged is not a
   * conflict with itself.
   *
   * @throws {AutomationRuleNotFoundError}
   */
  updateRule(id: string, input: AutomationRuleInput): Promise<AutomationRule>;

  getRule(id: string): Promise<AutomationRule | null>;

  listRulesByTrigger(trigger: AutomationTrigger): Promise<AutomationRule[]>;

  /** @throws {AutomationRuleNotFoundError} */
  deleteRule(id: string): Promise<void>;
}
