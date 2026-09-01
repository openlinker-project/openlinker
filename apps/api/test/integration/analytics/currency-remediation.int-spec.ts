/**
 * Currency Remediation Int-Spec (#2468)
 *
 * The regression test for the original live-demo bug: orders stamped against a
 * PREVIOUS reporting currency were invisible to every `/analytics` KPI, and
 * re-enqueuing `marketplace.order.fxStamp` for them changed nothing —
 * `OrderFxStampService.stamp` short-circuits on any row that already carries a
 * figure. Fixing it by hand meant nulling six columns in psql.
 *
 * Everything below runs against real Testcontainers Postgres because every
 * assertion that matters is about ACTUAL COLUMN STATE. The unit specs mock the
 * query builder, so the guarded six-column clear, the keyset enumeration and
 * the ledger row's partial unique index never execute there.
 *
 * The re-stamp is deliberately driven on the SAME-CURRENCY path (the order's
 * native currency equals the deployment's reporting currency): that branch
 * makes no provider call at all, so the test proves the mechanism without
 * reaching a public reference-rate API. It is also the sharpest possible probe
 * of the `fxIntendedCurrency` trap — leaving that column behind makes
 * `resolveIntent` re-pin the STALE currency and re-stamp it, so a run would
 * report `resolved` with the figures still wrong.
 *
 * @module apps/api/test/integration/analytics
 */
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
  ORDER_FX_STAMP_SERVICE_TOKEN,
  type IOrderFxRestatementService,
  type IOrderFxStampService,
} from '@openlinker/core/orders';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';
import { createTestOrderRecord } from '../fixtures/order.fixtures';

/** A currency no deployment in this repo reports in — a plausible prior era. */
const STALE_REPORTING_CURRENCY = 'USD';

describe('Currency remediation against real Postgres (#2468)', () => {
  let harness: IntegrationTestHarness;
  let runs: IAnalyticsRemediationRunService;
  let restatement: IOrderFxRestatementService;
  let fxStamp: IOrderFxStampService;
  let reportingCurrency: string;

  beforeAll(async () => {
    harness = await getTestHarness();
    const app = harness.getApp();
    runs = app.get<IAnalyticsRemediationRunService>(ANALYTICS_REMEDIATION_RUN_SERVICE_TOKEN);
    restatement = app.get<IOrderFxRestatementService>(ORDER_FX_RESTATEMENT_SERVICE_TOKEN);
    fxStamp = app.get<IOrderFxStampService>(ORDER_FX_STAMP_SERVICE_TOKEN);
    reportingCurrency = await app
      .get<IReportingCurrencySettingsService>(REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN)
      .resolve();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const scope = {
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-08-08T00:00:00.000Z'),
  };

  /**
   * An order whose native currency IS the deployment's reporting currency but
   * whose stamp names a prior era — the exact shape the coverage panel's
   * currency category reports.
   */
  async function seedStaleStampedOrder(total: number): Promise<string> {
    const record = await createTestOrderRecord(harness.getDataSource(), {
      placedAt: new Date('2026-08-03T00:00:00.000Z'),
      recordStatus: 'ready',
      totalAmount: total,
      currency: reportingCurrency,
      orderSnapshot: { items: [], totals: { total, currency: reportingCurrency } },
      reportingCurrency: STALE_REPORTING_CURRENCY,
      reportingTotalAmount: total * 2,
      exchangeRateId: null,
      fxStampedAt: new Date('2026-08-03T01:00:00.000Z'),
      fxIntendedCurrency: STALE_REPORTING_CURRENCY,
      fxRule: 'prev-business-day',
    });
    return record.internalOrderId;
  }

  /**
   * The DEFERRED shape (#2775): `claimFxIntentIfAbsent` pinned an intent under
   * a prior reporting currency, then the provider blipped, so the attempt
   * returned `kind: 'deferred'` and no figure was ever written. The row carries
   * FX state without carrying a figure.
   */
  async function seedDeferredOrder(total: number): Promise<string> {
    const record = await createTestOrderRecord(harness.getDataSource(), {
      placedAt: new Date('2026-08-03T00:00:00.000Z'),
      recordStatus: 'ready',
      totalAmount: total,
      currency: reportingCurrency,
      orderSnapshot: { items: [], totals: { total, currency: reportingCurrency } },
      reportingCurrency: null,
      reportingTotalAmount: null,
      exchangeRateId: null,
      fxStampedAt: null,
      fxIntendedCurrency: STALE_REPORTING_CURRENCY,
      fxRule: 'prev-business-day',
    });
    return record.internalOrderId;
  }

  /**
   * The TERMINAL-MARKED shape (#2775): the pipeline reached a terminal answer,
   * so `fxStampedAt` is set, but no figure was produced.
   * `countRemainingCurrencyMismatch` counts these explicitly as
   * `terminal_marked`, so they are unambiguously in the repaired population.
   */
  async function seedTerminalMarkedOrder(total: number): Promise<string> {
    const record = await createTestOrderRecord(harness.getDataSource(), {
      placedAt: new Date('2026-08-03T00:00:00.000Z'),
      recordStatus: 'ready',
      totalAmount: total,
      currency: reportingCurrency,
      orderSnapshot: { items: [], totals: { total, currency: reportingCurrency } },
      reportingCurrency: null,
      reportingTotalAmount: null,
      exchangeRateId: null,
      fxStampedAt: new Date('2026-08-03T01:00:00.000Z'),
      fxIntendedCurrency: STALE_REPORTING_CURRENCY,
      fxRule: 'prev-business-day',
    });
    return record.internalOrderId;
  }

  async function readOrder(internalOrderId: string): Promise<OrderRecordOrmEntity> {
    return harness
      .getDataSource()
      .getRepository(OrderRecordOrmEntity)
      .findOneOrFail({ where: { internalOrderId } });
  }

  it('reproduces the original defect: a stale-era stamp is never re-stamped by stamp() alone', async () => {
    const orderId = await seedStaleStampedOrder(100);

    const outcome = await fxStamp.stamp(orderId);

    expect(outcome).toMatchObject({ kind: 'stamped', alreadyStamped: true });
    const row = await readOrder(orderId);
    expect(row.reportingCurrency).toBe(STALE_REPORTING_CURRENCY);
  });

  it('clears all six FX columns and leaves the row on the sweep frontier', async () => {
    const orderId = await seedStaleStampedOrder(100);
    const run = await runs.openRun({
      category: 'currency',
      affectedCount: 1,
      triggeredByUserId: 'user-1',
    });

    const page = await restatement.restatePage(scope, reportingCurrency, {
      runId: run.id,
      afterOrderId: null,
      limit: 50,
    });

    expect(page).toMatchObject({ scanned: 1, cleared: 1 });
    const row = await readOrder(orderId);
    expect(row.reportingCurrency).toBeNull();
    expect(row.reportingTotalAmount).toBeNull();
    expect(row.exchangeRateId).toBeNull();
    expect(row.fxStampedAt).toBeNull();
    // The subtle one: left behind, `resolveIntent` re-pins USD and the repair
    // silently produces the same wrong figure.
    expect(row.fxIntendedCurrency).toBeNull();
    expect(row.fxRule).toBeNull();
  });

  it('re-stamps into the CURRENT reporting currency after the clear, not the stale one', async () => {
    const orderId = await seedStaleStampedOrder(100);
    const run = await runs.openRun({
      category: 'currency',
      affectedCount: 1,
      triggeredByUserId: 'user-1',
    });
    await restatement.restatePage(scope, reportingCurrency, {
      runId: run.id,
      afterOrderId: null,
      limit: 50,
    });

    const outcome = await fxStamp.stamp(orderId);

    expect(outcome).toMatchObject({
      kind: 'stamped',
      alreadyStamped: false,
      reportingCurrency,
      reportingTotalAmount: 100,
    });
    const row = await readOrder(orderId);
    expect(row.reportingCurrency).toBe(reportingCurrency);
    expect(Number(row.reportingTotalAmount)).toBe(100);
  });

  it('reaches resolved once the whole scope is re-stamped, with the ledger row as the only state', async () => {
    const orderIds = [
      await seedStaleStampedOrder(100),
      await seedStaleStampedOrder(250),
      await seedStaleStampedOrder(75),
    ];
    const run = await runs.openRun({
      category: 'currency',
      affectedCount: orderIds.length,
      triggeredByUserId: 'user-1',
    });

    // Enumerate in two pages so the keyset cursor is genuinely exercised: a
    // cleared row still satisfies the mismatch predicate, so an offset walk
    // would re-read page one forever.
    const first = await restatement.restatePage(scope, reportingCurrency, {
      runId: run.id,
      afterOrderId: null,
      limit: 2,
    });
    expect(first.nextCursor).not.toBeNull();
    const second = await restatement.restatePage(scope, reportingCurrency, {
      runId: run.id,
      afterOrderId: first.nextCursor,
      limit: 2,
    });
    expect(second.nextCursor).toBeNull();
    expect(first.scanned + second.scanned).toBe(3);

    // Mid-run the population is still fully mismatched (cleared, not stamped).
    await expect(restatement.countRemaining(scope, reportingCurrency)).resolves.toMatchObject({
      total: 3,
      terminalMarked: 0,
      pending: 3,
    });

    for (const orderId of orderIds) {
      await fxStamp.stamp(orderId);
    }

    await expect(restatement.countRemaining(scope, reportingCurrency)).resolves.toMatchObject({
      total: 0,
    });
    await expect(runs.markResolved(run.id)).resolves.toBe(true);
    await expect(runs.getRun(run.id)).resolves.toMatchObject({
      status: 'resolved',
      detail: null,
      affectedCount: 3,
    });
  });

  it('fails with a non-empty detail while orders remain, and reports the terminal partition honestly', async () => {
    await seedStaleStampedOrder(100);
    const run = await runs.openRun({
      category: 'currency',
      affectedCount: 1,
      triggeredByUserId: 'user-1',
    });
    await restatement.restatePage(scope, reportingCurrency, {
      runId: run.id,
      afterOrderId: null,
      limit: 50,
    });

    const remaining = await restatement.countRemaining(scope, reportingCurrency);
    expect(remaining.total).toBe(1);

    await expect(runs.markFailed(run.id, `${remaining.total} order(s) still unstamped`)).resolves.toBe(
      true
    );
    const failed = await runs.getRun(run.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.detail).toBeTruthy();
  });

  it('admits at most one open run per category, so a double-click cannot start two repairs', async () => {
    await runs.openRun({
      category: 'currency',
      affectedCount: 1,
      triggeredByUserId: 'user-1',
    });

    await expect(
      runs.openRun({ category: 'currency', affectedCount: 1, triggeredByUserId: 'user-2' })
    ).rejects.toThrow(/already exists/);
  });

  it('frees the category slot once a run is terminal, so a later repair can start', async () => {
    const first = await runs.openRun({
      category: 'currency',
      affectedCount: 1,
      triggeredByUserId: 'user-1',
    });
    await runs.markResolved(first.id);

    const second = await runs.openRun({
      category: 'currency',
      affectedCount: 2,
      triggeredByUserId: 'user-2',
    });

    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('in-progress');
  });

  it('clears a DEFERRED row, whose pinned intent would otherwise re-stamp the stale currency (#2775)', async () => {
    const orderId = await seedDeferredOrder(100);
    const run = await runs.openRun({
      category: 'currency',
      affectedCount: 1,
      triggeredByUserId: 'user-1',
    });

    const page = await restatement.restatePage(scope, reportingCurrency, {
      runId: run.id,
      afterOrderId: null,
      limit: 50,
    });

    expect(page).toMatchObject({ scanned: 1, cleared: 1, enqueued: 1 });
    const row = await readOrder(orderId);
    expect(row.reportingCurrency).toBeNull();
    expect(row.reportingTotalAmount).toBeNull();
    expect(row.exchangeRateId).toBeNull();
    expect(row.fxStampedAt).toBeNull();
    expect(row.fxIntendedCurrency).toBeNull();
    expect(row.fxRule).toBeNull();

    // The point of the clear: the re-stamp names the CURRENT currency. With the
    // stale intent left behind, `resolveIntent` re-pins it and the run cannot
    // converge.
    await expect(fxStamp.stamp(orderId)).resolves.toMatchObject({
      kind: 'stamped',
      alreadyStamped: false,
      reportingCurrency,
    });
  });

  it('clears a TERMINAL-MARKED row, so it is not held out by its own marker (#2775)', async () => {
    const orderId = await seedTerminalMarkedOrder(60);
    const run = await runs.openRun({
      category: 'currency',
      affectedCount: 1,
      triggeredByUserId: 'user-1',
    });

    const page = await restatement.restatePage(scope, reportingCurrency, {
      runId: run.id,
      afterOrderId: null,
      limit: 50,
    });

    expect(page).toMatchObject({ scanned: 1, cleared: 1 });
    const row = await readOrder(orderId);
    expect(row.fxStampedAt).toBeNull();
    expect(row.fxIntendedCurrency).toBeNull();
    expect(row.fxRule).toBeNull();

    await expect(fxStamp.stamp(orderId)).resolves.toMatchObject({
      kind: 'stamped',
      reportingCurrency,
      reportingTotalAmount: 60,
    });
  });

  it('reaches resolved over a mixed population of stale, deferred and terminal-marked rows (#2775)', async () => {
    const orderIds = [
      await seedStaleStampedOrder(100),
      await seedDeferredOrder(250),
      await seedTerminalMarkedOrder(75),
    ];
    const run = await runs.openRun({
      category: 'currency',
      affectedCount: orderIds.length,
      triggeredByUserId: 'user-1',
    });

    const page = await restatement.restatePage(scope, reportingCurrency, {
      runId: run.id,
      afterOrderId: null,
      limit: 50,
    });
    expect(page).toMatchObject({ scanned: 3, cleared: 3, enqueued: 3 });

    for (const orderId of orderIds) {
      await fxStamp.stamp(orderId);
    }

    // Before #2775 the deferred and terminal-marked rows re-stamped USD, so
    // this total stuck at 2 and the run's completion poll closed `failed`.
    await expect(restatement.countRemaining(scope, reportingCurrency)).resolves.toMatchObject({
      total: 0,
      terminalMarked: 0,
      pending: 0,
    });
    await expect(runs.markResolved(run.id)).resolves.toBe(true);
    await expect(runs.getRun(run.id)).resolves.toMatchObject({ status: 'resolved', detail: null });
  });

  it('leaves a never-stamped order uncleared but still enqueued, so the guard is idempotent', async () => {
    const record = await createTestOrderRecord(harness.getDataSource(), {
      placedAt: new Date('2026-08-03T00:00:00.000Z'),
      recordStatus: 'ready',
      totalAmount: 40,
      currency: reportingCurrency,
      orderSnapshot: { items: [], totals: { total: 40, currency: reportingCurrency } },
      reportingCurrency: null,
      reportingTotalAmount: null,
    });
    const run = await runs.openRun({
      category: 'currency',
      affectedCount: 1,
      triggeredByUserId: 'user-1',
    });

    const page = await restatement.restatePage(scope, reportingCurrency, {
      runId: run.id,
      afterOrderId: null,
      limit: 50,
    });

    expect(page).toMatchObject({ scanned: 1, cleared: 0, enqueued: 1 });
    const row = await readOrder(record.internalOrderId);
    expect(row.fxStampedAt).toBeNull();
  });
});
