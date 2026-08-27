/**
 * Logging Automation Run Recorder (#2361)
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
 * The FILE is named for the contract; the CLASS is named for what this
 * implementation currently is. #2385 replaces the class; the contract, and
 * therefore the filename, does not move.
 *
 * @module libs/core/src/automation/application/services
 * @implements {IAutomationRunRecorderService}
 */
import { Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

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
