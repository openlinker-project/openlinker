/**
 * Connection config merge (#3457)
 *
 * `PATCH /connections/:id` REPLACES `config` wholesale, so every wizard write
 * sends the freshly-read config back with exactly one key changed. Writing a
 * partial object would silently delete every other key on the connection:
 * its base URL, its rate limit, its stock buffer.
 *
 * Also owns the two key readers the wizard needs, so the rule for what a
 * stored value means lives in one place.
 *
 * @module features/oms-onboarding/lib
 */

export const STOCK_LOCATION_OVERRIDE_KEY = 'stockLocationOverride';
export const SOURCING_CLAIM_KEY = 'sourcingAuthority';
/** A3 "who picks and ships": read by the authority resolver, see `withPackingClaimsEnabled`. */
export const EXECUTOR_CLAIM_KEY = 'fulfillmentExecutor';

/** A new config with `key` set to `value`; every other key is untouched. */
export function withConfigKey(
  config: Record<string, unknown> | null | undefined,
  key: string,
  value: unknown
): Record<string, unknown> {
  return { ...(config ?? {}), [key]: value };
}

/** The connection's stock-location override, or `null` when unset. */
export function readStockLocationOverride(config: Record<string, unknown> | null | undefined): string | null {
  const value = config?.[STOCK_LOCATION_OVERRIDE_KEY];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * The sourcing claim as a writable object, preserving whatever else it
 * carries (`isPrimary`, `scopes`). The backend accepts `true`, `'true'` or an
 * object; the wizard always writes the object form so a stop keeps the
 * operator's scopes for the restart.
 */
export function withSourcingClaimEnabled(
  config: Record<string, unknown> | null | undefined,
  enabled: boolean
): Record<string, unknown> {
  return withClaimEnabled(config, SOURCING_CLAIM_KEY, enabled);
}

/**
 * Turning packing on or off moves BOTH authorities OpenLinker holds as the
 * OMS: where an order ships from (`sourcingAuthority`, A2) and who picks and
 * ships it (`fulfillmentExecutor`, A3). Writing only the first left "Who
 * decides what" reading "Wherever the order lands today" for the second while
 * packing was plainly on.
 */
export function withPackingClaimsEnabled(
  config: Record<string, unknown> | null | undefined,
  enabled: boolean
): Record<string, unknown> {
  return withClaimEnabled(
    withClaimEnabled(config, SOURCING_CLAIM_KEY, enabled),
    EXECUTOR_CLAIM_KEY,
    enabled
  );
}

function withClaimEnabled(
  config: Record<string, unknown> | null | undefined,
  key: string,
  enabled: boolean
): Record<string, unknown> {
  const existing = config?.[key];
  const base =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return withConfigKey(config, key, { ...base, enabled });
}

/**
 * Display-only reading of the sourcing claim, for when the server's own
 * who-decides answer is unavailable. `'unset'` (no key at all) and `'off'`
 * (the key exists, switched off by a stop) are kept apart: the first means
 * packing was never set up, the second that it was and is paused.
 */
export function readSourcingClaim(
  config: Record<string, unknown> | null | undefined
): 'unset' | 'on' | 'off' {
  if (config === null || config === undefined || !(SOURCING_CLAIM_KEY in config)) return 'unset';
  const value = config[SOURCING_CLAIM_KEY];
  if (value === true || value === 'true') return 'on';
  if (typeof value === 'object' && value !== null && (value as { enabled?: unknown }).enabled === true) {
    return 'on';
  }
  return 'off';
}

/** Buying a label when a parcel is accepted (#3340), read by the worker from the OMS connection. */
export const AUTO_DISPATCH_KEY = 'autoDispatch';

/**
 * `config.autoDispatch` as the wizard reads and writes it. Wire units: grams
 * and millimetres.
 */
export interface AutoDispatchSettings {
  readonly enabled: boolean;
  readonly parcelTemplate?: string;
  /** Per product, used only when a product carries no weight of its own. */
  readonly defaultWeightGrams?: number;
  readonly lengthMm?: number;
  readonly widthMm?: number;
  readonly heightMm?: number;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The saved auto-dispatch settings, or `null` when the key is absent or not an
 * object (nothing was ever chosen).
 *
 * Coerces field by field the way the worker's `readAutoDispatchConfig` does,
 * so the page never shows a setting the worker would not act on: `enabled` is
 * on only when it is exactly `true`, a blank size is no size, and the box
 * counts only as a full set. Unlike the worker this keeps the fields of a
 * switched-off setting, because a stop keeps the parcel defaults for the
 * restart and the step prefills from them.
 */
export function readAutoDispatch(config: Record<string, unknown> | null | undefined): AutoDispatchSettings | null {
  const raw = config?.[AUTO_DISPATCH_KEY];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;

  const parcelTemplate =
    typeof candidate.parcelTemplate === 'string' && candidate.parcelTemplate.trim().length > 0
      ? candidate.parcelTemplate
      : undefined;
  const weight = positiveNumber(candidate.defaultWeightGrams);
  const lengthMm = positiveNumber(candidate.lengthMm);
  const widthMm = positiveNumber(candidate.widthMm);
  const heightMm = positiveNumber(candidate.heightMm);
  const box =
    lengthMm !== undefined && widthMm !== undefined && heightMm !== undefined
      ? { lengthMm, widthMm, heightMm }
      : {};

  return {
    enabled: candidate.enabled === true,
    ...(parcelTemplate === undefined ? {} : { parcelTemplate }),
    ...(weight === undefined ? {} : { defaultWeightGrams: Math.floor(weight) }),
    ...box,
  };
}

/**
 * A new config with `autoDispatch` replaced by `value`; every other key is
 * untouched. Absent fields are omitted rather than written as `null`, because
 * the server refuses a `null` where it expects a number. A partial box is
 * dropped: the server refuses one, and the worker would ignore it.
 */
export function withAutoDispatch(
  config: Record<string, unknown> | null | undefined,
  value: AutoDispatchSettings
): Record<string, unknown> {
  const parcelTemplate = value.parcelTemplate?.trim();
  const weight = positiveNumber(value.defaultWeightGrams);
  const lengthMm = positiveNumber(value.lengthMm);
  const widthMm = positiveNumber(value.widthMm);
  const heightMm = positiveNumber(value.heightMm);
  const box =
    lengthMm !== undefined && widthMm !== undefined && heightMm !== undefined
      ? { lengthMm, widthMm, heightMm }
      : {};

  return withConfigKey(config, AUTO_DISPATCH_KEY, {
    enabled: value.enabled,
    ...(parcelTemplate === undefined || parcelTemplate === '' ? {} : { parcelTemplate }),
    ...(weight === undefined ? {} : { defaultWeightGrams: weight }),
    ...box,
  });
}
