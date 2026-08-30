/**
 * Resolve Value Limits
 *
 * One place that answers "what range may this control offer, and what does
 * the API say about its ceilings" — and the only place that copes with the
 * API not saying.
 *
 * The two ceilings mean different things and the page must not conflate them.
 * `recommendedMax` is OpenLinker's judgement, advisory, exceedable when the
 * operator says so explicitly. `absoluteMax` is refused whatever the request
 * carries. The control's range therefore runs to `absoluteMax`: stopping the
 * slider at the recommendation would make the raised ceiling unreachable,
 * which is the one thing the two-ceiling shape exists to allow.
 *
 * Resolution order per field is per-value → `bounds[key]` → a conservative
 * local fallback. The last rung exists because this page is rendered against
 * a live API by an operator, and a response missing a block must produce a
 * usable control rather than a thrown render or a slider with `max={NaN}`.
 * When it fires, `complete` is false and `recommendedReason` is `null` — the
 * page then says nothing about the recommendation rather than inventing a
 * sentence, because copy written here would drift from the API the day the
 * reason changes.
 *
 * @module apps/web/src/features/settings/lib
 */
import type {
  OperationalSettingBound,
  OperationalSettingKey,
  OperationalSettingsView,
  ResolvedNumberSetting,
} from '../api/operational-settings.types';

export interface ValueLimits {
  readonly min: number;
  /** Advisory ceiling. `null` when the API reported none. */
  readonly recommendedMax: number | null;
  /** The API's own words for why. `null` when it reported none. */
  readonly recommendedReason: string | null;
  /** The refusal line, and the slider's range end. */
  readonly absoluteMax: number;
  readonly absoluteReason: string | null;
  /**
   * False when any ceiling had to be invented locally. The page uses it to
   * stay quiet about a recommendation it cannot quote.
   */
  readonly complete: boolean;
}

/**
 * Used only when the API reported no ceiling at all. Deliberately generous on
 * the absolute end and silent on the recommendation: a too-tight fallback
 * would refuse a value the API accepts, which is the failure that looks like
 * a broken page rather than a degraded one.
 */
const FALLBACK_ABSOLUTE_MAX = 20_000;
const FALLBACK_MIN = 1;

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function resolveValueLimits(
  resolved: ResolvedNumberSetting | undefined,
  bound: OperationalSettingBound | undefined
): ValueLimits {
  const recommendedMax =
    positiveInteger(resolved?.recommendedMax) ?? positiveInteger(bound?.recommendedMax);
  const absoluteMax =
    positiveInteger(resolved?.absoluteMax) ?? positiveInteger(bound?.absoluteMax);
  const min = positiveInteger(bound?.min) ?? FALLBACK_MIN;

  // The slider must still reach a value already in force, even if that value
  // came from an env var set above every ceiling the API reported.
  const currentValue = positiveInteger(resolved?.value) ?? min;
  const effectiveAbsolute = Math.max(absoluteMax ?? FALLBACK_ABSOLUTE_MAX, currentValue);

  return {
    min: Math.min(min, currentValue),
    recommendedMax,
    recommendedReason:
      nonEmptyString(resolved?.recommendedReason) ?? nonEmptyString(bound?.recommendedReason),
    absoluteMax: effectiveAbsolute,
    absoluteReason:
      nonEmptyString(resolved?.absoluteReason) ?? nonEmptyString(bound?.absoluteReason),
    complete: recommendedMax !== null && absoluteMax !== null,
  };
}

export function limitsFor(
  view: OperationalSettingsView,
  key: OperationalSettingKey
): ValueLimits {
  return resolveValueLimits(view[key], view.bounds?.[key]);
}

/**
 * Whether a value crosses OpenLinker's advice.
 *
 * `false` when no recommendation was reported — an unknown ceiling must not
 * be treated as a crossed one, which would gate a save behind an
 * acknowledgement the page cannot explain.
 */
export function isAboveRecommended(value: number, limits: ValueLimits): boolean {
  return limits.recommendedMax !== null && value > limits.recommendedMax;
}
