/**
 * Operational Settings Types
 *
 * The vocabulary behind the singleton `operational_settings` row (#2651): the
 * knobs that decide how hard OpenLinker works a shop's catalogue, their
 * bounds, the env var each falls back to, and the `source` every resolved
 * value is reported with.
 *
 * Resolution is `DB row -> env var -> code default`, the shape
 * `ReportingCurrencySettingsView` (ADR-040) and `ai_provider_active_setting`
 * (#451/#452) already established. `source` travels WITH the value so a UI can
 * render `500 (default)` instead of comparing against a hardcoded number
 * client-side - a client-side comparison is a second copy of the default, and
 * it is wrong the day the default moves.
 *
 * Carries the pure resolution + validation rules alongside the types they are
 * the rules FOR, per `engineering-standards.md` § *The pure-rule exception*:
 * adding a knob means editing both halves in the same commit, and splitting
 * them invites a consumer to restate the bound instead of reading it.
 *
 * @module libs/core/src/operational-settings/domain/types
 */

/** Which rung of `row -> env -> default` produced the resolved value. */
export const OPERATIONAL_SETTING_SOURCES = ['setting', 'env', 'default'] as const;

export type OperationalSettingSource = (typeof OPERATIONAL_SETTING_SOURCES)[number];

/** The numeric knobs this surface owns. */
export const OPERATIONAL_SETTING_KEYS = [
  'catalogueSweepBudget',
  'inventorySweepBudget',
  'sweepPageSize',
  'deletionAuditBudget',
] as const;

export type OperationalSettingKey = (typeof OPERATIONAL_SETTING_KEYS)[number];

export interface OperationalSettingBound {
  readonly min: number;
  readonly max: number;
  readonly default: number;
  /** The env var consulted between the settings row and the default. */
  readonly envVar: string;
}

/**
 * The one place a bound is stated.
 *
 * Reported === enforced structurally: the API validator, the response DTO's
 * `bounds` block and the worker's own clamp all read THIS object, so a value
 * an operator is told is accepted can never be one the worker silently clamps
 * (the `getStreamConcurrency` rule from #2229, applied to a settings surface).
 *
 * Each ceiling is the ceiling the read site already enforced, or the value
 * #2651 argues for - never a number chosen to look generous:
 *
 * - `catalogueSweepBudget` 2000 is `BATCHED_SWEEP_BUDGET_MAX`, which #2644's
 *   linear model puts at a ~184 s tick against a 1200 s window.
 * - `inventorySweepBudget` 2000 matches it. The inventory sweep's own
 *   `SWEEP_BUDGET_MAX` of 500 bounds a PAYLOAD override, and #2644 measured a
 *   10.4-day inventory cycle at the default - headroom is the point.
 * - `sweepPageSize` 100 is `SWEEP_BATCH_SIZE_MAX`, i.e. PrestaShop's own
 *   collection page and WooCommerce's hard `per_page` cap. #2651 proposed 500;
 *   accepting 500 while the handler clamps to 100 would be exactly the
 *   reported-versus-enforced gap this table exists to close, so the existing
 *   clamp wins and raising it is a separate, measured decision.
 * - `deletionAuditBudget` 2000 matches the catalogue sweep: #2644 measured a
 *   41.7-day audit cycle, which is the sharp number this issue exists for.
 */
export const OPERATIONAL_SETTING_BOUNDS: Readonly<
  Record<OperationalSettingKey, OperationalSettingBound>
> = {
  catalogueSweepBudget: { min: 1, max: 2000, default: 500, envVar: 'OL_PRODUCT_SYNC_PAGE_LIMIT' },
  inventorySweepBudget: {
    min: 1,
    max: 2000,
    default: 100,
    envVar: 'OL_INVENTORY_SYNC_PAGE_LIMIT',
  },
  sweepPageSize: { min: 1, max: 100, default: 100, envVar: 'OL_SWEEP_PAGE_SIZE' },
  deletionAuditBudget: {
    min: 1,
    max: 2000,
    default: 100,
    envVar: 'OL_MASTER_PRODUCT_RECONCILE_PAGE_LIMIT',
  },
};

/** Hourly - the cadence `CORE_CAPABILITY_TASKS` ships for `master.product.reconcile`. */
export const DELETION_AUDIT_CADENCE_DEFAULT = '0 * * * *';

/** The env var consulted between the settings row and the default cadence. */
export const DELETION_AUDIT_CADENCE_ENV_VAR = 'OL_MASTER_PRODUCT_RECONCILE_CRON';

/** One resolved value plus the rung that produced it. */
export interface ResolvedOperationalSetting<T> {
  readonly value: T;
  readonly source: OperationalSettingSource;
}

/**
 * Everything a read site needs, in one round trip.
 *
 * Deliberately NOT split per read site: the worker resolves once per tick, and
 * a per-knob endpoint would turn one singleton-row PK lookup into four.
 */
export interface OperationalSettingsView {
  readonly catalogueSweepBudget: ResolvedOperationalSetting<number>;
  readonly inventorySweepBudget: ResolvedOperationalSetting<number>;
  readonly sweepPageSize: ResolvedOperationalSetting<number>;
  readonly deletionAuditBudget: ResolvedOperationalSetting<number>;
  readonly deletionAuditCadence: ResolvedOperationalSetting<string>;
  /**
   * Always `true`.
   *
   * #2222 made the deletion audit the deletion authority, and switching it off
   * silently reopens #1689 - a deleted product whose offers keep selling. The
   * field exists so the surface STATES that rather than leaving its absence to
   * be read as an oversight; there is no input that can change it.
   */
  readonly deletionAuditAlwaysEnabled: true;
  /** `null` on the env / default rungs - there is no row to have been written. */
  readonly updatedAt: Date | null;
  readonly updatedBy: string | null;
}

/**
 * What a write may set. Every field is optional and `null` means "clear it,
 * fall back to the existing env-or-default resolution" - the same meaning the
 * nullable column carries, so a caller never has to know which rung answered.
 */
export interface OperationalSettingsInput {
  readonly catalogueSweepBudget?: number | null;
  readonly inventorySweepBudget?: number | null;
  readonly sweepPageSize?: number | null;
  readonly deletionAuditBudget?: number | null;
  readonly deletionAuditCadence?: string | null;
}

/**
 * Bounds check for one numeric knob.
 *
 * Returns the offending message rather than throwing, so the caller decides
 * whether that is a domain exception (the service) or a 400 (the controller).
 * Mirrors `ConnectionService.validateRateLimitConfig`: a browser is not a
 * trust boundary, and the raw JSON path bypasses any form.
 */
export function checkOperationalSettingBound(
  key: OperationalSettingKey,
  value: number
): string | null {
  const bound = OPERATIONAL_SETTING_BOUNDS[key];
  if (!Number.isInteger(value) || value < bound.min || value > bound.max) {
    return `${key} must be an integer between ${String(bound.min)} and ${String(bound.max)}`;
  }
  return null;
}

/**
 * Coerces an env-var string to a usable knob value.
 *
 * A malformed or out-of-range env var is IGNORED rather than clamped: the env
 * rung is the pre-existing behaviour this change must not alter, and every
 * read site already ignored a non-numeric value the same way. Returns `null`
 * so the caller falls through to the default.
 */
export function readOperationalSettingEnv(
  key: OperationalSettingKey,
  raw: string | undefined
): number | null {
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  const floored = Math.floor(parsed);
  const bound = OPERATIONAL_SETTING_BOUNDS[key];
  return Math.min(Math.max(floored, bound.min), bound.max);
}

/**
 * Resolves one knob across the three rungs, reporting which one answered.
 *
 * The stored value is clamped on the way OUT as well as validated on the way
 * in: a row written before a ceiling moved, or edited straight in the
 * database, must not be able to hand the worker a budget the bound says is
 * impossible.
 */
export function resolveOperationalSetting(
  key: OperationalSettingKey,
  stored: number | null,
  env: string | undefined
): ResolvedOperationalSetting<number> {
  const bound = OPERATIONAL_SETTING_BOUNDS[key];
  if (stored !== null) {
    return {
      value: Math.min(Math.max(Math.floor(stored), bound.min), bound.max),
      source: 'setting',
    };
  }
  const fromEnv = readOperationalSettingEnv(key, env);
  if (fromEnv !== null) {
    return { value: fromEnv, source: 'env' };
  }
  return { value: bound.default, source: 'default' };
}
