/**
 * Automation Retry Service (#2387, Wave-2 spec §4.2 AF-X row)
 *
 * The producer behind `Try again`. Re-runs one failed firing's rule against that
 * firing's own order, writing a NEW run row linked back by `retryOfRunId`.
 *
 * ## Why it lives in `apps/api` and not in `libs/core/src/automation`
 *
 * The same recorded reason as `AutomationDryRunService`: it composes automation
 * rules with ORDER FACTS, and `OrdersModule` already imports `AutomationModule`
 * for the T5 packed emission, so a reverse edge inside core would close a NestJS
 * DI cycle — and ADR-041 decision 2 records that there is no `forwardRef`
 * anywhere in `libs/core`, `apps/api` or `apps/worker`. The
 * `AutomationSubjectFacts` docblock already assigns fact assembly to the caller.
 *
 * ## Five properties are contract
 *
 * **1. The refusal is the SAME rule the projection renders.** `Try again` is
 * only offered where `AutomationRunView.retry.retryable` is true, and this
 * service re-derives that verdict through the identical
 * `resolveRetryEligibility` rather than a second hand-written condition. Both
 * halves exist deliberately: the projection is a *rendering* fact and this is
 * the *guard*. If only the endpoint knew, the UI would lie; if only the UI knew,
 * a direct call would bypass it.
 *
 * **2. Conditions are NOT re-evaluated.** The rule matched when it fired; this
 * re-runs its ACTIONS. Re-evaluating would re-apply the retroactivity floor
 * (`AutomationRule.createdAt` vs the fact's own time) and refuse every retry of
 * an older firing, which is the opposite of what the operator asked for.
 *
 * **3. It resolves `AUTOMATION_DISPATCH_SERVICE_TOKEN`, which binds the #2362
 * gate — and the gate CANNOT refuse a single-rule retry.**
 * `gateIrreversibleAutomationActions` only collides when two or more rules claim
 * the same irreversible action, so a dispatch carrying one rule always passes.
 * Resolving the token is still right (one seam, and it stays correct if a retry
 * ever carries a set), but **it is not what protects against duplicate money** —
 * a vacuous check described as a protection is worse than no check, because the
 * next author stops looking. What protects is executor idempotency; see
 * property 4. Note also that this is deliberate rather than a gap: ADR-041 §6
 * forbids *OpenLinker* choosing between colliding money rules, not the operator,
 * and a retry is an explicit operator act naming one rule.
 *
 * **4. The WHOLE rule re-runs, not the failed step onward.** Executors own their
 * own idempotency (spec §5.3's admission rule), so re-running a step that
 * already succeeded is safe, and a resume-from-index path would be a second
 * execution model that can disagree with the first. **That safety is
 * conditional**: it holds today only because A1/A2 resolve to
 * `UnavailableActionExecutorService`, so an irreversible retry fails at step 0.
 * `issue-sales-document` will inherit #2047's write-path guard;
 * `dispatch-shipment` has no documented equivalent, so the day that executor
 * lands, a whole-rule retry can buy a second label.
 *
 * **5. The new run links back.** `retryOfRunId` is what lets the derived AF-X
 * state clear on a successful retry WITHOUT clearing on a later unrelated firing
 * of the same rule. A derived state is only self-clearing if the derivation can
 * see the thing that clears it.
 *
 * @module apps/api/src/automation/application
 * @implements {IAutomationRetryService}
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AUTOMATION_DISPATCH_SERVICE_TOKEN,
  AUTOMATION_RULES_SERVICE_TOKEN,
  AUTOMATION_RUNS_READ_SERVICE_TOKEN,
  resolveRetryEligibility,
  type AutomationRunView,
  type IAutomationDispatchService,
  type IAutomationRulesService,
  type IAutomationRunsReadService,
  type RetryRefusalReason,
} from '@openlinker/core/automation';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  buildOrderAutomationFacts,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import type {
  AutomationRetryInput,
  IAutomationRetryService,
} from './automation-retry.service.interface';

/** Operator-facing refusals. The frontend renders its own copy; this is the API's. */
const REFUSAL_MESSAGE: Readonly<Record<RetryRefusalReason, string>> = {
  'not-failed': 'This automation run did not fail, so there is nothing to run again.',
  'rule-deleted':
    'The automation this run belongs to has been deleted, so there is no longer a definition to run.',
  'subject-unsupported': 'Running again is not possible for a return.',
};

@Injectable()
export class AutomationRetryService implements IAutomationRetryService {
  private readonly logger = new Logger(AutomationRetryService.name);

  constructor(
    @Inject(AUTOMATION_RUNS_READ_SERVICE_TOKEN)
    private readonly runs: IAutomationRunsReadService,
    @Inject(AUTOMATION_RULES_SERVICE_TOKEN)
    private readonly rules: IAutomationRulesService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
    // Resolves the #2362 gate, never `AutomationDispatchService` directly.
    @Inject(AUTOMATION_DISPATCH_SERVICE_TOKEN)
    private readonly dispatcher: IAutomationDispatchService
  ) {}

  async retry(input: AutomationRetryInput): Promise<AutomationRunView> {
    const run = await this.runs.getRunById(input.runId);
    if (run === null) {
      throw new NotFoundException(`Automation run "${input.runId}" not found.`);
    }

    // `getRule` already answers `null` for an absent rule — no catch, which would
    // swallow a real read failure and report it as a deleted rule.
    const rule = await this.rules.getRule(run.ruleId);

    // Property 1: the guard re-derives the SAME verdict the projection rendered.
    const eligibility = resolveRetryEligibility({
      outcome: run.outcome,
      subjectKind: run.subjectKind,
      ruleExists: rule !== null,
    });
    if (!eligibility.retryable) {
      throw new BadRequestException({
        message: REFUSAL_MESSAGE[eligibility.reason],
        reason: eligibility.reason,
      });
    }
    // Unreachable — `retryable` implies the rule resolved — but the compiler
    // cannot see that through the discriminant, and a cast would hide a real
    // regression if the rule ever gains a fourth refusal.
    if (rule === null) {
      throw new BadRequestException({
        message: REFUSAL_MESSAGE['rule-deleted'],
        reason: 'rule-deleted' satisfies RetryRefusalReason,
      });
    }

    const record = await this.orders.getOrderRecord(run.subjectId);
    if (record === null) {
      throw new NotFoundException(
        `Order "${run.subjectId}" no longer exists, so this automation cannot run again.`
      );
    }

    // Property 3: the SAME projection the original firing used. A retry built
    // from a different projection is a retry of something else.
    const facts = buildOrderAutomationFacts(record, record.placedAt ?? record.createdAt);

    this.logger.log(
      `Re-running automation "${rule.name}" (${rule.id}) against ${run.subjectKind} ` +
        `${run.subjectId}, as a retry of run ${run.id}.`
    );

    await this.dispatcher.dispatch({
      trigger: run.trigger,
      facts,
      // Exactly one rule: the operator named it. Property 2 — no evaluation.
      matchedRules: [rule],
      now: new Date(),
      retryOfRunId: run.id,
    });

    // Re-read the ORIGINAL run: its `needsAttention` is what changed, and it
    // changed because a linked row now exists — not because anything mutated it.
    const refreshed = await this.runs.getRunById(run.id);
    return refreshed ?? run;
  }
}
