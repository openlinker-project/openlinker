/**
 * Sync Pacing Model — unit tests
 *
 * The arithmetic is asserted here, on the pure function, rather than through
 * the DOM. A projection read off a rendered page proves the page renders; it
 * does not prove the number is right, and the number is what an operator acts
 * on.
 *
 * @module apps/web/src/features/settings/lib
 */
import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_RUN_BASELINE,
  formatDays,
  formatSeconds,
  projectSyncPacing,
  readCadenceIntervalMinutes,
  suggestCatalogueValueWithin,
  type SyncPacingInputs,
} from './sync-pacing-model';

const DEFAULTS: SyncPacingInputs = {
  catalogueSweepBudget: 500,
  inventorySweepBudget: 100,
  deletionAuditBudget: 100,
  deletionAuditCadence: '0 * * * *',
  hostProcessLimitSeconds: 300,
  catalogueSize: 100_000,
};

describe('projectSyncPacing', () => {
  it('should reproduce the measured baseline when nothing is changed', () => {
    const projection = projectSyncPacing(DEFAULTS);

    expect(projection.catalogueRequestsPerRun).toBe(29);
    expect(projection.catalogueRunSeconds).toBe(46);
    expect(projection.stockRequestsPerRun).toBe(5);
    expect(projection.stockRunSeconds).toBe(20);
  });

  it('should scale the per-run cost linearly with the chosen value', () => {
    const projection = projectSyncPacing({ ...DEFAULTS, catalogueSweepBudget: 2000 });

    // 4x the value, 4x the measured cost — the #2644 model.
    expect(projection.catalogueRunSeconds).toBe(184);
    expect(projection.catalogueRequestsPerRun).toBe(116);
  });

  it('should report the shipped cycle lengths at 100 000 products', () => {
    const projection = projectSyncPacing(DEFAULTS);

    expect(formatDays(projection.cataloguePassDays)).toBe('2.8 d');
    expect(formatDays(projection.stockPassDays)).toBe('10.4 d');
    expect(formatDays(projection.deletionWindowDays)).toBe('41.7 d');
  });

  it('should report every cycle length as unknown when the catalogue size is not known', () => {
    const projection = projectSyncPacing({ ...DEFAULTS, catalogueSize: null });

    expect(projection.cataloguePassDays).toBeNull();
    expect(projection.stockPassDays).toBeNull();
    expect(projection.deletionWindowDays).toBeNull();
    // The per-run figures do not depend on catalogue size, so they survive.
    expect(projection.catalogueRunSeconds).toBe(46);
  });

  it('should flag a run that outlasts the host process limit', () => {
    const projection = projectSyncPacing({
      ...DEFAULTS,
      catalogueSweepBudget: 2000,
      hostProcessLimitSeconds: 120,
    });

    expect(projection.exceedsHostLimit).toBe(true);
    expect(projection.exceedsInterval).toBe(false);
  });

  it('should flag a run that outlasts its own interval separately from the host limit', () => {
    const projection = projectSyncPacing({
      ...DEFAULTS,
      catalogueSweepBudget: 20_000,
      hostProcessLimitSeconds: 100_000,
    });

    expect(projection.exceedsInterval).toBe(true);
    expect(projection.exceedsHostLimit).toBe(false);
  });

  it('should treat a cadence it cannot read as an unknown deletion window rather than a number', () => {
    const projection = projectSyncPacing({
      ...DEFAULTS,
      deletionAuditCadence: '0 0 1 * *',
    });

    expect(projection.deletionWindowDays).toBeNull();
  });
});

describe('readCadenceIntervalMinutes', () => {
  it.each([
    ['*/15 * * * *', 15],
    ['*/30 * * * *', 30],
    ['0 * * * *', 60],
    ['0 */4 * * *', 240],
    ['0 3 * * *', 1440],
    ['0 0 * * * *', 60],
  ])('should read %s as %i minutes', (expression, expected) => {
    expect(readCadenceIntervalMinutes(expression)).toBe(expected);
  });

  it.each([['0 0 1 * *'], ['0 0 * * 1'], ['nonsense'], ['* * *']])(
    'should refuse to guess an interval for %s',
    (expression) => {
      expect(readCadenceIntervalMinutes(expression)).toBeNull();
    },
  );
});

describe('suggestCatalogueValueWithin', () => {
  it('should suggest a value whose projected run fits inside the host limit', () => {
    const suggestion = suggestCatalogueValueWithin(120, { min: 1, max: 2000 });

    expect(suggestion).toBe(1300);
    const seconds =
      (CATALOGUE_RUN_BASELINE.seconds / CATALOGUE_RUN_BASELINE.perRun) * suggestion;
    expect(seconds).toBeLessThanOrEqual(120);
  });

  it('should never suggest more than the API accepts', () => {
    expect(suggestCatalogueValueWithin(100_000, { min: 1, max: 2000 })).toBe(2000);
  });

  it('should never suggest less than the API accepts', () => {
    expect(suggestCatalogueValueWithin(1, { min: 1, max: 2000 })).toBe(1);
  });
});

describe('sweep cadence (#2660 review)', () => {
  // Both cadences are settable through the worker's environment
  // (OL_PRODUCT_SYNC_CRON / OL_INVENTORY_SYNC_CRON, and apps/api/.env.example
  // ships one uncommented), so a pass length computed against a hardcoded 20 /
  // 15 minutes is an order of magnitude wrong on an install that changed one.
  it('should compute the catalogue pass from the cadence in force', () => {
    const projection = projectSyncPacing({
      ...DEFAULTS,
      catalogueSweepCadence: '0 */6 * * *',
    });

    // 100 000 / 500 = 200 runs, six hours apart, versus 2.8 d at */20.
    expect(projection.catalogueIntervalMinutes).toBe(360);
    expect(formatDays(projection.cataloguePassDays)).toBe('50 d');
  });

  it('should compute the stock pass from the cadence in force', () => {
    const projection = projectSyncPacing({
      ...DEFAULTS,
      inventorySweepCadence: '0 * * * *',
    });

    expect(projection.inventoryIntervalMinutes).toBe(60);
    expect(projection.stockPassDays).not.toBe(
      projectSyncPacing(DEFAULTS).stockPassDays
    );
  });

  it('should measure the run window against the reported cadence, not the shipped one', () => {
    const projection = projectSyncPacing({
      ...DEFAULTS,
      catalogueSweepBudget: 2000,
      catalogueSweepCadence: '*/5 * * * *',
    });

    expect(projection.catalogueWindowSeconds).toBe(300);
    // 184 s of work against a 300 s window still fits; against */20 the same
    // budget looked comfortable, which is the point of reading the real one.
    expect(projection.exceedsInterval).toBe(false);
  });

  // Absent or unreadable falls back to the shipped cadence AND says so, so the
  // page can qualify the figure instead of stating it as fact.
  it('should fall back to the shipped cadence and report that it assumed one', () => {
    expect(projectSyncPacing(DEFAULTS).assumedShippedCadence).toBe(true);
    expect(
      projectSyncPacing({ ...DEFAULTS, catalogueSweepCadence: 'not-a-cron' })
        .assumedShippedCadence
    ).toBe(true);
    expect(projectSyncPacing({ ...DEFAULTS, catalogueSweepCadence: 'not-a-cron' })
      .catalogueIntervalMinutes).toBe(20);
  });

  it('should report no assumption when both cadences were reported', () => {
    const projection = projectSyncPacing({
      ...DEFAULTS,
      catalogueSweepCadence: '*/20 * * * *',
      inventorySweepCadence: '*/15 * * * *',
    });

    expect(projection.assumedShippedCadence).toBe(false);
  });
});

describe('formatters', () => {
  it('should render seconds whole', () => {
    expect(formatSeconds(183.9999)).toBe('184 s');
  });

  it('should render a sub-day figure in hours', () => {
    expect(formatDays(0.7)).toBe('16.8 h');
  });

  it('should render an unknown span as null so the caller can say so in words', () => {
    expect(formatDays(null)).toBeNull();
  });
});
