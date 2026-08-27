/**
 * Automation Runs Read Service (#2363, Wave-2 spec §5.6)
 *
 * Reads the per-rule fired log and reports whether that log is real yet.
 *
 * ## The §5.6 "merge" the issue asked for is not implemented, deliberately
 *
 * #2363's text assumes `automation_runs` rows are merged with `sync_jobs` rows
 * on `(ruleId, orderId, firedAt)`. There is nothing on the other side of that
 * join:
 *
 * - The run row is the AUTHORITY. #2385's contract writes one row per firing
 *   **including** firings whose step dispatched a job — `AutomationRun`'s own
 *   docblock says so, and `AutomationEmissionResult.firedRuleIds` means *handed
 *   to dispatch*, not *fired*, so it is not a second source either.
 * - The job link is a FIELD INSIDE a run row's step
 *   (`AutomationStepResult.syncJobId`), by explicit #2358/#2361 design — the
 *   existing job detail stays the place technical failure detail lives.
 * - `sync_jobs` carries no rule reference, so "automation-originated jobs with
 *   no run row" is not a set this system can enumerate.
 *
 * One source, no join table, no merge key. The caller surfaces each step's
 * `syncJobId` so the job detail stays one link away.
 *
 * @module libs/core/src/automation/application/services
 * @implements {IAutomationRunsReadService}
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  AUTOMATION_RUN_RECORDER_TOKEN,
  AUTOMATION_RUN_REPOSITORY_TOKEN,
} from '../../automation.tokens';
import { AutomationRunRepositoryPort } from '../../domain/ports/automation-run-repository.port';
import { IAutomationRunRecorderService } from '../interfaces/automation-run-recorder.service.interface';
import type {
  AutomationRunLogPage,
  IAutomationRunsReadService,
} from '../interfaces/automation-runs-read.service.interface';
import { AUTOMATION_RUN_LOG_PAGE_SIZE } from '../interfaces/automation-runs-read.service.interface';

@Injectable()
export class AutomationRunsReadService implements IAutomationRunsReadService {
  constructor(
    @Inject(AUTOMATION_RUN_REPOSITORY_TOKEN)
    private readonly runRepository: AutomationRunRepositoryPort,
    // A READ service injecting the WRITE seam looks odd until you ask who else
    // could answer "are firings persisted in this build". Nothing else knows:
    // the table exists either way, and an empty table is exactly the ambiguity
    // being resolved. The recorder is the one honest source, so the declaration
    // lives on it — see `IAutomationRunRecorderService.persistsRuns`.
    @Inject(AUTOMATION_RUN_RECORDER_TOKEN)
    private readonly recorder: IAutomationRunRecorderService,
  ) {}

  async listRecentByRule(
    ruleId: string,
    limit: number = AUTOMATION_RUN_LOG_PAGE_SIZE,
  ): Promise<AutomationRunLogPage> {
    const capped = Math.min(Math.max(1, limit), AUTOMATION_RUN_LOG_PAGE_SIZE);
    const runs = await this.runRepository.findRecentByRuleId(ruleId, capped);
    return {
      runs,
      limit: capped,
      // A full page means older runs MAY exist. Deliberately not a count query:
      // the answer only decides whether a consumer offers paging, and paying for
      // a second scan of the whole partition to firm up a "maybe" is not a trade
      // §5.6 asks for.
      hasMore: runs.length === capped,
      recordingAvailable: this.isRecordingPersisted(),
    };
  }

  isRecordingPersisted(): boolean {
    return this.recorder.persistsRuns;
  }
}
