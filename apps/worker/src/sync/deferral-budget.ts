/**
 * Deferral budget resolution
 *
 * The cumulative penalty-free deferral budget a job may spend (#2613), shared
 * by the runner (which enforces it) and the order sync handler (which tells
 * core how much is left, #3984), so the two can never read different numbers.
 *
 * @module apps/worker/src/sync
 */

export const MAX_DEFERRED_TOTAL_SECONDS_DEFAULT = 24 * 60 * 60;

/**
 * Parse `OL_JOB_MAX_DEFERRED_WAIT_SECONDS`. A non-numeric or non-positive value
 * is ignored rather than honoured - a zero budget would defeat deferral
 * entirely (the #2229 clamp posture). `invalid` lets the caller warn once.
 */
export function parseMaxDeferredTotalSeconds(raw: string | undefined | null): {
  seconds: number;
  invalid: boolean;
} {
  if (raw === undefined || raw === null || raw === '') {
    return { seconds: MAX_DEFERRED_TOTAL_SECONDS_DEFAULT, invalid: false };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return { seconds: MAX_DEFERRED_TOTAL_SECONDS_DEFAULT, invalid: true };
  }
  return { seconds: Math.round(parsed), invalid: false };
}
