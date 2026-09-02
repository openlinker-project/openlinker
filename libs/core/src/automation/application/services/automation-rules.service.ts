/**
 * Automation Rules Service (#2358, Wave-2 spec §5)
 *
 * Owns the automation write path: vocabulary validation, the computed
 * `definitionHash`, and the save-time duplicate guard. Injects ONLY this
 * concern's own repository port — no `IIntegrationsService`, no connection
 * lookup, no capability check — mirroring `SalesDocumentRulesService`'s posture
 * (#2170).
 *
 * The legality matrix of spec §5.4, which rejects a trigger→action pair that
 * could never fire, is declared by **#2359** and enforced HERE rather than only
 * in the #2363 controller — this is the write choke point every caller reaches,
 * so an illegal pair cannot be persisted by curl either. #2363's own validation
 * is defence in depth and a nicer error, never the only line.
 *
 * ## The duplicate guard is two layers, and neither is the money guard
 *
 * **Semantic (here):** an identical definition covering an OVERLAPPING
 * effective window is refused. Two identical rules both active would both fire,
 * doubling every email and every label; two identical rules with
 * non-overlapping windows are the legitimate versioning case and are allowed.
 *
 * This differs from #2170's guard in shape, because it differs in purpose.
 * #2170 skips candidates on the SAME `connectionId` and conflicts only ACROSS
 * connections, since its conflict is *ambiguity between routes*. An automation
 * rule has no connection axis, so any overlapping identical definition is pure
 * *duplication* and conflicting on all of them is correct.
 *
 * **Exact (repository):** the `(trigger, definitionHash, effectiveFrom)` unique
 * index, whose violation the repository translates into the same
 * `AutomationRuleConflictError`, so a concurrent race is a domain error rather
 * than a raw 500. Deliberately not transactional or locked — same posture as
 * #2170; the index is the last line.
 *
 * **Neither is the #2047 money-collision guard.** Spec §5.5 divergence 3 places
 * the at-most-one rule for irreversible actions at RUNTIME (#2362); the
 * save-time guard only warns where it can see an overlap. Two rules with the
 * same trigger and the same A2 action but DIFFERENT conditions, both matching
 * one order, is the S3-3 scenario and passes this guard cleanly, by design.
 *
 * @module libs/core/src/automation/application/services
 * @implements {IAutomationRulesService}
 */
import { Inject, Injectable } from '@nestjs/common';

import type {
  AutomationMoneyAckInput,
  IAutomationRulesService,
} from '../interfaces/automation-rules.service.interface';
import { AUTOMATION_RULE_REPOSITORY_TOKEN } from '../../automation.tokens';
import {
  AutomationRuleRepositoryPort} from '../../domain/ports/automation-rule-repository.port';
import type {
  AutomationRulePersistInput
} from '../../domain/ports/automation-rule-repository.port';
import type { AutomationRule } from '../../domain/entities/automation-rule.entity';
import type { AutomationRuleInput } from '../types/automation-rule-write.types';
import type { AutomationTrigger } from '../../domain/types/automation-trigger.types';
import type {
  AutomationAction} from '../../domain/types/automation-action.types';
import {
  AUTOMATION_ACTION_MAX_STEPS,
  AUTOMATION_ACTION_MIN_STEPS,
  isAutomationAction,
} from '../../domain/types/automation-action.types';
import type {
  AutomationCondition} from '../../domain/types/automation-condition.types';
import {
  isAutomationCondition,
} from '../../domain/types/automation-condition.types';
import type {
  AutomationTriggerConfig} from '../../domain/types/automation-trigger-config.types';
import {
  isAutomationTriggerConfig,
} from '../../domain/types/automation-trigger-config.types';
import { computeAutomationDefinitionHash } from '../../domain/types/automation-definition-hash.types';
import {
  isLegalAutomationConditionField,
  isLegalAutomationPair,
} from '../../domain/types/automation-legality.types';
import { AutomationIllegalConditionFieldError } from '../../domain/exceptions/automation-illegal-condition-field.error';
import { AutomationIllegalPairError } from '../../domain/exceptions/automation-illegal-pair.error';
import { AutomationInvalidActionError } from '../../domain/exceptions/automation-invalid-action.error';
import { AutomationInvalidConditionError } from '../../domain/exceptions/automation-invalid-condition.error';
import { AutomationInvalidTriggerConfigError } from '../../domain/exceptions/automation-invalid-trigger-config.error';
import { AutomationRuleConflictError } from '../../domain/exceptions/automation-rule-conflict.error';
import { AutomationRuleNotFoundError } from '../../domain/exceptions/automation-rule-not-found.error';
import { AutomationStepCountError } from '../../domain/exceptions/automation-step-count.error';

/** Open-ended `effectiveTo` is effectively +infinity — the #2170 sentinel. */
const OPEN_ENDED = new Date(8640000000000000);

function rangesOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  const aEnd = aTo ?? OPEN_ENDED;
  const bEnd = bTo ?? OPEN_ENDED;
  return aFrom.getTime() <= bEnd.getTime() && bFrom.getTime() <= aEnd.getTime();
}

@Injectable()
export class AutomationRulesService implements IAutomationRulesService {
  constructor(
    @Inject(AUTOMATION_RULE_REPOSITORY_TOKEN)
    private readonly ruleRepository: AutomationRuleRepositoryPort,
  ) {}

  async createRule(
    input: AutomationRuleInput,
    moneyAck: AutomationMoneyAckInput | null = null,
  ): Promise<AutomationRule> {
    const persistInput = this.validateAndHash(input);
    await this.assertNoConflict(persistInput, null);
    const created = await this.ruleRepository.create(persistInput);
    if (moneyAck === null) return created;
    // Stamped after the row exists, for the same reason the update path stamps
    // last: a crash leaves an un-acknowledged rule, never an acknowledgement
    // attached to a definition that was never saved.
    return this.ruleRepository.setMoneyAck(created.id, moneyAck.byUserId, new Date());
  }

  /**
   * Re-validate, re-hash and persist — and resolve the §5.7 S3-2 money
   * acknowledgement (#2363).
   *
   * ## The ack is cleared if and only if the `definitionHash` changes
   *
   * The ack is evidence about WHAT THE RULE DOES, and the definition already has
   * a canonical identity: the SHA-256 over `(trigger, triggerConfig, conditions,
   * actions)` #2358 computes for the duplicate guard. So a rename, an arm/disarm
   * or a moved effective window keeps it; changing the trigger, a threshold, a
   * condition or any action clears it.
   *
   * Both alternatives are worse in a way that matters. *Clear on every edit*
   * makes an operator click through a money warning to fix a typo in a name,
   * which is how a warning stops being read — and the ack's entire value is that
   * somebody actually considered it. *Never clear* lets an ack given for "email
   * me when an order is packed" carry forward silently to "buy a DPD label when
   * an order is packed": consent on record for an act nobody consented to. The
   * hash is the only line between the two that is neither ceremony nor a lie, it
   * needs no new state, and it cannot drift because the same value already
   * decides rule identity everywhere else in this context.
   *
   * ## Ordering, and the failure direction it buys
   *
   * The clear runs BEFORE the definition update; a new stamp runs after it
   * succeeds. A crash between them therefore leaves the OLD definition with NO
   * ack — never a new definition carrying an old ack. Nothing in the dispatcher
   * reads the ack (it is an authoring-time record, not a firing gate), so that
   * costs one re-acknowledgement and can never cause a wrong firing. Two writes
   * rather than one transaction is the deliberate trade: the safe direction is
   * available by ordering alone.
   */
  async updateRule(
    id: string,
    input: AutomationRuleInput,
    moneyAck: AutomationMoneyAckInput | null = null,
  ): Promise<AutomationRule> {
    const existing = await this.ruleRepository.findById(id);
    if (existing === null) throw new AutomationRuleNotFoundError(id);

    const persistInput = this.validateAndHash(input);
    // Exclude the row being updated, so re-saving a rule unchanged is not a
    // conflict with itself.
    await this.assertNoConflict(persistInput, id);

    const definitionChanged = persistInput.definitionHash !== existing.definitionHash;
    if (definitionChanged && existing.moneyAckByUserId !== null) {
      await this.ruleRepository.setMoneyAck(id, null, null);
    }

    const updated = await this.ruleRepository.update(id, persistInput);
    if (moneyAck === null) return updated;
    return this.ruleRepository.setMoneyAck(id, moneyAck.byUserId, new Date());
  }

  countRulesByTrigger(): Promise<Map<AutomationTrigger, number>> {
    return this.ruleRepository.countRulesByTrigger();
  }

  /**
   * The narrow-and-hash step with **no repository call of any kind** — see the
   * interface docblock. Extracted from `validateAndHash` rather than duplicating
   * it, so the dry run cannot come to disagree with the write path about what is
   * legal.
   */
  validateRule(input: AutomationRuleInput): AutomationRulePersistInput {
    return this.validateAndHash(input);
  }

  async setMoneyAck(id: string, byUserId: string | null): Promise<AutomationRule> {
    const existing = await this.ruleRepository.findById(id);
    if (existing === null) throw new AutomationRuleNotFoundError(id);
    return this.ruleRepository.setMoneyAck(id, byUserId, byUserId === null ? null : new Date());
  }

  async getRule(id: string): Promise<AutomationRule | null> {
    return this.ruleRepository.findById(id);
  }

  async listRulesByTrigger(trigger: AutomationTrigger): Promise<AutomationRule[]> {
    return this.ruleRepository.findByTrigger(trigger);
  }

  async deleteRule(id: string): Promise<void> {
    const existing = await this.ruleRepository.findById(id);
    if (existing === null) throw new AutomationRuleNotFoundError(id);
    await this.ruleRepository.delete(id);
  }

  /**
   * Narrow every untrusted member, then compute the hash over the result.
   *
   * Order matters: the hash must be taken over the NARROWED values, so two
   * rules that differ only in a field the narrower rejects can never hash the
   * same and slip past the guard.
   */
  private validateAndHash(input: AutomationRuleInput): AutomationRulePersistInput {
    const triggerConfig = this.assertTriggerConfigWellFormed(input);
    const conditions = this.assertConditionsWellFormed(input.conditions);
    const actions = this.assertActionsWellFormed(input.actions);
    this.assertPairsLegal(input.trigger, actions);
    this.assertConditionFieldsLegal(input.trigger, conditions);

    const definitionHash = computeAutomationDefinitionHash({
      trigger: input.trigger,
      triggerConfig,
      conditions,
      actions,
    });

    return {
      name: input.name,
      trigger: input.trigger,
      triggerConfig,
      conditions,
      actions,
      definitionHash,
      // Fails closed: a rule is armed deliberately, never by omission. The
      // column default is belt-and-braces only — it never fires, because this
      // always supplies a boolean.
      isActive: input.isActive ?? false,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
    };
  }

  private assertTriggerConfigWellFormed(input: AutomationRuleInput): AutomationTriggerConfig {
    if (!isAutomationTriggerConfig(input.trigger, input.triggerConfig)) {
      throw new AutomationInvalidTriggerConfigError(input.trigger);
    }
    return input.triggerConfig;
  }

  /**
   * Refuse a malformed condition on the way IN.
   *
   * Deliberately asymmetric with the read path, where the repository filters a
   * malformed persisted condition to "never matches" instead of throwing: one
   * bad row must not crash every read of the rule carrying it, but on the way
   * in there is an operator to tell.
   */
  private assertConditionsWellFormed(
    conditions: readonly unknown[],
  ): readonly AutomationCondition[] {
    const narrowed: AutomationCondition[] = [];
    conditions.forEach((condition, index) => {
      if (!isAutomationCondition(condition)) throw new AutomationInvalidConditionError(index);
      narrowed.push(condition);
    });
    return narrowed;
  }

  private assertActionsWellFormed(actions: readonly unknown[]): readonly AutomationAction[] {
    if (actions.length < AUTOMATION_ACTION_MIN_STEPS || actions.length > AUTOMATION_ACTION_MAX_STEPS) {
      throw new AutomationStepCountError(
        actions.length,
        AUTOMATION_ACTION_MIN_STEPS,
        AUTOMATION_ACTION_MAX_STEPS,
      );
    }
    const narrowed: AutomationAction[] = [];
    actions.forEach((action, index) => {
      if (!isAutomationAction(action)) throw new AutomationInvalidActionError(index);
      narrowed.push(action);
    });
    return narrowed;
  }

  /**
   * Refuse a trigger→action pair the §5.4 matrix forbids (#2359).
   *
   * Runs AFTER the shape narrowers, so `step.action` is already a member of the
   * closed vocabulary and a refusal here can only mean the pair itself. Checked
   * per step, and one illegal step refuses the whole rule: a rule that would run
   * its legal steps and skip an impossible one has behaviour nobody declared.
   */
  private assertPairsLegal(trigger: AutomationTrigger, actions: readonly AutomationAction[]): void {
    actions.forEach((step, index) => {
      if (!isLegalAutomationPair(trigger, step.action)) {
        throw new AutomationIllegalPairError(trigger, step.action, index);
      }
    });
  }

  /**
   * Refuse a condition field the trigger may not be scoped by (#2359, spec §5.5
   * divergence 2 — `holdReason` is offered only for T1/T2/T3).
   *
   * The evaluator deliberately does NOT guard this: a `holdReason` condition on
   * an `order.packed` rule already resolves through the ordinary path, reading
   * `unknown` with the offending condition visible in its trace, which is an
   * explanation rather than a bare rejection. But that is only an acceptable
   * runtime posture because such a rule cannot be AUTHORED — without this
   * check it persists happily via curl and then never fires, which is exactly
   * the "saves, arms, never fires" defect the legality tables exist to prevent.
   */
  private assertConditionFieldsLegal(
    trigger: AutomationTrigger,
    conditions: readonly AutomationCondition[],
  ): void {
    conditions.forEach((condition, index) => {
      if (!isLegalAutomationConditionField(trigger, condition.field)) {
        throw new AutomationIllegalConditionFieldError(trigger, condition.field, index);
      }
    });
  }

  private async assertNoConflict(
    input: AutomationRulePersistInput,
    excludeRuleId: string | null,
  ): Promise<void> {
    const candidates = await this.ruleRepository.findByTriggerAndDefinitionHash(
      input.trigger,
      input.definitionHash,
    );
    for (const candidate of candidates) {
      if (candidate.id === excludeRuleId) continue;
      if (
        rangesOverlap(
          input.effectiveFrom,
          input.effectiveTo,
          candidate.effectiveFrom,
          candidate.effectiveTo,
        )
      ) {
        throw new AutomationRuleConflictError(input.trigger, input.definitionHash, candidate.id);
      }
    }
  }
}
