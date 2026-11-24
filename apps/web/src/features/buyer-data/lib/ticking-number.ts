/**
 * Ticking number (#4289)
 *
 * The pure half of the count-up shown when a plan figure changes: an ease-out
 * curve and the whole-number value on it. The element that drives it over time
 * lives in `components/ticking-number.tsx`.
 *
 * @module apps/web/src/features/buyer-data/lib
 */

/** How long a figure takes to settle on its new value. */
export const TICK_DURATION_MS = 220;

/** Fast start, soft landing; clamped so a stray progress never overshoots. */
export function easeOutCubic(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return 1 - (1 - t) ** 3;
}

/** The whole number a figure moving from `from` to `to` shows at `progress` (0..1). */
export function tickValue(from: number, to: number, progress: number): number {
  if (progress >= 1) return to;
  return Math.round(from + (to - from) * easeOutCubic(progress));
}
