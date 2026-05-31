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

/** Largest-unit magnitude of a non-negative duration: "2d" / "5h" / "12m". */
function humanizeDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours >= 1) return `${hours}h`;
  return `${totalMinutes}m`;
}

/**
 * Format the ship-by deadline relative to `now`. `dueAtIso` null/invalid → null.
 */
export function formatShipBy(dueAtIso: string | null, now: Date = new Date()): ShipByView | null {
  if (!dueAtIso) return null;
  const dueMs = new Date(dueAtIso).getTime();
  if (Number.isNaN(dueMs)) return null;

  const diff = dueMs - now.getTime();
  if (diff <= 0) {
    return {
      level: 'overdue',
      remaining: diff === 0 ? 'due now' : `Overdue ${humanizeDuration(-diff)}`,
    };
  }
  return {
    level: diff <= SOON_THRESHOLD_MS ? 'soon' : 'ok',
    remaining: `${humanizeDuration(diff)} left`,
  };
}
