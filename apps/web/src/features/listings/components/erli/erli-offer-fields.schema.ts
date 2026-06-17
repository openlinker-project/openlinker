/**
 * Erli shared offer-field schema + helpers
 *
 * The single source of truth for the Erli-specific offer-creation fields
 * (dispatch time) shared by BOTH surfaces — `ErliCreateOfferWizard` (single)
 * and `ErliBulkConfigSection` (bulk). Extracting the Zod slice + the
 * config-parse / wire-mapping helpers here prevents the two surfaces from
 * drifting (#1096).
 *
 * Erli's `POST /products/{externalId}` requires `dispatchTime` ({ period,
 * unit }); the FE sends it on `overrides.platformParams.dispatchTime`, which
 * the BE adapter reads, falling back to `connection.config.defaultDispatchTime`
 * when absent. `connection.config` reaches the FE as an untyped
 * `Record<string, unknown>`, so we parse the default with Zod before trusting
 * it (never assume the shape).
 *
 * @module features/listings/components/erli
 */
import { z } from 'zod';

import type { Connection } from '../../../connections';

/** Erli dispatch (handling) time units — mirrors the BE `ErliDispatchTimeUnit`. */
export const ErliDispatchUnitValues = ['hour', 'day', 'month'] as const;
export type ErliDispatchUnit = (typeof ErliDispatchUnitValues)[number];

/** The shape the BE reads off `overrides.platformParams.dispatchTime`. */
export interface ErliDispatchTimeParam {
  period: number;
  unit: ErliDispatchUnit;
}

/**
 * Form slice both Erli surfaces collect. `period` is a string in form state
 * (the dial writes the chosen number as a string) and coerced on submit.
 */
export const erliOfferFieldsSchema = z.object({
  dispatchPeriod: z
    .number({ message: 'Dispatch period is required' })
    .int('Dispatch period must be a whole number')
    .min(0, 'Dispatch period must be 0 or greater'),
  dispatchUnit: z.enum(ErliDispatchUnitValues),
});

export type ErliOfferFieldsValues = z.infer<typeof erliOfferFieldsSchema>;

/**
 * Unit-dependent upper bounds Erli enforces (hour ≤ 24, month ≤ 12, day
 * unbounded). Surfaced as a soft client-side guard so the operator gets
 * immediate feedback before the BE rejects an out-of-range value.
 */
const UNIT_MAX_PERIOD: Record<ErliDispatchUnit, number | null> = {
  hour: 24,
  day: null,
  month: 12,
};

/** Curated period quick-picks shown as segmented buttons (mockup parity). */
export const ERLI_DISPATCH_PERIOD_PRESETS: readonly number[] = [0, 1, 2, 3, 5];

export const ERLI_DEFAULT_DISPATCH: ErliDispatchTimeParam = { period: 2, unit: 'day' };

/** True when `period` is a valid non-negative int within the unit's bound. */
export function isValidDispatch(value: unknown): value is ErliDispatchTimeParam {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { period?: unknown; unit?: unknown };
  if (
    typeof candidate.period !== 'number' ||
    !Number.isInteger(candidate.period) ||
    candidate.period < 0
  ) {
    return false;
  }
  const unit = candidate.unit;
  if (unit !== undefined && !ErliDispatchUnitValues.includes(unit as ErliDispatchUnit)) {
    return false;
  }
  const resolvedUnit = (unit as ErliDispatchUnit | undefined) ?? 'day';
  const max = UNIT_MAX_PERIOD[resolvedUnit];
  return max === null || candidate.period <= max;
}

/**
 * Schema for the (untrusted) `connection.config` blob, narrowed to the only
 * key the offer UI reads. `.passthrough()` keeps unknown keys (callbackBaseUrl,
 * baseUrl) without failing.
 */
const erliConfigSchema = z
  .object({
    defaultDispatchTime: z
      .object({
        period: z.number().int().min(0),
        unit: z.enum(ErliDispatchUnitValues).optional(),
      })
      .optional(),
  })
  .passthrough();

/**
 * Parse `connection.config.defaultDispatchTime` defensively. Returns the
 * shop-wide default when present + valid, else `ERLI_DEFAULT_DISPATCH`.
 */
export function parseErliConnectionDispatchDefault(
  config: Connection['config'],
): ErliDispatchTimeParam {
  const parsed = erliConfigSchema.safeParse(config);
  const raw = parsed.success ? parsed.data.defaultDispatchTime : undefined;
  if (raw && isValidDispatch(raw)) {
    return { period: raw.period, unit: raw.unit ?? 'day' };
  }
  return ERLI_DEFAULT_DISPATCH;
}

/** Map collected form values to the BE wire param. */
export function toDispatchTimeParam(values: ErliOfferFieldsValues): ErliDispatchTimeParam {
  return { period: values.dispatchPeriod, unit: values.dispatchUnit };
}

/** Human-readable summary used in review/aside copy ("2 working days"). */
export function formatDispatch(value: ErliDispatchTimeParam): string {
  const unitLabel =
    value.unit === 'hour'
      ? value.period === 1
        ? 'hour'
        : 'hours'
      : value.unit === 'month'
        ? value.period === 1
          ? 'month'
          : 'months'
        : value.period === 1
          ? 'working day'
          : 'working days';
  return `${value.period} ${unitLabel}`;
}
