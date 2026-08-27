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
import type { AutomationRulePersistInput } from '../../domain/ports/automation-rule-repository.port';
import type { AutomationTrigger } from '../../domain/types/automation-trigger.types';
import type { AutomationRuleInput } from '../types/automation-rule-write.types';

/**
 * The §5.7 S3-2 money acknowledgement a write may carry (#2363).
 *
 * `null` means *"the caller said nothing about the ack"* — which is not the same
 * as clearing it. Clearing happens on its own rule (a changed `definitionHash`),
 * never by omission.
 */
export interface AutomationMoneyAckInput {
  /** The acknowledging operator, taken from the verified token — never from a body. */
  readonly byUserId: string;
}

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
  createRule(
    input: AutomationRuleInput,
    moneyAck?: AutomationMoneyAckInput | null,
  ): Promise<AutomationRule>;

  /**
   * Re-validate, re-hash and persist an existing rule. The duplicate guard
   * excludes the row being updated, so re-saving a rule unchanged is not a
   * conflict with itself.
   *
   * @throws {AutomationRuleNotFoundError}
   */
  /**
   * @param moneyAck the §5.7 S3-2 acknowledgement, or `null` when the caller
   * supplies none.
   *
   * **Optional, and the omission is safe in one direction only — which is why it
   * is stated here rather than left to be inferred.** Omitting it can only fail
   * to STAMP an ack; it can never grant one, and it never suppresses the
   * definition-change CLEAR below. So a pre-#2363 caller that never passes it
   * behaves exactly as it did, and no path exists by which forgetting this
   * argument records consent nobody gave.
   */
  updateRule(
    id: string,
    input: AutomationRuleInput,
    moneyAck?: AutomationMoneyAckInput | null,
  ): Promise<AutomationRule>;

  getRule(id: string): Promise<AutomationRule | null>;

  listRulesByTrigger(trigger: AutomationTrigger): Promise<AutomationRule[]>;

  /**
   * How many rules exist per trigger — the §5.5 divergence-1 trigger index page
   * (#2363). A pass-through to the repository method #2358 shipped for exactly
   * this, so the automations index is a per-trigger drill-down rather than an
   * unindexed read of the whole table.
   */
  countRulesByTrigger(): Promise<Map<AutomationTrigger, number>>;

  /**
   * Validate and hash a rule **without persisting anything** (#2363).
   *
   * The §5.6(a) dry run's draft path is its only caller, and its whole purpose is
   * that an operator can test a money rule BEFORE arming it — which requires the
   * same vocabulary, legality and step-count refusals the write path applies,
   * with no row created. It throws the identical exceptions `createRule` does, so
   * a preview and a save can never disagree about what is legal.
   *
   * There is no repository reference anywhere in its implementation. That is
   * what makes "the dry run commits nothing" structural rather than a promise.
   */
  validateRule(input: AutomationRuleInput): AutomationRulePersistInput;

  /**
   * Stamp or clear a rule's §5.7 S3-2 money acknowledgement.
   *
   * `null` clears. Separate from `updateRule` because the ack is evidence about
   * a past operator act, not part of the rule's definition — folding it into the
   * persist input would put it inside the `definitionHash` it is evidence ABOUT.
   *
   * @throws {AutomationRuleNotFoundError}
   */
  setMoneyAck(id: string, byUserId: string | null): Promise<AutomationRule>;

  /** @throws {AutomationRuleNotFoundError} */
  deleteRule(id: string): Promise<void>;
}
