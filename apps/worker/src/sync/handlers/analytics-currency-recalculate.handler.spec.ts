/**
 * Analytics Currency Recalculate Handler Tests (#2468)
 *
 * @module apps/worker/src/sync/handlers
 */
import type { IAnalyticsRemediationRunService } from '@openlinker/core/analytics';
import type { IReportingCurrencySettingsService } from '@openlinker/core/currency';
import type { IOrderFxRestatementService } from '@openlinker/core/orders';
import type { ISyncJobsService, SyncJob } from '@openlinker/core/sync';
import {
  ANALYTICS_CURRENCY_RECALCULATE_MAX_POLLS,
  ANALYTICS_CURRENCY_RECALCULATE_POLL_DELAY_SECONDS,
  SyncJobExecutionError,
} from '@openlinker/core/sync';
import { AnalyticsCurrencyRecalculateHandler } from './analytics-currency-recalculate.handler';

const RUN_ID = 'ol_remrun_abc';

function job(payload: Record<string, unknown>): SyncJob {
  return {
    id: 'job-1',
    jobType: 'analytics.currency.recalculate',
    connectionId: '00000000-0000-0000-0000-000000000000',
    payload,
    status: 'running',
    idempotencyKey: `analytics:remediation:${RUN_ID}:step:0`,
    attempts: 1,
    maxAttempts: 10,
    nextRunAt: new Date(),
    lockedAt: new Date(),
    lockedBy: 'worker-1',
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SyncJob;
}

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-27T00:00:00.000Z',
    afterOrderId: null,
    pollCount: 0,
    step: 0,
    ...overrides,
  };
}

describe('AnalyticsCurrencyRecalculateHandler', () => {
  let runs: jest.Mocked<IAnalyticsRemediationRunService>;
  let restatement: jest.Mocked<IOrderFxRestatementService>;
  let reportingCurrency: jest.Mocked<IReportingCurrencySettingsService>;
  let syncJobs: jest.Mocked<Pick<ISyncJobsService, 'schedule'>>;
  let handler: AnalyticsCurrencyRecalculateHandler;

  beforeEach(() => {
    runs = {
      openRun: jest.fn(),
      getRun: jest.fn().mockResolvedValue({
        id: RUN_ID,
        category: 'currency',
        status: 'in-progress',
        detail: null,
        affectedCount: 13,
        triggeredByUserId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getOpenRun: jest.fn(),
      markResolved: jest.fn().mockResolvedValue(true),
      markFailed: jest.fn().mockResolvedValue(true),
    };
    restatement = {
      restatePage: jest
        .fn()
        .mockResolvedValue({ scanned: 3, cleared: 3, enqueued: 3, nextCursor: null }),
      countRemaining: jest.fn().mockResolvedValue({ total: 0, terminalMarked: 0, pending: 0 }),
    };
    reportingCurrency = {
      resolve: jest.fn().mockResolvedValue('EUR'),
    } as unknown as jest.Mocked<IReportingCurrencySettingsService>;
    syncJobs = { schedule: jest.fn().mockResolvedValue({}) };

    handler = new AnalyticsCurrencyRecalculateHandler(
      runs,
      restatement,
      reportingCurrency,
      syncJobs as unknown as ISyncJobsService
    );
  });

  it('should resolve the run once the scope holds no mismatched order', async () => {
    await expect(handler.execute(job(basePayload()))).resolves.toEqual({ outcome: 'ok' });

    expect(runs.markResolved).toHaveBeenCalledWith(RUN_ID);
    expect(syncJobs.schedule).not.toHaveBeenCalled();
  });

  it('should reschedule immediately with the next keyset cursor while enumeration continues', async () => {
    restatement.restatePage.mockResolvedValue({
      scanned: 200,
      cleared: 200,
      enqueued: 200,
      nextCursor: 'ol_order_z',
    });

    await handler.execute(job(basePayload()));

    // Enumeration must NOT spend the poll budget: that budget bounds how long
    // the run waits for the FX pipeline, not how long the fan-out takes.
    const [[created]] = syncJobs.schedule.mock.calls;
    expect(created.payload).toMatchObject({ afterOrderId: 'ol_order_z', pollCount: 0, step: 1 });
    expect(created.idempotencyKey).toBe(`analytics:remediation:${RUN_ID}:step:1`);
    expect(created.runAfter.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(runs.markResolved).not.toHaveBeenCalled();
    expect(restatement.countRemaining).not.toHaveBeenCalled();
  });

  it('should carry a monotonic step into each reschedule key so the chain cannot dedup against itself', async () => {
    // `sync_jobs.idempotencyKey` is globally unique with no TTL: a key built
    // from the run id alone would let the run advance exactly once and then
    // stall at `in-progress` forever (#2039's `reconcileId` trap).
    restatement.restatePage.mockResolvedValue({
      scanned: 200,
      cleared: 200,
      enqueued: 200,
      nextCursor: 'ol_order_z',
    });

    await handler.execute(job(basePayload({ step: 7 })));

    expect(syncJobs.schedule.mock.calls[0][0].idempotencyKey).toBe(
      `analytics:remediation:${RUN_ID}:step:8`
    );
  });

  it('should poll with a delay when orders remain, spending one poll from the budget', async () => {
    restatement.countRemaining.mockResolvedValue({ total: 2, terminalMarked: 0, pending: 2 });

    await handler.execute(job(basePayload({ pollCount: 3 })));

    const [[created]] = syncJobs.schedule.mock.calls;
    expect(created.payload).toMatchObject({ pollCount: 4, afterOrderId: null });
    expect(created.runAfter.getTime()).toBeGreaterThan(
      Date.now() + (ANALYTICS_CURRENCY_RECALCULATE_POLL_DELAY_SECONDS - 5) * 1000
    );
    expect(runs.markResolved).not.toHaveBeenCalled();
    expect(runs.markFailed).not.toHaveBeenCalled();
  });

  it('should fail the run with a non-empty, factually-bounded detail once the poll budget is exhausted', async () => {
    restatement.countRemaining.mockResolvedValue({ total: 5, terminalMarked: 3, pending: 2 });

    await handler.execute(
      job(basePayload({ pollCount: ANALYTICS_CURRENCY_RECALCULATE_MAX_POLLS }))
    );

    expect(runs.markFailed).toHaveBeenCalledTimes(1);
    const detail = runs.markFailed.mock.calls[0][1];
    expect(detail).not.toBe('');
    expect(detail).toContain('5 order(s)');
    expect(detail).toContain('3 reached a terminal FX answer');
    expect(detail).toContain('marketplace.order.fxStamp');
    // It must NOT name a specific terminal reason: `order_records` carries no
    // column holding one, so any specific claim would be invented.
    expect(detail).not.toMatch(/unsupported-pair|no-placed-at|no-rate-source/);
  });

  it('should omit the terminal clause entirely when nothing carries a terminal marker', async () => {
    restatement.countRemaining.mockResolvedValue({ total: 2, terminalMarked: 0, pending: 2 });

    await handler.execute(
      job(basePayload({ pollCount: ANALYTICS_CURRENCY_RECALCULATE_MAX_POLLS }))
    );

    expect(runs.markFailed.mock.calls[0][1]).not.toContain('terminal FX answer');
  });

  it('should rebuild the whole run state from the payload and the ledger row, holding nothing in memory', async () => {
    // Restart-safety: a fresh handler instance handed a mid-run payload must
    // resume exactly where the payload says, with no prior call.
    restatement.restatePage.mockResolvedValue({
      scanned: 200,
      cleared: 200,
      enqueued: 200,
      nextCursor: 'ol_order_zz',
    });

    await handler.execute(
      job(
        basePayload({
          afterOrderId: 'ol_order_m',
          pollCount: 2,
          step: 4,
          sourceConnectionId: '11111111-1111-4111-8111-111111111111',
        })
      )
    );

    expect(restatement.restatePage).toHaveBeenCalledWith(
      {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-27T00:00:00.000Z'),
        sourceConnectionId: '11111111-1111-4111-8111-111111111111',
      },
      'EUR',
      { runId: RUN_ID, afterOrderId: 'ol_order_m', limit: expect.any(Number) }
    );
  });

  it('should no-op on a run another worker already terminalised', async () => {
    runs.getRun.mockResolvedValue({
      id: RUN_ID,
      category: 'currency',
      status: 'resolved',
      detail: null,
      affectedCount: 13,
      triggeredByUserId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(handler.execute(job(basePayload()))).resolves.toEqual({ outcome: 'ok' });
    expect(restatement.restatePage).not.toHaveBeenCalled();
  });

  it('should report a terminal business_failure when the run row no longer exists', async () => {
    runs.getRun.mockResolvedValue(null);

    await expect(handler.execute(job(basePayload()))).resolves.toEqual({
      outcome: 'business_failure',
    });
  });

  it('should reject a payload with an unparseable range rather than repairing a guessed scope', async () => {
    await expect(handler.execute(job(basePayload({ to: 'not-a-date' })))).rejects.toBeInstanceOf(
      SyncJobExecutionError
    );
  });

  it('should resolve the reporting currency once and use the same value for repair and completion', async () => {
    restatement.countRemaining.mockResolvedValue({ total: 1, terminalMarked: 0, pending: 1 });

    await handler.execute(job(basePayload()));

    expect(reportingCurrency.resolve).toHaveBeenCalledTimes(1);
    expect(restatement.restatePage.mock.calls[0][1]).toBe('EUR');
    expect(restatement.countRemaining.mock.calls[0][1]).toBe('EUR');
  });
});
