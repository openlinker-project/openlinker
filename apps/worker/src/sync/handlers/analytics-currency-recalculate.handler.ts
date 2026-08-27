/**
 * Analytics Currency Recalculate Handler (#2468, epic #2452 Phase 5)
 *
 * The driver behind the Data Coverage panel's "Recalculate all N now" currency
 * action. Two phases, both re-entrant, both with all of their state in the
 * database:
 *
 *  1. **Enumeration.** `IOrderFxRestatementService.restatePage` clears the
 *     ADR-040 FX stamp on one keyset page of the run's mismatched population
 *     and enqueues a `marketplace.order.fxStamp` job per order under a
 *     run-scoped idempotency key. While a `nextCursor` comes back, the handler
 *     re-schedules itself immediately with that cursor.
 *  2. **Completion poll.** Once the frontier is exhausted, the handler re-reads
 *     the remaining population. Empty -> the run is `resolved`. Non-empty ->
 *     re-schedule after a delay, up to a bounded number of polls, then `failed`
 *     with a detail built from what the data can actually prove.
 *
 * COMPLETION IS LEVEL-TRIGGERED, NOT COUNTED. There is deliberately no
 * per-child counter table: a counter can double-count a re-delivered child, has
 * to be reconciled on a crash, and would still be wrong whenever the population
 * shifted under it. Re-reading "is anything still mismatched in this scope?"
 * asks the same question the panel does and is restart-safe for free — the same
 * reasoning #2100 records for its level-triggered block reasons and #1845 for
 * its terminal-status derivation.
 *
 * THE RUN IS THE ONLY THING THIS HANDLER CAN FAIL. Per-order failures are
 * swallowed by the restatement service (a bad row must not abort a page), and
 * an already-terminal run makes this a no-op: `transitionIfOpen` reports it
 * lost the race and the handler returns `ok`. Only a failure of the handler's
 * own reads/enqueues escapes as a retryable throw (ADR-007).
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  ANALYTICS_REMEDIATION_RUN_SERVICE_TOKEN,
  type IAnalyticsRemediationRunService,
} from '@openlinker/core/analytics';
import {
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  type IReportingCurrencySettingsService,
} from '@openlinker/core/currency';
import {
  ORDER_FX_RESTATEMENT_SERVICE_TOKEN,
  type IOrderFxRestatementService,
} from '@openlinker/core/orders';
import {
  ANALYTICS_CURRENCY_RECALCULATE_MAX_POLLS,
  ANALYTICS_CURRENCY_RECALCULATE_POLL_DELAY_SECONDS,
  buildAnalyticsCurrencyRecalculateIdempotencyKey,
  SYNC_JOBS_SERVICE_TOKEN,
  SyncJobExecutionError,
  type AnalyticsCurrencyRecalculatePayloadV1,
  type ISyncJobsService,
  type SyncJob as SyncJobEntity,
  type SyncJobHandler,
  type SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

/**
 * Orders cleared + enqueued per enumeration page.
 *
 * Sized off what one page COSTS rather than copied from a sibling sweep: each
 * unit is one guarded UPDATE plus one enqueue, both cheap, so the page can be
 * generously large — but every enqueued child is a real stamp job with a
 * possible provider round-trip behind it, so a page that is too large front-
 * loads the `realtime` lane. 200 keeps a typical operator's whole range in one
 * or two pages while staying well inside one job's wall clock.
 */
const RESTATEMENT_PAGE_SIZE = 200;

@Injectable()
export class AnalyticsCurrencyRecalculateHandler implements SyncJobHandler {
  private readonly logger = new Logger(AnalyticsCurrencyRecalculateHandler.name);

  constructor(
    @Inject(ANALYTICS_REMEDIATION_RUN_SERVICE_TOKEN)
    private readonly runs: IAnalyticsRemediationRunService,
    @Inject(ORDER_FX_RESTATEMENT_SERVICE_TOKEN)
    private readonly restatement: IOrderFxRestatementService,
    @Inject(REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN)
    private readonly reportingCurrencySettings: IReportingCurrencySettingsService,
    @Inject(SYNC_JOBS_SERVICE_TOKEN)
    private readonly syncJobs: ISyncJobsService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    const run = await this.runs.getRun(payload.runId);

    if (!run) {
      // A run row that no longer exists cannot be advanced or reported on.
      // Terminal rather than retryable: ten more attempts would read the same
      // absence (ADR-007).
      this.logger.warn(
        `analytics.currency.recalculate: run ${payload.runId} no longer exists; nothing to advance`
      );
      return { outcome: 'business_failure' };
    }

    if (run.status !== 'in-progress') {
      this.logger.log(
        `analytics.currency.recalculate: run ${payload.runId} is already ${run.status}; no-op`
      );
      return { outcome: 'ok' };
    }

    const scope = {
      from: new Date(payload.from),
      to: new Date(payload.to),
      sourceConnectionId: payload.sourceConnectionId,
    };
    // Resolved ONCE per job and threaded into both the repair and the
    // completion poll, so a setting change mid-job cannot make the handler
    // clear against one currency and then judge completeness against another.
    const currentReportingCurrency = await this.reportingCurrencySettings.resolve();
    const step = payload.step ?? 0;

    const page = await this.restatement.restatePage(scope, currentReportingCurrency, {
      runId: payload.runId,
      afterOrderId: payload.afterOrderId ?? null,
      limit: RESTATEMENT_PAGE_SIZE,
    });

    if (page.nextCursor !== null) {
      // Still enumerating — no delay, and `pollCount` untouched: the poll
      // budget exists to bound how long we WAIT for the FX pipeline, not how
      // long the repair takes to fan out.
      await this.reschedule(job, payload, {
        step: step + 1,
        afterOrderId: page.nextCursor,
        pollCount: payload.pollCount ?? 0,
        delaySeconds: 0,
      });
      return { outcome: 'ok' };
    }

    const remaining = await this.restatement.countRemaining(scope, currentReportingCurrency);

    if (remaining.total === 0) {
      await this.runs.markResolved(payload.runId);
      return { outcome: 'ok' };
    }

    const pollCount = (payload.pollCount ?? 0) + 1;
    if (pollCount > ANALYTICS_CURRENCY_RECALCULATE_MAX_POLLS) {
      await this.runs.markFailed(payload.runId, this.describeFailure(remaining));
      return { outcome: 'ok' };
    }

    await this.reschedule(job, payload, {
      step: step + 1,
      // Enumeration is exhausted, so the next poll re-reads the whole scope
      // from the start rather than resuming a cursor. That is what re-admits an
      // order the FX pipeline has since re-stamped into a stale currency, and
      // it costs one COUNT per poll.
      afterOrderId: null,
      pollCount,
      delaySeconds: ANALYTICS_CURRENCY_RECALCULATE_POLL_DELAY_SECONDS,
    });
    return { outcome: 'ok' };
  }

  /**
   * Build the `detail` a `failed` run carries.
   *
   * DELIBERATELY COARSER THAN AN FX TERMINAL REASON, because the data cannot
   * support a finer claim. `order_records` has no column holding WHY a stamp
   * attempt gave up — `FX_STAMP_TERMINAL_REASONS` is logged by
   * `marketplace.order.fxStamp` and never persisted — so the only durable
   * evidence is the terminal marker (`fxStampedAt` set while
   * `reportingCurrency` is still NULL). Reporting the two counts and naming the
   * job that logs the reason is true; naming a specific reason would not be,
   * and a plausible-but-invented reason on a financial restatement is worse
   * than a coarser fact.
   */
  private describeFailure(remaining: {
    total: number;
    terminalMarked: number;
    pending: number;
  }): string {
    const parts = [
      `${remaining.total} order(s) still carry no figure in the current reporting currency ` +
        `after ${ANALYTICS_CURRENCY_RECALCULATE_MAX_POLLS} completion checks.`,
    ];
    if (remaining.terminalMarked > 0) {
      parts.push(
        `${remaining.terminalMarked} reached a terminal FX answer (no exchange rate could be ` +
          `applied); see the marketplace.order.fxStamp job logs for each order's reason.`
      );
    }
    if (remaining.pending > 0) {
      parts.push(
        `${remaining.pending} have not been answered yet and may still be stamped by the ` +
          `hourly marketplace.order.fxStampSweep reconcile.`
      );
    }
    return parts.join(' ');
  }

  /**
   * Self-reschedule via a fresh `sync_jobs` row.
   *
   * `ISyncJobsService.schedule` rather than the Redis enqueue port: the stream
   * backend cannot deliver on a future timestamp, and a chained step needs a
   * delay. Going through the service interface rather than
   * `SyncJobRepositoryPort` directly is the documented cross-context seam
   * (`docs/architecture-overview.md § Cross-context dependencies in core`) —
   * a repository port may not cross a context boundary, and this is exactly
   * the rewire the allow-list's own "rewire via ISyncJobsService" note asks
   * for, so no new allow-list entry is added.
   *
   * The key folds in a monotonic `step` — without it the second reschedule
   * would collide with the first's TTL-less key and the run would stall at
   * `in-progress` with nothing left to advance it.
   */
  private async reschedule(
    job: SyncJob,
    payload: AnalyticsCurrencyRecalculatePayloadV1,
    next: {
      step: number;
      afterOrderId: string | null;
      pollCount: number;
      delaySeconds: number;
    }
  ): Promise<void> {
    const nextPayload: AnalyticsCurrencyRecalculatePayloadV1 = {
      schemaVersion: 1,
      runId: payload.runId,
      from: payload.from,
      to: payload.to,
      sourceConnectionId: payload.sourceConnectionId,
      afterOrderId: next.afterOrderId,
      pollCount: next.pollCount,
      step: next.step,
    };

    await this.syncJobs.schedule({
      jobType: 'analytics.currency.recalculate',
      connectionId: job.connectionId,
      payload: { ...nextPayload },
      idempotencyKey: buildAnalyticsCurrencyRecalculateIdempotencyKey(payload.runId, next.step),
      maxAttempts: job.maxAttempts,
      runAfter: new Date(Date.now() + next.delaySeconds * 1000),
    });

    this.logger.log(
      `analytics.currency.recalculate: run ${payload.runId} scheduled step ${next.step} ` +
        `(cursor=${next.afterOrderId ?? 'start'}, pollCount=${next.pollCount}, ` +
        `delay=${next.delaySeconds}s)`
    );
  }

  private getPayload(job: SyncJob): AnalyticsCurrencyRecalculatePayloadV1 {
    const payload = job.payload as Partial<AnalyticsCurrencyRecalculatePayloadV1> | undefined;

    if (
      payload == null ||
      typeof payload !== 'object' ||
      payload.schemaVersion !== 1 ||
      typeof payload.runId !== 'string' ||
      payload.runId === '' ||
      typeof payload.from !== 'string' ||
      Number.isNaN(Date.parse(payload.from)) ||
      typeof payload.to !== 'string' ||
      Number.isNaN(Date.parse(payload.to))
    ) {
      throw new SyncJobExecutionError(
        'Invalid analytics.currency.recalculate payload: expected schemaVersion=1, a non-empty ' +
          'runId and parseable from/to timestamps',
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    return {
      schemaVersion: 1,
      runId: payload.runId,
      from: payload.from,
      to: payload.to,
      sourceConnectionId:
        typeof payload.sourceConnectionId === 'string' && payload.sourceConnectionId !== ''
          ? payload.sourceConnectionId
          : undefined,
      afterOrderId: typeof payload.afterOrderId === 'string' ? payload.afterOrderId : null,
      pollCount: typeof payload.pollCount === 'number' ? payload.pollCount : 0,
      step: typeof payload.step === 'number' ? payload.step : 0,
    };
  }
}
