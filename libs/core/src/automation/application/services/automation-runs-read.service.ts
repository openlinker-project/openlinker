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
  AUTOMATION_RULE_REPOSITORY_TOKEN,
  AUTOMATION_RUN_RECORDER_TOKEN,
  AUTOMATION_RUN_REPOSITORY_TOKEN,
} from '../../automation.tokens';
import { AutomationRunRepositoryPort } from '../../domain/ports/automation-run-repository.port';
import { AutomationRuleRepositoryPort } from '../../domain/ports/automation-rule-repository.port';
import {
  isAutomationRunAttentionWorthy,
  resolveRetryEligibility,
} from '../../domain/types/automation-run.types';
import type { AutomationRunFilters } from '../../domain/ports/automation-run-repository.port';
import type { AutomationRun } from '../../domain/entities/automation-run.entity';
import type { AutomationRunSubjectKind } from '../../domain/types/automation-run.types';
import { IAutomationRunRecorderService } from '../interfaces/automation-run-recorder.service.interface';
import type {
  AutomationRunLogPage,
  AutomationRunView,
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
    // Same context, so a repository port is the right dependency here (the
    // cross-context `I*Service` rule does not apply within `automation`).
    @Inject(AUTOMATION_RULE_REPOSITORY_TOKEN)
    private readonly ruleRepository: AutomationRuleRepositoryPort,
  ) {}

  async listRecentByRule(
    ruleId: string,
    limit: number = AUTOMATION_RUN_LOG_PAGE_SIZE,
  ): Promise<AutomationRunLogPage> {
    const capped = Math.min(Math.max(1, limit), AUTOMATION_RUN_LOG_PAGE_SIZE);
    const runs = await this.runRepository.findRecentByRuleId(ruleId, capped);
    return {
      runs: await this.project(runs),
      limit: capped,
      // A full page means older runs MAY exist. Deliberately not a count query:
      // the answer only decides whether a consumer offers paging, and paying for
      // a second scan of the whole partition to firm up a "maybe" is not a trade
      // §5.6 asks for.
      hasMore: runs.length === capped,
      recordingAvailable: this.isRecordingPersisted(),
    };
  }

  async listRecentBySubject(
    subjectKind: AutomationRunSubjectKind,
    subjectId: string,
    limit: number = AUTOMATION_RUN_LOG_PAGE_SIZE,
  ): Promise<AutomationRunLogPage> {
    const capped = Math.min(Math.max(1, limit), AUTOMATION_RUN_LOG_PAGE_SIZE);
    const runs = await this.runRepository.findRecentBySubject(subjectKind, subjectId, capped);
    return this.toPage(runs, capped);
  }

  async listRecent(
    filters: AutomationRunFilters = {},
    limit: number = AUTOMATION_RUN_LOG_PAGE_SIZE,
    offset = 0,
  ): Promise<AutomationRunLogPage> {
    const capped = Math.min(Math.max(1, limit), AUTOMATION_RUN_LOG_PAGE_SIZE);
    const runs = await this.runRepository.findRecent(filters, capped, Math.max(0, offset));
    return this.toPage(runs, capped);
  }

  async getRunById(id: string): Promise<AutomationRunView | null> {
    const run = await this.runRepository.findById(id);
    if (run === null) return null;
    const [projected] = await this.project([run]);
    return projected ?? null;
  }

  countAttention(): Promise<number> {
    return this.runRepository.countAttention();
  }

  async dismiss(id: string, userId: string, now: Date): Promise<AutomationRunView | null> {
    const run = await this.runRepository.dismiss(id, userId, now);
    if (run === null) return null;
    const [projected] = await this.project([run]);
    return projected ?? null;
  }

  /**
   * Attach the two facts a row cannot answer about itself (#2387).
   *
   * **Two batched reads for a whole page, never per row.** Both are `IN`
   * lookups over the ids already in hand: which runs a successful retry
   * superseded, and which rules still exist. A page of 50 runs costs 2 queries,
   * not 100.
   *
   * The rules themselves are the pure `isAutomationRunAttentionWorthy` and
   * `resolveRetryEligibility` — the same two functions the SQL predicate and the
   * retry endpoint use, so a rendered badge, a filtered row, a count and an
   * enforced refusal cannot disagree.
   */
  private async project(runs: readonly AutomationRun[]): Promise<AutomationRunView[]> {
    if (runs.length === 0) return [];
    const runIds = runs.map((run) => run.id);
    const ruleIds = [...new Set(runs.map((run) => run.ruleId))];
    const [superseded, existingRuleIds] = await Promise.all([
      this.runRepository.findSupersededRunIds(runIds),
      this.ruleRepository.findExistingIds(ruleIds),
    ]);

    // A plain spread: `AutomationRun` is anemic with only public readonly
    // fields (ADR-011), so the view satisfies it structurally and no prototype
    // gymnastics are needed.
    return runs.map((run) => ({
      ...run,
      needsAttention: isAutomationRunAttentionWorthy({
        outcome: run.outcome,
        dismissedAt: run.dismissedAt,
        supersededByRetry: superseded.has(run.id),
      }),
      supersededByRetry: superseded.has(run.id),
      retry: resolveRetryEligibility({
        outcome: run.outcome,
        subjectKind: run.subjectKind,
        ruleExists: existingRuleIds.has(run.ruleId),
        // Both chain facts are already in hand — `superseded` is the read the
        // badge needs anyway, and `retryAttempt` is a column on the row — so
        // closing the #2666 fork costs no extra query on this path.
        retryAttempt: run.retryAttempt,
        supersededByRetry: superseded.has(run.id),
      }),
    }));
  }

  isRecordingPersisted(): boolean {
    return this.recorder.persistsRuns;
  }

  /**
   * One envelope shape for every listing.
   *
   * `recordingAvailable` rides on ALL of them, not just the per-rule log: an
   * empty activity list means "the write path is not built" and "nothing fired"
   * identically, and an operator resolving that ambiguity concludes their rules
   * are broken. Same reasoning #2363 gave for the per-rule log, applied to the
   * two listings #2385 adds rather than restated per call site.
   */
  private async toPage(runs: AutomationRun[], capped: number): Promise<AutomationRunLogPage> {
    return {
      runs: await this.project(runs),
      limit: capped,
      hasMore: runs.length === capped,
      recordingAvailable: this.isRecordingPersisted(),
    };
  }
}
