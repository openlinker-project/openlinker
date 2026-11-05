/**
 * Gift Rule Service (#3938)
 *
 * Application service over the gift ledger and the rule list. See
 * {@link IGiftRuleService}. It reads rules through the rules port and the ledger
 * through its own port, and adds nothing of its own to either: ordering, counting
 * and pausing are decisions the planner and the ingestion path make.
 *
 * @module libs/core/src/automation/application/services
 * @implements {IGiftRuleService}
 */
import { Inject, Injectable } from '@nestjs/common';

import type {
  GiftLedgerSnapshot,
  GiftRuleView,
  IGiftRuleService,
} from '../interfaces/gift-rule.service.interface';
import {
  AUTOMATION_RULE_REPOSITORY_TOKEN,
  GIFT_RULE_LEDGER_REPOSITORY_TOKEN,
} from '../../automation.tokens';
import { AutomationRuleRepositoryPort } from '../../domain/ports/automation-rule-repository.port';
import { GiftRuleLedgerPort } from '../../domain/ports/gift-rule-ledger.port';
import type { AutomationRule } from '../../domain/entities/automation-rule.entity';
import { sortGiftRules } from '../../domain/domain-services/plan-gift-application';
import { AutomationRuleNotFoundError } from '../../domain/exceptions/automation-rule-not-found.error';
import type {
  GiftGrant,
  GiftRuleState,
  GiftRuleStateChange,
} from '../../domain/types/gift-rule.types';

@Injectable()
export class GiftRuleService implements IGiftRuleService {
  constructor(
    @Inject(AUTOMATION_RULE_REPOSITORY_TOKEN)
    private readonly rules: AutomationRuleRepositoryPort,
    @Inject(GIFT_RULE_LEDGER_REPOSITORY_TOKEN)
    private readonly ledger: GiftRuleLedgerPort,
  ) {}

  async listOrderedRules(): Promise<AutomationRule[]> {
    return sortGiftRules(await this.rules.findByTrigger('order.ingested'));
  }

  async listGiftRules(): Promise<GiftRuleView[]> {
    const rules = await this.listOrderedRules();
    const ids = rules.map((rule) => rule.id);
    const [states, given] = await Promise.all([
      this.ledger.findStates(ids),
      this.ledger.sumUnitsGiven(ids),
    ]);
    return rules.map((rule) => this.toView(rule, states.get(rule.id) ?? null, given.get(rule.id) ?? 0));
  }

  withRulesLocked<T>(ruleIds: readonly string[], work: () => Promise<T>): Promise<T> {
    return this.ledger.withRulesLocked(ruleIds, work);
  }

  async getLedgerSnapshot(
    ruleIds: readonly string[],
    customerId: string | null,
  ): Promise<GiftLedgerSnapshot> {
    const [states, unitsGiven, customerUnits] = await Promise.all([
      this.ledger.findStates(ruleIds),
      this.ledger.sumUnitsGiven(ruleIds),
      customerId === null
        ? Promise.resolve(new Map<string, number>())
        : this.ledger.sumUnitsForCustomer(ruleIds, customerId),
    ]);
    return { states, unitsGiven, customerUnits };
  }

  getGrantsForOrder(internalOrderId: string): Promise<GiftGrant[]> {
    return this.ledger.findGrantsForOrder(internalOrderId);
  }

  recordGrant(grant: Omit<GiftGrant, 'createdAt'>): Promise<boolean> {
    return this.ledger.recordGrant(grant);
  }

  async applyStateChange(ruleId: string, change: GiftRuleStateChange): Promise<void> {
    if (change.kind === 'pause') {
      await this.ledger.setPause(ruleId, change.reason);
      return;
    }
    // Only a stock pause clears itself; a unit-cap pause needs the explicit resume.
    const [state] = [...(await this.ledger.findStates([ruleId])).values()];
    if (state?.pausedReason === 'gift-out-of-stock') await this.ledger.setPause(ruleId, null);
  }

  async resumeAfterCap(ruleId: string, additionalUnits: number): Promise<GiftRuleView> {
    const rule = await this.rules.findById(ruleId);
    if (rule === null || rule.trigger !== 'order.ingested') {
      throw new AutomationRuleNotFoundError(ruleId);
    }
    await this.ledger.extendCap(ruleId, Math.max(1, Math.floor(additionalUnits)));
    const [view] = (await this.listGiftRules()).filter((v) => v.rule.id === ruleId);
    return view;
  }

  private toView(
    rule: AutomationRule,
    state: GiftRuleState | null,
    unitsGiven: number,
  ): GiftRuleView {
    const step = rule.actions.find((a) => a.action === 'add-gift');
    const cap = step !== undefined && step.action === 'add-gift' ? step.unitCap : null;
    return {
      rule,
      state,
      unitsGiven,
      effectiveCap: cap === null ? null : cap + (state?.capExtension ?? 0),
    };
  }
}
