/**
 * Automation Trigger Emission Service (#2360, Wave-2 spec §5.2)
 *
 * Loads the candidate rules, runs the pure #2359 evaluator, records the durable
 * firing for a `deadline-sweep` trigger, and hands the survivors to the
 * dispatch seam. Four properties are contract.
 *
 * **1. It loads EVERY rule on the trigger, active and inactive alike.**
 * `findByTrigger` returns both by design, and pre-filtering to active in SQL is
 * the attractive optimisation that must not be taken: `evaluateAutomationRules`
 * already classifies an inactive rule as `rule-inactive` and excludes it from
 * `matched`, and that reason is the only way #2363's dry run can tell the
 * operator *"your rule is switched off"*. Filtering here would silently delete
 * an explanation and save nothing an index does not already provide.
 *
 * **2. The firing claim gates the dispatch, and only for `deadline-sweep`.**
 * The mode comes from #2358's `AUTOMATION_TRIGGER_FIRING_MODE` via
 * `isDeadlineSweepTrigger` — never restated here. An `edge` trigger needs no
 * record because the WRITE that caused it happens once; a sweep re-observes the
 * same standing fact every tick, so the record is the only thing standing
 * between *"on hold for 48 hours"* and 288 firings.
 *
 * **3. The claim is taken BEFORE dispatch, deliberately.** A crash between
 * claim and dispatch loses a firing — silent, and the safe direction. The
 * reverse order would dispatch and then fail to record, and the next tick would
 * buy a second label. (A lost firing is silent precisely because this table is
 * not the run log; the operator-facing record of "nothing happened" is
 * `automation_runs`, #2385's job.)
 *
 * **4. A losing claim removes only its own rule.** One rule already fired for
 * this subject says nothing about its siblings, so the others still dispatch.
 *
 * @module libs/core/src/automation/application/services
 * @implements {IAutomationTriggerEmissionService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { AUTOMATION_DISPATCH_SERVICE_TOKEN, AUTOMATION_RULE_REPOSITORY_TOKEN, AUTOMATION_TRIGGER_FIRING_REPOSITORY_TOKEN } from '../../automation.tokens';
import { evaluateAutomationRules } from '../../domain/domain-services/evaluate-automation-rules';
import type { AutomationRule } from '../../domain/entities/automation-rule.entity';
import { AutomationRuleRepositoryPort } from '../../domain/ports/automation-rule-repository.port';
import { AutomationTriggerFiringRepositoryPort } from '../../domain/ports/automation-trigger-firing-repository.port';
import { isDeadlineSweepTrigger } from '../../domain/types/automation-trigger.types';
import { IAutomationDispatchService } from '../interfaces/automation-dispatch.service.interface';
import type {
  AutomationEmissionInput,
  AutomationEmissionResult,
  IAutomationTriggerEmissionService,
} from '../interfaces/automation-trigger-emission.service.interface';

@Injectable()
export class AutomationTriggerEmissionService implements IAutomationTriggerEmissionService {
  constructor(
    @Inject(AUTOMATION_RULE_REPOSITORY_TOKEN)
    private readonly ruleRepository: AutomationRuleRepositoryPort,
    @Inject(AUTOMATION_TRIGGER_FIRING_REPOSITORY_TOKEN)
    private readonly firingRepository: AutomationTriggerFiringRepositoryPort,
    @Inject(AUTOMATION_DISPATCH_SERVICE_TOKEN)
    private readonly dispatcher: IAutomationDispatchService,
  ) {}

  async emit(input: AutomationEmissionInput): Promise<AutomationEmissionResult> {
    // A caller holding the rule set passes it (the sweep does; the T5 write site
    // does not) — see `AutomationEmissionInput.rules` for why re-reading per
    // emission was N+1.
    const rules = input.rules ?? (await this.ruleRepository.findByTrigger(input.trigger));
    if (rules.length === 0) {
      return { firedRuleIds: [], alreadyFiredRuleIds: [], evaluatedRuleCount: 0 };
    }

    const evaluation = evaluateAutomationRules({
      trigger: input.trigger,
      facts: input.facts,
      rules,
      now: input.now,
    });

    const rulesById = new Map(rules.map((rule) => [rule.id, rule] as const));
    const matched = evaluation.matched
      .map((entry) => rulesById.get(entry.ruleId))
      .filter((rule): rule is AutomationRule => rule !== undefined);

    const needsFiringRecord = isDeadlineSweepTrigger(input.trigger);
    const toDispatch: AutomationRule[] = [];
    const alreadyFiredRuleIds: string[] = [];

    for (const rule of matched) {
      if (!needsFiringRecord) {
        toDispatch.push(rule);
        continue;
      }
      const won = await this.firingRepository.claim({
        ruleId: rule.id,
        subjectKind: input.facts.subjectKind,
        subjectId: input.facts.subjectId,
        firedAt: input.now,
      });
      if (won) {
        toDispatch.push(rule);
      } else {
        alreadyFiredRuleIds.push(rule.id);
      }
    }

    if (toDispatch.length > 0) {
      await this.dispatcher.dispatch({
        trigger: input.trigger,
        facts: input.facts,
        matchedRules: toDispatch,
        now: input.now,
      });
    }

    return {
      firedRuleIds: toDispatch.map((rule) => rule.id),
      alreadyFiredRuleIds,
      evaluatedRuleCount: rules.length,
    };
  }
}
