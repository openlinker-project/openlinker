/**
 * Sync Pacing Model
 *
 * The arithmetic behind the operational-settings page (#2653), as a pure
 * function of the form values plus the catalogue size. No request of its own,
 * so dragging a slider stays responsive, and — the reason it lives here
 * rather than inside the page — it is unit-testable on its own instead of
 * being asserted through the DOM.
 *
 * The model is honest by construction:
 *
 * - Per-run cost is `measured / baseValue * chosenValue`. #2644 measured 29
 *   requests / 46 s per catalogue run and 5 requests / 20 s per stock run
 *   IDENTICALLY at 10 000 and at 100 000 products, so the per-run cost is
 *   size-invariant and scaling it linearly with the chosen value is
 *   defensible rather than invented.
 * - A full pass is `ceil(products / perRun) * interval`.
 *
 * What it does NOT do is predict failure. The measured figures came from
 * OpenLinker's own pacing, never from pushing a shop until it broke, so the
 * projection is load, not a survival forecast. That claim is rendered on the
 * page next to the numbers, not buried in a doc.
 *
 * Catalogue size is `null` when it is not known. Every cycle length is then
 * `null` too — a guessed total is worse than an absent one, because an
 * operator acts on it.
 *
 * @module apps/web/src/features/settings/lib
 */

/**
 * One measured run, from `perf/prestashop-baseline/results-D-2026-08-28.md`
 * (#2644). `intervalMinutes` is the cadence the worker ships for that sweep;
 * neither is settable through this surface, so both are constants here.
 */
export interface MeasuredRun {
  readonly perRun: number;
  readonly requests: number;
  readonly seconds: number;
  readonly intervalMinutes: number;
}

export const CATALOGUE_RUN_BASELINE: MeasuredRun = {
  perRun: 500,
  requests: 29,
  seconds: 46,
  intervalMinutes: 20,
};

export const STOCK_RUN_BASELINE: MeasuredRun = {
  perRun: 100,
  requests: 5,
  seconds: 20,
  intervalMinutes: 15,
};

/** The default a host process limit falls back to — AZ.pl's lowest tier (#2614). */
export const DEFAULT_HOST_PROCESS_LIMIT_SECONDS = 300;

export interface SyncPacingInputs {
  readonly catalogueSweepBudget: number;
  readonly inventorySweepBudget: number;
  readonly deletionAuditBudget: number;
  /** Cron expression, as the API stores it. */
  readonly deletionAuditCadence: string;
  readonly hostProcessLimitSeconds: number;
  /** `null` when OpenLinker does not know how many products the shop holds. */
  readonly catalogueSize: number | null;
}

export interface SyncPacingProjection {
  readonly catalogueRequestsPerRun: number;
  readonly catalogueRunSeconds: number;
  readonly catalogueWindowSeconds: number;
  readonly stockRequestsPerRun: number;
  readonly stockRunSeconds: number;
  /** Days for one full catalogue pass. `null` when the catalogue size is unknown. */
  readonly cataloguePassDays: number | null;
  readonly stockPassDays: number | null;
  /** How long a product deleted at the shop can keep selling. `null` when unknown. */
  readonly deletionWindowDays: number | null;
  /** The projected catalogue run outlasts the host's process limit. */
  readonly exceedsHostLimit: boolean;
  /** The projected catalogue run outlasts its own interval, so runs queue. */
  readonly exceedsInterval: boolean;
}

const MINUTES_PER_DAY = 1440;

/** Suggestions are rounded down to this step so the number reads as advice. */
const SUGGESTION_STEP = 50;

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Minutes between two firings of a cron expression.
 *
 * Deliberately NOT a cron library. The page offers a fixed set of cadences,
 * and this recognises exactly those plus the handful of shapes an env var
 * realistically carries. Anything else returns `null`, which the page renders
 * as "cannot be worked out" rather than as a number — an operator would act
 * on a wrong figure, and would not act on an absent one.
 */
export function readCadenceIntervalMinutes(expression: string): number | null {
  const fields = expression.trim().split(/\s+/);
  // A 6-field expression leads with seconds; the minute/hour pair is what
  // matters, so drop the seconds field and read the rest the same way.
  const normalised = fields.length === 6 ? fields.slice(1) : fields;
  if (normalised.length !== 5) {
    return null;
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = normalised;
  if (dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') {
    return null;
  }

  const everyMinutes = /^\*\/(\d+)$/.exec(minute);
  if (everyMinutes && hour === '*') {
    const step = Number(everyMinutes[1]);
    return step > 0 && step < 60 ? step : null;
  }

  if (!/^\d+$/.test(minute)) {
    return null;
  }

  if (hour === '*') {
    return 60;
  }

  const everyHours = /^\*\/(\d+)$/.exec(hour);
  if (everyHours) {
    const step = Number(everyHours[1]);
    return step > 0 && step < 24 ? step * 60 : null;
  }

  if (/^\d+$/.test(hour)) {
    return MINUTES_PER_DAY;
  }

  return null;
}

function passDays(
  catalogueSize: number | null,
  perRun: number,
  intervalMinutes: number | null
): number | null {
  if (catalogueSize === null || catalogueSize <= 0 || intervalMinutes === null) {
    return null;
  }
  return (Math.ceil(catalogueSize / positive(perRun, 1)) * intervalMinutes) / MINUTES_PER_DAY;
}

export function projectSyncPacing(inputs: SyncPacingInputs): SyncPacingProjection {
  const catalogueScale = positive(inputs.catalogueSweepBudget, 1) / CATALOGUE_RUN_BASELINE.perRun;
  const stockScale = positive(inputs.inventorySweepBudget, 1) / STOCK_RUN_BASELINE.perRun;

  const catalogueRunSeconds = CATALOGUE_RUN_BASELINE.seconds * catalogueScale;
  const catalogueWindowSeconds = CATALOGUE_RUN_BASELINE.intervalMinutes * 60;
  const auditIntervalMinutes = readCadenceIntervalMinutes(inputs.deletionAuditCadence);

  return {
    catalogueRequestsPerRun: Math.round(CATALOGUE_RUN_BASELINE.requests * catalogueScale),
    catalogueRunSeconds,
    catalogueWindowSeconds,
    stockRequestsPerRun: Math.round(STOCK_RUN_BASELINE.requests * stockScale),
    stockRunSeconds: STOCK_RUN_BASELINE.seconds * stockScale,
    cataloguePassDays: passDays(
      inputs.catalogueSize,
      inputs.catalogueSweepBudget,
      CATALOGUE_RUN_BASELINE.intervalMinutes
    ),
    stockPassDays: passDays(
      inputs.catalogueSize,
      inputs.inventorySweepBudget,
      STOCK_RUN_BASELINE.intervalMinutes
    ),
    deletionWindowDays: passDays(
      inputs.catalogueSize,
      inputs.deletionAuditBudget,
      auditIntervalMinutes
    ),
    exceedsHostLimit:
      catalogueRunSeconds > positive(inputs.hostProcessLimitSeconds, DEFAULT_HOST_PROCESS_LIMIT_SECONDS),
    exceedsInterval: catalogueRunSeconds > catalogueWindowSeconds,
  };
}

/**
 * The largest catalogue value whose projected run still finishes inside the
 * host's process limit, rounded down to a readable step and clamped to the
 * range the API accepts.
 *
 * The alert that names a limit has to name a way out of it — a warning with
 * no exit is a wall, and the operator's next move is to guess.
 */
export function suggestCatalogueValueWithin(
  hostProcessLimitSeconds: number,
  bound: { min: number; max: number }
): number {
  const limit = positive(hostProcessLimitSeconds, DEFAULT_HOST_PROCESS_LIMIT_SECONDS);
  const raw = (limit / CATALOGUE_RUN_BASELINE.seconds) * CATALOGUE_RUN_BASELINE.perRun;
  const stepped = Math.floor(raw / SUGGESTION_STEP) * SUGGESTION_STEP;
  return Math.min(bound.max, Math.max(bound.min, stepped));
}

/** `46 s`, always whole seconds — a projection to one decimal invites trust it has not earned. */
export function formatSeconds(seconds: number): string {
  return `${String(Math.round(seconds))} s`;
}

/** `18 h` under a day, `2.8 d` above it. `null` reads as an em dash at the call site. */
export function formatDays(days: number | null): string | null {
  if (days === null) {
    return null;
  }
  if (days < 1) {
    return `${String(Math.round(days * 24 * 10) / 10)} h`;
  }
  return `${String(Math.round(days * 10) / 10)} d`;
}
