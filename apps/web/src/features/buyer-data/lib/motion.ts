/**
 * Retention Motion (#4289)
 *
 * The pure timing rules behind the strip's choreography: how long each bar waits
 * to rise when the strip loads, and how long a bar waits to re-tint when a
 * cut-off moves across it (a wave that spreads out from the handle). The CSS
 * reads the results as `--i` / `--d`; nothing here touches the DOM.
 *
 * @module apps/web/src/features/buyer-data/lib
 */

/** Stagger between neighbouring bars when the strip loads. */
export const BAR_RISE_STEP_MS = 6;
/** Bars past this index share the last delay, so the whole rise ends in ~1 s. */
export const BAR_RISE_MAX_INDEX = 100;
/** Stagger per bar of distance from the handle that just moved. */
export const WAVE_STEP_MS = 15;
/** The wave stops spreading past this many bars; the rest follow together. */
export const WAVE_MAX_DISTANCE = 20;

/** Delay before bar `index` starts rising on load. */
export function barRiseDelayMs(index: number): number {
  return Math.min(Math.max(0, index), BAR_RISE_MAX_INDEX) * BAR_RISE_STEP_MS;
}

/** Delay before a bar `month` re-tints after a handle at `origin` moved; 0 with no origin. */
export function waveDelayMs(month: number, origin: number | null): number {
  if (origin === null) return 0;
  return Math.min(Math.abs(month - origin), WAVE_MAX_DISTANCE) * WAVE_STEP_MS;
}
