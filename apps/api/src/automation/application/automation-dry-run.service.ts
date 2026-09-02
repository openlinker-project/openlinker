/**
 * Automation Dry-Run Service (#2363, Wave-2 spec §5.6a)
 *
 * Evaluates one order against a saved rule or an unsaved draft, and returns what
 * WOULD have happened — the per-condition trace, the would-fire verdict, and the
 * #2362 at-most-one gate's refusals — having written nothing.
 *
 * ## Why it lives in `apps/api` and not in `libs/core/src/automation`
 *
 * It composes two contexts: automation rules and order facts. `OrdersModule`
 * already imports `AutomationModule` for the T5 write-site emission, so a reverse
 * edge inside core would close a NestJS DI cycle — and ADR-041 decision 2 records
 * that there is no `forwardRef` anywhere in `libs/core`, `apps/api` or
 * `apps/worker`. The `AutomationSubjectFacts` docblock already says assembling
 * the facts is the CALLER's job; `apps/api` is where both halves are reachable,
 * exactly as the analytics-trust composition does it.
 *
 * ## Non-mutation is structural, not a promise
 *
 * Three reads (`getOrderRecord`, `getRule`, `listRulesByTrigger`), two pure
 * functions, and on the draft path `validateRule`, whose implementation contains
 * no repository reference at all. Nothing here injects a repository port, the
 * dispatch token, or a job queue — so there is no object in scope through which
 * this class could write. An int-spec pins it by counting rows.
 *
 * Note in particular that **`AUTOMATION_DISPATCH_SERVICE_TOKEN` is not injected**.
 * That token resolves to the #2362 gate rather than the raw dispatcher, but a dry
 * run must not reach a dispatcher of either kind.
 *
 * ## Three properties that are contract
 *
 * **1. It evaluates EVERY rule on the trigger, not just the subject.** A
 * collision is a fact about a SET; evaluating the subject alone would make the
 * S3-3 two-money-rules case invisible, which is the single most expensive thing
 * this preview exists to show before it is discovered by a second shipping label.
 *
 * **2. It always waives the retroactivity floor, and always reports the waiver.**
 * The floor asks *"did this fact happen after the operator saved the rule?"* —
 * the wrong question for a preview run against an order from last week, and for
 * a draft (whose `createdAt` is now) it would block every order. This is the
 * floor's ONLY intended caller; `AutomationEvaluationInput`'s own docblock calls
 * passing `false` on a committing path a defect. The waiver is surfaced per
 * verdict, so the preview can say *"this matches, but it would not have fired for
 * this order"* rather than silently differing from reality.
 *
 * **3. The facts come from the SAME projection the real firing uses.**
 * `buildOrderAutomationFacts` has two callers — the T5 emission and this. A
 * preview built from a different projection is a preview of something else.
 *
 * @module apps/api/src/automation/application
 * @implements {IAutomationDryRunService}
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AUTOMATION_RULES_SERVICE_TOKEN,
  AutomationRule,
  availabilityForAction,
  evaluateAutomationRules,
  gateIrreversibleAutomationActions,
  isAutomationActionKind,
  type AutomationBlockedRule,
  type AutomationRuleEvaluation,
  type IAutomationRulesService,
} from '@openlinker/core/automation';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  buildOrderAutomationFacts,
  type IOrderRecordService,
} from '@openlinker/core/orders';

import type {
  AutomationDryRunInput,
  AutomationDryRunResult,
  AutomationDryRunRuleVerdict,
  IAutomationDryRunService,
} from './automation-dry-run.service.interface';
import { AUTOMATION_DRAFT_RULE_ID } from './automation-dry-run.service.interface';

@Injectable()
export class AutomationDryRunService implements IAutomationDryRunService {
  constructor(
    @Inject(AUTOMATION_RULES_SERVICE_TOKEN)
    private readonly rules: IAutomationRulesService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService
  ) {}

  async evaluate(input: AutomationDryRunInput): Promise<AutomationDryRunResult> {
    const record = await this.orders.getOrderRecord(input.orderId);
    if (record === null) {
      throw new NotFoundException(`Order "${input.orderId}" not found.`);
    }

    const now = new Date();
    const subject = await this.resolveSubject(input, now);
    // `placedAt` is when the buyer bought, and the ordinary trigger fact for a
    // preview. `createdAt` is the fallback for a source that never asserted one
    // (WooCommerce, #2097) — absent it entirely, the floor could not be cleared
    // and every verdict would read `fact-time-unknown`, which tells the operator
    // about OUR ingestion rather than about their rule.
    const facts = buildOrderAutomationFacts(record, record.placedAt ?? record.createdAt);

    // Every rule scoped to the trigger, plus the subject when it is not one of
    // them (a draft, or a saved rule that is somehow absent from the read).
    const siblings = await this.rules.listRulesByTrigger(subject.trigger);
    const rules = siblings.some((rule) => rule.id === subject.id)
      ? siblings
      : [...siblings, subject];

    const evaluation = evaluateAutomationRules({
      trigger: subject.trigger,
      facts,
      rules,
      now,
      // See property 2 on the class. This is the one place in the tree that
      // passes `false`.
      enforceRetroactivityFloor: false,
    });

    const rulesById = new Map(rules.map((rule) => [rule.id, rule] as const));
    const matchedRules = evaluation.matched
      .map((entry) => rulesById.get(entry.ruleId))
      .filter((rule): rule is AutomationRule => rule !== undefined);
    const gate = gateIrreversibleAutomationActions(matchedRules);
    const blockedByRuleId = new Map<string, AutomationBlockedRule>(
      gate.blocked.map((blocked) => [blocked.ruleId, blocked] as const)
    );

    return {
      trigger: subject.trigger,
      facts,
      evaluatedAt: now,
      verdicts: evaluation.evaluations.map((entry) =>
        this.toVerdict(entry, rulesById, blockedByRuleId, subject.id)
      ),
    };
  }

  private toVerdict(
    entry: AutomationRuleEvaluation,
    rulesById: ReadonlyMap<string, AutomationRule>,
    blockedByRuleId: ReadonlyMap<string, AutomationBlockedRule>,
    subjectId: string
  ): AutomationDryRunRuleVerdict {
    const rule = rulesById.get(entry.ruleId);
    const blockedBy = blockedByRuleId.get(entry.ruleId) ?? null;
    return {
      ruleId: entry.ruleId,
      ruleName: entry.ruleName,
      isSubject: entry.ruleId === subjectId,
      isActive: rule?.isActive ?? false,
      matches: entry.matches,
      // The gate is the second half of the answer. A rule that matched and was
      // then refused must never render as "would fire" — that is the sentence an
      // operator arms a rule on.
      wouldFire: entry.matches && blockedBy === null,
      nonFiringReason: entry.nonFiringReason,
      conditionTraces: entry.conditionTraces,
      retroactivityFloorWaived: entry.retroactivityFloorWaived,
      blockedBy,
      stepAvailability: (rule?.actions ?? []).map((step) => {
        // Widened before the guard deliberately. `step.action` is typed as the
        // closed union, so narrowing it directly makes the defensive branch
        // `never` — unreachable to the compiler, and reachable at run time all
        // the same: `actions` is read back from a jsonb column a NEWER build may
        // have written. Same reasoning as `AutomationActionExecutorRegistry.resolve`.
        const action: string = step.action;
        if (!isAutomationActionKind(action)) {
          return {
            action,
            availability: 'unavailable',
            reason: `Action "${action}" is not part of this build's automation vocabulary.`,
          };
        }
        const declared = availabilityForAction(action);
        return { action, availability: declared.availability, reason: declared.reason };
      }),
    };
  }

  /**
   * The rule under preview — loaded, or built transiently from a draft.
   *
   * The draft goes through `validateRule`, which applies the SAME vocabulary,
   * legality and step-count refusals `createRule` does and persists nothing. That
   * is what stops a preview and a save disagreeing about what is legal, and it is
   * why the draft arm needs no validation of its own.
   */
  private async resolveSubject(input: AutomationDryRunInput, now: Date): Promise<AutomationRule> {
    if (input.ruleId !== undefined) {
      const rule = await this.rules.getRule(input.ruleId);
      if (rule === null) {
        throw new NotFoundException(`Automation rule "${input.ruleId}" not found.`);
      }
      return rule;
    }
    if (input.draft === undefined) {
      // Unreachable through the DTO, whose validator requires exactly one.
      throw new NotFoundException('No automation rule was named to evaluate.');
    }

    const validated = this.rules.validateRule(input.draft);
    return new AutomationRule(
      AUTOMATION_DRAFT_RULE_ID,
      validated.name,
      validated.trigger,
      validated.triggerConfig,
      validated.conditions,
      validated.actions,
      validated.definitionHash,
      validated.isActive,
      validated.effectiveFrom,
      validated.effectiveTo,
      null,
      null,
      // A draft's `createdAt` is now, which is precisely why the floor must be
      // waived on this path: enforced, it would block a draft against every
      // order that already exists — i.e. against every order an operator could
      // test with.
      now,
      now
    );
  }
}
