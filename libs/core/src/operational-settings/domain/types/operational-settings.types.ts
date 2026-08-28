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
  /**
   * OUR judgement about what is sensible. Advisory: a value above it is
   * accepted, but only when the caller says explicitly that it means to.
   */
  readonly recommendedMax: number;
  /** Why the recommendation sits where it does, in operator-facing words. */
  readonly recommendedReason: string;
  /**
   * The refusal line. Also ours - a sanity backstop against a typo or a
   * pathological value, NOT a platform fact. A platform's own wall is enforced
   * where the request is built (see `clampToAdapterPageSize`), because that is
   * the only place that knows which adapter is about to send it.
   */
  readonly absoluteMax: number;
  readonly absoluteReason: string;
  readonly default: number;
  /** The env var consulted between the settings row and the default. */
  readonly envVar: string;
}

/**
 * The one place a bound is stated.
 *
 * Two kinds of limit, deliberately not conflated (#2651 follow-up):
 *
 * - a **recommended ceiling** is our opinion, and an operator may exceed it by
 *   asking explicitly. Refusing outright would make OpenLinker's judgement
 *   binding on somebody else's hardware.
 * - an **absolute ceiling** is refused whatever anyone says.
 *
 * Reported === enforced remains the governing rule: a value this table accepts
 * is the value the worker applies, which is why the resolve-time clamp uses
 * `absoluteMax` and never `recommendedMax` - clamping an acknowledged value
 * back down would report a number that is not what runs.
 *
 * The earlier revision of this table capped `sweepPageSize` at 100 on the
 * stated grounds that it was "PrestaShop's collection page size and
 * WooCommerce's hard `per_page` cap". Both halves were wrong for THIS value.
 * PrestaShop pages through the `limit=[offset,]count` comma syntax with no cap
 * (`prestashop-query.builder.ts`; #2644 measured `limit=99000,500` against a
 * live shop), so 100 was an OpenLinker convention presented as a platform
 * fact. And WooCommerce's genuine `per_page` cap does not apply to this value
 * at all: it is the batch child's `groupSize`, never a `per_page`. The real
 * `per_page` carrier is the enumeration page size, and that wall is now
 * enforced where the request is built.
 */
export const OPERATIONAL_SETTING_BOUNDS: Readonly<
  Record<OperationalSettingKey, OperationalSettingBound>
> = {
  catalogueSweepBudget: {
    min: 1,
    recommendedMax: 2000,
    recommendedReason:
      "#2644's linear model puts a 2000-item tick at ~184 s against a 1200 s window. Past this the binding constraint is the lane's per-scope cap rather than the read, so raising it alone mostly deepens the queue.",
    absoluteMax: 20_000,
    absoluteReason:
      'A sanity backstop against a mistyped value, not a platform limit. One run holds every enqueued id in memory and writes one child job each.',
    default: 500,
    envVar: 'OL_PRODUCT_SYNC_PAGE_LIMIT',
  },
  inventorySweepBudget: {
    min: 1,
    recommendedMax: 2000,
    recommendedReason:
      '#2644 measured a 10.4-day inventory cycle at the default of 100, so headroom is the point; 2000 matches the catalogue sweep.',
    absoluteMax: 20_000,
    absoluteReason: 'The same sanity backstop as the catalogue sweep.',
    default: 100,
    envVar: 'OL_INVENTORY_SYNC_PAGE_LIMIT',
  },
  sweepPageSize: {
    min: 1,
    recommendedMax: 100,
    recommendedReason:
      "100 is PrestaShop's own collection page size and the size #2593 measured the batched read against. A larger batch buys few extra requests and makes one failure cost more work.",
    absoluteMax: 500,
    absoluteReason:
      "The batch child's ids are |-joined into a query-string filter (PrestashopQueryBuilder), so this value drives URL length directly. 500 seven-digit ids is roughly 4 KB of query string, comfortably under the 8 KB request-line limit nginx and Apache default to; 2000 would not be.",
    default: 100,
    envVar: 'OL_SWEEP_PAGE_SIZE',
  },
  deletionAuditBudget: {
    min: 1,
    recommendedMax: 2000,
    recommendedReason:
      '#2644 measured a 41.7-day audit cycle at the default of 100 on a 100 000-product catalogue, which is the number this knob exists for.',
    absoluteMax: 20_000,
    absoluteReason: 'The same sanity backstop as the catalogue sweep.',
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
 * A resolved number, plus which ceiling applied to it and why.
 *
 * The UI renders the reason rather than inventing one, and
 * `aboveRecommended` is what lets a value an operator deliberately pushed past
 * our advice read back AS such instead of looking like an ordinary setting.
 */
export interface ResolvedOperationalNumber extends ResolvedOperationalSetting<number> {
  readonly recommendedMax: number;
  readonly recommendedReason: string;
  readonly absoluteMax: number;
  readonly absoluteReason: string;
  /** `true` when the effective value exceeds our recommendation. */
  readonly aboveRecommended: boolean;
}

/**
 * Everything a read site needs, in one round trip.
 *
 * Deliberately NOT split per read site: the worker resolves once per tick, and
 * a per-knob endpoint would turn one singleton-row PK lookup into four.
 */
export interface OperationalSettingsView {
  readonly catalogueSweepBudget: ResolvedOperationalNumber;
  readonly inventorySweepBudget: ResolvedOperationalNumber;
  readonly sweepPageSize: ResolvedOperationalNumber;
  readonly deletionAuditBudget: ResolvedOperationalNumber;
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
  /**
   * Permission to exceed a RECOMMENDED ceiling on this request.
   *
   * Deliberately per-request rather than a stored preference: an operator
   * choosing to run past our advice once should not silently license every
   * later write, and a value that is merely mistyped is still refused. It can
   * never license exceeding an `absoluteMax`.
   */
  readonly acknowledgeAboveRecommended?: boolean;
}

/**
 * Bounds check for one numeric knob.
 *
 * Returns the offending message rather than throwing, so the caller decides
 * whether that is a domain exception (the service) or a 400 (the controller).
 * Mirrors `ConnectionService.validateRateLimitConfig`: a browser is not a
 * trust boundary, and the raw JSON path bypasses any form.
 *
 * A value above the RECOMMENDED ceiling is refused unless the caller
 * acknowledged it; a value above the ABSOLUTE ceiling is refused either way.
 * The refusal names the ceiling and its reason, because "500 is too high" with
 * no explanation is the kind of message an operator works around rather than
 * understands.
 */
export function checkOperationalSettingBound(
  key: OperationalSettingKey,
  value: number,
  acknowledgeAboveRecommended = false
): string | null {
  const bound = OPERATIONAL_SETTING_BOUNDS[key];
  if (!Number.isInteger(value) || value < bound.min) {
    return `${key} must be an integer of at least ${String(bound.min)}`;
  }
  if (value > bound.absoluteMax) {
    return `${key} must not exceed ${String(bound.absoluteMax)}. ${bound.absoluteReason}`;
  }
  if (value > bound.recommendedMax && !acknowledgeAboveRecommended) {
    return `${key} above the recommended maximum of ${String(bound.recommendedMax)} requires acknowledgeAboveRecommended: true. ${bound.recommendedReason}`;
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
  // Clamped to the ABSOLUTE ceiling, never the recommended one: an env var is
  // an operator writing a value on purpose, which is the same intent the
  // request flag expresses.
  return Math.min(Math.max(floored, bound.min), bound.absoluteMax);
}

/**
 * Resolves one knob across the three rungs, reporting which one answered and
 * which ceiling applies.
 *
 * The stored value is clamped on the way OUT to the ABSOLUTE ceiling - never
 * to the recommended one. Clamping to the recommendation would silently undo a
 * value an operator explicitly acknowledged, which is the reported-versus-
 * enforced gap in its purest form: the settings page would show 5000 and the
 * sweep would run 2000.
 */
export function resolveOperationalSetting(
  key: OperationalSettingKey,
  stored: number | null,
  env: string | undefined
): ResolvedOperationalNumber {
  const bound = OPERATIONAL_SETTING_BOUNDS[key];

  const describe = (
    value: number,
    source: OperationalSettingSource
  ): ResolvedOperationalNumber => ({
    value,
    source,
    recommendedMax: bound.recommendedMax,
    recommendedReason: bound.recommendedReason,
    absoluteMax: bound.absoluteMax,
    absoluteReason: bound.absoluteReason,
    aboveRecommended: value > bound.recommendedMax,
  });

  if (stored !== null) {
    return describe(
      Math.min(Math.max(Math.floor(stored), bound.min), bound.absoluteMax),
      'setting'
    );
  }
  const fromEnv = readOperationalSettingEnv(key, env);
  if (fromEnv !== null) {
    return describe(fromEnv, 'env');
  }
  return describe(bound.default, 'default');
}

/**
 * Narrows a resolved page size to what a specific adapter can actually send.
 *
 * This is where a PLATFORM's own wall belongs, as opposed to the opinions in
 * `OPERATIONAL_SETTING_BOUNDS`: only the call site knows which adapter is
 * about to build the request. WooCommerce's REST layer caps `per_page` at 100
 * across every list endpoint, so a larger value is not a bigger page - it is a
 * 400, or a page of 100 the operator believes is bigger.
 *
 * Returns the clamped value and whether it moved, so the caller can LOG the
 * clamp. Silently narrowing would recreate exactly the defect this whole split
 * exists to prevent: a number the operator set, reported back to them intact,
 * and quietly not what was sent.
 */
export function clampToAdapterPageSize(
  requested: number,
  adapterMax: number
): { readonly value: number; readonly clamped: boolean } {
  if (requested <= adapterMax) {
    return { value: requested, clamped: false };
  }
  return { value: adapterMax, clamped: true };
}
