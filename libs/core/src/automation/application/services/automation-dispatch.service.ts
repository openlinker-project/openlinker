/**
 * Automation Dispatch Service (#2361)
 *
 * Runs each matched rule's ordered action steps and reports the outcome. It
 * replaced #2360's `InertAutomationDispatchService` as a single provider-binding
 * swap, which is what declaring the seam early bought.
 *
 * **Since #2362 this class is NO LONGER what `AUTOMATION_DISPATCH_SERVICE_TOKEN`
 * resolves to** — `AutomationIrreversibleGateService` is, and it delegates here
 * with the rules its at-most-one gate did not block. The class stays exported
 * from the context barrel (it is the gate's delegate, and #2385 will want it),
 * so a caller value-importing it directly gets the UN-GATED dispatcher with no
 * compiler complaint. Resolve the token unless you specifically mean that.
 *
 * Four properties are contract.
 *
 * **1. Steps run IN ORDER and stop at the first failure** (spec §5.5). Every
 * later step is recorded `skipped` rather than omitted: §5.6 requires the
 * timeline to state what did NOT run (*"Skipped: tell the marketplace"*),
 * because a silently missing step is indistinguishable from a step that was
 * never configured.
 *
 * **2. Every rule produces exactly one recorded run, including the ones where
 * nothing executed.** A silent decline is the defect class this programme keeps
 * closing (the `SalesDocumentBlockOutcome` precedent). The recorder is the seam
 * #2385 replaces with the `automation_runs` write path.
 *
 * **3. A throw never crosses rules.** A defect in one rule's executor must not
 * cost its siblings their firing — the emitter has already taken the durable
 * firing claim for a sweep trigger (#2360), so an aborted dispatch is a
 * permanently lost firing rather than a retried one.
 *
 * **4. Executors DELEGATE; this service adds no idempotency.** Each shipped
 * operation already owns its own (spec §5.3's admission rule). Building a second
 * layer here would be a parallel path that can disagree with the first.
 *
 * **The at-most-one gate for irreversible actions is NOT here** — that is
 * #2362's `AutomationIrreversibleGateService`, composed over this service, and it reads
 * `AUTOMATION_ACTION_IS_IRREVERSIBLE` rather than restating the split. This
 * service deliberately receives EVERY matched rule (see the interface docblock):
 * collapsing them here would move the money decision into the dispatcher, where
 * the dry run cannot show it and the `blocked` outcome could never be reported.
 *
 * @module libs/core/src/automation/application/services
 * @implements {IAutomationDispatchService}
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.5, §5.6
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import { AUTOMATION_RUN_RECORDER_TOKEN } from '../../automation.tokens';
import type { AutomationRule } from '../../domain/entities/automation-rule.entity';
import type { AutomationRunOutcome } from '../../domain/types/automation-run.types';
import type { AutomationStepResult } from '../../domain/types/automation-step-result.types';
import type {
  AutomationDispatchInput,
  IAutomationDispatchService,
} from '../interfaces/automation-dispatch.service.interface';
import { IAutomationRunRecorderService } from '../interfaces/automation-run-recorder.service.interface';
import { AutomationActionExecutorRegistry } from './automation-action-executor.registry';

@Injectable()
export class AutomationDispatchService implements IAutomationDispatchService {
  private readonly logger = new Logger(AutomationDispatchService.name);

  constructor(
    private readonly executors: AutomationActionExecutorRegistry,
    @Inject(AUTOMATION_RUN_RECORDER_TOKEN)
    private readonly recorder: IAutomationRunRecorderService,
  ) {}

  async dispatch(input: AutomationDispatchInput): Promise<void> {
    for (const rule of input.matchedRules) {
      const steps = await this.runRule(rule, input);
      await this.record(rule, input, steps);
    }
  }

  /** Run one rule's steps in order, stopping at the first failure. */
  private async runRule(
    rule: AutomationRule,
    input: AutomationDispatchInput,
  ): Promise<AutomationStepResult[]> {
    const steps: AutomationStepResult[] = [];
    let stopped = false;

    for (const [stepIndex, action] of rule.actions.entries()) {
      if (stopped) {
        steps.push({
          stepIndex,
          action: action.action,
          status: 'skipped',
          detail: 'The automation stopped after the step that failed.',
        });
        continue;
      }

      const step = await this.runStep(rule, input, action, stepIndex);
      steps.push(step);
      if (step.status === 'failed') {
        stopped = true;
      }
    }

    return steps;
  }

  private async runStep(
    rule: AutomationRule,
    input: AutomationDispatchInput,
    action: AutomationRule['actions'][number],
    stepIndex: number,
  ): Promise<AutomationStepResult> {
    const executor = this.executors.resolve(action.action);
    if (!executor) {
      // Unreachable via the type system, but the action comes from a persisted
      // jsonb column — a rule written by a newer build lands here.
      this.logger.warn(
        `Automation "${rule.name}" (${rule.id}) step ${stepIndex} names action ` +
          `"${action.action}", which this build has no executor for.`,
      );
      return {
        stepIndex,
        action: action.action,
        status: 'failed',
        detail: `This version of OpenLinker does not know the action "${action.action}".`,
      };
    }

    try {
      return await executor.execute({
        action,
        facts: input.facts,
        rule,
        stepIndex,
        now: input.now,
      });
    } catch (error) {
      // An executor is contracted to REPORT a business failure rather than
      // throw, so reaching here means a defect. It is still contained to this
      // step: the rule stops, its siblings run, and the run is recorded.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Automation "${rule.name}" (${rule.id}) step ${stepIndex} (${action.action}) threw: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        stepIndex,
        action: action.action,
        status: 'failed',
        detail: `The step failed unexpectedly: ${message}`,
      };
    }
  }

  /**
   * Derive the run outcome and report it. `blocked` is never produced here — it
   * is #2362's verdict about rules that never reached dispatch.
   */
  private async record(
    rule: AutomationRule,
    input: AutomationDispatchInput,
    steps: readonly AutomationStepResult[],
  ): Promise<void> {
    const outcome = this.deriveOutcome(steps);
    try {
      await this.recorder.record({
        rule,
        trigger: input.trigger,
        facts: input.facts,
        outcome,
        steps,
        firedAt: input.now,
      });
    } catch (error) {
      // Recording is a report on effects that have already happened; letting it
      // propagate would turn a completed firing into a job retry that re-runs
      // the steps.
      this.logger.error(
        `Could not record the automation run for "${rule.name}" (${rule.id}): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private deriveOutcome(steps: readonly AutomationStepResult[]): AutomationRunOutcome {
    if (steps.some((step) => step.status === 'failed')) return 'failed';
    // A rule with no steps is refused at the write path (`AUTOMATION_ACTION_MIN_STEPS`),
    // so an empty list here means a row that bypassed it — "nothing to do" is the
    // honest reading, and the recorded run makes it visible.
    if (steps.every((step) => step.status === 'nothing-to-do')) return 'nothing-to-do';
    return 'done';
  }
}
