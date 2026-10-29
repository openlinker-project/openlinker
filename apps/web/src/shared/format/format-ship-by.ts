/**
 * Ship-by (dispatch SLA) formatting (#927)
 *
 * Pure, deterministic countdown for the marketplace dispatch deadline. Returns
 * a neutral urgency `level` (the page maps it to a StatusBadge tone, so this
 * stays free of any `shared/ui` dependency) plus a short `remaining` phrase.
 * Returns `null` when there is no (or an unparseable) deadline — callers render
 * nothing, never a false countdown.
 *
 * @module shared/format
 */
import { getLocale } from '../i18n/active-locale';
import { resolveCopy } from '../i18n/define-copy';
import { interpolate } from '../i18n/interpolate';
import type { SupportedLocale } from '../i18n/i18n.types';
import { formatCopy } from './format.copy';

/** Urgency buckets for the ship-by deadline. `soon` is the warning threshold. */
export const ShipByLevelValues = ['ok', 'soon', 'overdue'] as const;
export type ShipByLevel = (typeof ShipByLevelValues)[number];

export interface ShipByView {
  level: ShipByLevel;
  /** Short phrase: e.g. "1d left", "3h left", "Overdue 4h", "due now". */
  remaining: string;
}

/** Hours within which the deadline is considered "breaching soon" (warning). */
const SOON_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;

/** Largest-unit magnitude of a non-negative duration: "2d" / "5h" / "12m". */
function humanizeDuration(ms: number, locale: SupportedLocale): string {
  const units = resolveCopy(formatCopy, locale).compactDuration;
  const totalMinutes = Math.floor(ms / MINUTE_MS);
  const days = Math.floor(totalMinutes / (60 * 24));
  if (days >= 1) return interpolate(units.days, { n: days });
  const hours = Math.floor(totalMinutes / 60);
  if (hours >= 1) return interpolate(units.hours, { n: hours });
  return interpolate(units.minutes, { n: totalMinutes });
}

/**
 * Format the ship-by deadline relative to `now`. `dueAtIso` null/invalid → null.
 */
export function formatShipBy(
  dueAtIso: string | null,
  now: Date = new Date(),
  locale: SupportedLocale = getLocale(),
): ShipByView | null {
  if (!dueAtIso) return null;
  const dueMs = new Date(dueAtIso).getTime();
  if (Number.isNaN(dueMs)) return null;

  const copy = resolveCopy(formatCopy, locale).shipBy;
  const diff = dueMs - now.getTime();
  if (diff <= 0) {
    return {
      level: 'overdue',
      remaining:
        diff > -MINUTE_MS
          ? copy.dueNow
          : interpolate(copy.overdue, { duration: humanizeDuration(-diff, locale) }),
    };
  }
  return {
    level: diff <= SOON_THRESHOLD_MS ? 'soon' : 'ok',
    // Under a minute the countdown would read "0m left"; the deadline is here.
    remaining:
      diff < MINUTE_MS
        ? copy.dueNow
        : interpolate(copy.left, { duration: humanizeDuration(diff, locale) }),
  };
}
