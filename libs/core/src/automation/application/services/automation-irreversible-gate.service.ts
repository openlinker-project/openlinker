/**
 * Automation Irreversible-Action Gate Service (#2362, Wave-2 spec §5.5 divergence 3)
 *
 * The implementation `AUTOMATION_DISPATCH_SERVICE_TOKEN` resolves to. It
 * **composes over** `AutomationDispatchService` rather than replacing it: the
 * partition happens here, and everything that survives it is handed to the
 * dispatcher unchanged, so #2361's step ordering, stop-on-failure and run
 * recording are untouched and its own tests still describe live behaviour.
 *
 * Five properties are contract.
 *
 * **1. It refuses; it never picks.** With two rules carrying the same
 * irreversible action, NOTHING fires for either — ADR-041 §6, applied verbatim:
 * for a fiscal document a wrong pick is a legal event, so silence-and-pick-one
 * is forbidden. The rule that decides this is the pure
 * `gateIrreversibleAutomationActions`; this service only calls it and reports.
 *
 * **2. Reversible rules are unaffected.** A1/A2 are the irreversible pair; A3
 * relay, A4 email, A5 hold and A6 release all fire when several rules match and
 * must never be reported as a conflict. Two emails are recoverable.
 *
 * **3. A block is RECORDED, never log-only** (the `SalesDocumentBlockOutcome`
 * precedent, #2100 §54). It goes through `AUTOMATION_RUN_RECORDER_TOKEN` — the
 * *same single* seam every other outcome already uses — so when #2385 lands the
 * `automation_runs` write path, `blocked` becomes persisted and operator-visible
 * with it, rather than needing a second write path that could disagree. The
 * warn line below is the interim signal, not the record.
 *
 * **4. Recording is best-effort and never throws**, matching
 * `AutomationDispatchService.record`. A reporting failure must not abort the
 * dispatch of the rules that were NOT blocked — those are unrelated firings
 * that happen to share a subject.
 *
 * **5. The firing claim a blocked rule consumed is NOT released.** For a
 * `deadline-sweep` trigger the emitter takes the durable
 * `automation_trigger_firings` claim *before* dispatch (#2360), so a rule
 * blocked here has already spent its at-most-once claim and will not be
 * re-offered. That is deliberate: the collision is a CONFIGURATION fact, so it
 * recurs identically on every tick — retrying buys nothing and would write one
 * `blocked` run per rule per tick, drowning the log the AF-X state (#2387)
 * reads — and releasing would need a durable delete on the claim, reopening the
 * re-fire window the claim exists to close. It also matches a decision #2358
 * already made for the same reason: the firings unique key deliberately
 * excludes `definitionHash`, i.e. *editing a rule does not erase its firing
 * record*. **Operator consequence, stated because it is the surprising half:**
 * deactivating the losing rule does NOT re-arm the record, so the fix must be
 * followed by a manual trigger for that subject.
 *
 * **Currently unreachable in practice, and built anyway.** A1 and A2 both
 * resolve to `UnavailableActionExecutorService` today (#2361), so no shipped
 * rule can carry a *working* irreversible action. The gate reads the rule's
 * declared `actions`, not executor availability, so it arms the moment A1/A2
 * land — "never observed" is not "not wired".
 *
 * @module libs/core/src/automation/application/services
 * @implements {IAutomationIrreversibleGateService} — an alias of
 *   `IAutomationDispatchService`; see that interface file for why it exists.
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.5, §5.6
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import { AUTOMATION_RUN_RECORDER_TOKEN } from '../../automation.tokens';
import { gateIrreversibleAutomationActions } from '../../domain/domain-services/gate-irreversible-automation-actions';
import type { AutomationBlockedRule } from '../../domain/types/automation-gate.types';
import type { AutomationRule } from '../../domain/entities/automation-rule.entity';
import type { AutomationDispatchInput } from '../interfaces/automation-dispatch.service.interface';
import type { IAutomationIrreversibleGateService } from '../interfaces/automation-irreversible-gate.service.interface';
import { IAutomationRunRecorderService } from '../interfaces/automation-run-recorder.service.interface';
import { AutomationDispatchService } from './automation-dispatch.service';

@Injectable()
export class AutomationIrreversibleGateService implements IAutomationIrreversibleGateService {
  private readonly logger = new Logger(AutomationIrreversibleGateService.name);

  constructor(
    private readonly dispatcher: AutomationDispatchService,
    @Inject(AUTOMATION_RUN_RECORDER_TOKEN)
    private readonly recorder: IAutomationRunRecorderService,
  ) {}

  async dispatch(input: AutomationDispatchInput): Promise<void> {
    const { dispatchable, blocked } = gateIrreversibleAutomationActions(input.matchedRules);

    const rulesById = new Map(input.matchedRules.map((rule) => [rule.id, rule] as const));
    for (const entry of blocked) {
      const rule = rulesById.get(entry.ruleId);
      // Unreachable — every blocked id came from this same list — but the
      // lookup is typed nullable and skipping is the only honest fallback.
      if (rule) await this.recordBlocked(rule, entry, input);
    }

    // No empty dispatch: with every matched rule blocked there is nothing for
    // the dispatcher to iterate, and calling it would record nothing anyway.
    if (dispatchable.length > 0) {
      await this.dispatcher.dispatch({ ...input, matchedRules: dispatchable });
    }
  }

  private async recordBlocked(
    rule: AutomationRule,
    entry: AutomationBlockedRule,
    input: AutomationDispatchInput,
  ): Promise<void> {
    this.logger.warn(
      `Automation rule "${rule.name}" (${rule.id}) was BLOCKED: its ` +
        `irreversible action(s) [${entry.actions.join(', ')}] are also claimed by another matching ` +
        `rule for ${input.facts.subjectKind}=${input.facts.subjectId}. Nothing ran for rules ` +
        `[${entry.collidingRuleIds.join(', ')}] — at most one may act, and OpenLinker will not ` +
        `choose between them. Deactivate all but one and re-trigger.`,
    );

    try {
      await this.recorder.record({
        rule,
        trigger: input.trigger,
        facts: input.facts,
        outcome: 'blocked',
        // Empty, deliberately: nothing ran. A fabricated `skipped` step would
        // claim the rule reached the dispatcher, which it did not.
        steps: [],
        blockedByRuleIds: entry.collidingRuleIds,
        firedAt: input.now,
      });
    } catch (error) {
      // Property 4: a reporting failure must not cost the unblocked rules
      // their dispatch.
      this.logger.error(
        `Could not record the blocked automation run for "${rule.name}" (${rule.id}): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
