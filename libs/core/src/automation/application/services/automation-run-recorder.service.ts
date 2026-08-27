/**
 * Automation Run Recorders (#2361 logging, #2385 persisting)
 *
 * The declared-but-not-yet-persisted implementation of
 * {@link IAutomationRunRecorderService}. It logs the outcome and returns.
 *
 * **This is observability, not history**, and the log copy says so: a run
 * recorded here survives only in the process log, so an operator cannot filter
 * it, and `/automations/activity` (§5.6c) renders nothing until #2385 lands the
 * `automation_runs` write path. Naming that in the line is what keeps "the run
 * log is empty" readable as "not built yet" rather than "nothing fired".
 *
 * The FILE is named for the contract; each CLASS is named for what it does.
 * #2385 added `PersistingAutomationRunRecorder` and made it the default binding;
 * the logging one is KEPT and still exported, so a deployment that deliberately
 * wants no run history can bind it and have `recordingAvailable` tell the truth
 * about that choice rather than about a missing feature.
 *
 * @module libs/core/src/automation/application/services
 * @implements {IAutomationRunRecorderService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import { AUTOMATION_RUN_REPOSITORY_TOKEN } from '../../automation.tokens';
import { AutomationRunRepositoryPort } from '../../domain/ports/automation-run-repository.port';
import type {
  AutomationRunRecord,
  IAutomationRunRecorderService,
} from '../interfaces/automation-run-recorder.service.interface';

@Injectable()
export class LoggingAutomationRunRecorder implements IAutomationRunRecorderService {
  private readonly logger = new Logger(LoggingAutomationRunRecorder.name);

  /**
   * `false` — this implementation logs and returns. `/automations/:id/runs`
   * reports it so an empty fired log reads as "not built yet" rather than
   * "nothing fired". #2385 flips it by replacing the class.
   */
  readonly persistsRuns = false;

  record(run: AutomationRunRecord): Promise<void> {
    const steps = run.steps
      .map((step) => `${step.stepIndex}:${step.action}=${step.status}`)
      .join(' ');

    // Only a `blocked` run carries a collision set (#2362); rendering the
    // clause unconditionally would print an empty bracket on every ordinary
    // firing and read as "collided with nothing".
    const blockedBy = run.blockedByRuleIds?.length
      ? ` blockedBy=[${run.blockedByRuleIds.join(', ')}]`
      : '';

    this.logger.log(
      `Automation run: rule="${run.rule.name}" (${run.rule.id}) trigger=${run.trigger} ` +
        `${run.facts.subjectKind}=${run.facts.subjectId} outcome=${run.outcome} [${steps}]${blockedBy} ` +
        `— not persisted (#2385 owns the automation_runs write path), so the run log stays empty.`,
    );
    return Promise.resolve();
  }
}


/**
 * Persist every firing into `automation_runs` (#2385).
 *
 * ## One write, four readings
 *
 * This is the ONLY write path. The order timeline, `/automations/runs`, the
 * per-rule fired log and the AF-X attention state are all renderings of the row
 * written here — never four writes, which is how one firing starts rendering
 * differently on two surfaces (§5.6's closing rule).
 *
 * ## What it does NOT do
 *
 * It does not catch. `AutomationDispatchService.record` already wraps this call
 * in a try/catch whose comment states the reason — *"letting it propagate would
 * turn a completed firing into a job retry that re-runs the steps"* — and
 * swallowing here too would mean a write failure produced no signal at either
 * level. One catch, at the site that knows what re-running would cost.
 *
 * It also writes no `blocked` row: the #2362 gate refuses colliding rules BEFORE
 * dispatch and reports nothing back, so nothing ever calls this with that
 * outcome. Wiring it would change #2362's contract from an issue scoped to a
 * write path; deferred deliberately (see the #2385 plan, D8).
 */
@Injectable()
export class PersistingAutomationRunRecorder implements IAutomationRunRecorderService {
  constructor(
    @Inject(AUTOMATION_RUN_REPOSITORY_TOKEN)
    private readonly runRepository: AutomationRunRepositoryPort,
  ) {}

  /** `true` — a firing recorded here survives in `automation_runs`. */
  readonly persistsRuns = true;

  async record(run: AutomationRunRecord): Promise<void> {
    await this.runRepository.save({
      ruleId: run.rule.id,
      // Frozen at write time: renaming the rule must not rewrite its history,
      // and a DELETED rule's runs stay readable, which is when they matter most.
      ruleName: run.rule.name,
      trigger: run.trigger,
      subjectKind: run.facts.subjectKind,
      subjectId: run.facts.subjectId,
      outcome: run.outcome,
      // Verbatim. The step shape is `AutomationStepResult`, the same one the
      // read path re-narrows and #2366 parses.
      steps: run.steps,
      blockedByRuleIds: run.blockedByRuleIds === undefined ? null : [...run.blockedByRuleIds],
      firedAt: run.firedAt,
    });
  }
}
