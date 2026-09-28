/**
 * Unassigned-age formatting for the Assign Packing Work board (#3424)
 *
 * Two surfaces say the same number: the "Sat unassigned 52m" badge on a
 * pooled task, and the "Oldest unassigned" metric above the board. Both are
 * built on ONE function that owns the rounding rule — `formatCompactDuration`
 * — because two copies of that rule is the defect to avoid (they will drift
 * the first time either is edited, and a supervisor comparing the badge to
 * the metric would then be comparing two different clocks).
 *
 * ## `null` in, `null` out — never a fabricated "0m"
 *
 * `unassignedSince` is `null` in two situations that must both render
 * nothing: an assigned task ("right now" — there is no wait to show), and an
 * unassigned task whose row predates the column (an UNKNOWN age, not a zero
 * one — see `fulfillment.schema.ts`). Neither caller here treats a `null` or
 * unparseable instant as "just now"; both simply have nothing to show.
 *
 * @module apps/web/src/features/fulfillment/lib
 */

/**
 * The one rounding rule, floored to the largest whole unit:
 * `< 60m -> "52m"`, `< 24h -> "3h"`, otherwise `"2d"`.
 *
 * A negative or non-finite input (a clock skew, an instant in the future)
 * clamps to zero rather than throwing or printing a negative number —
 * this is a display helper, not a validator.
 */
export function formatCompactDuration(elapsedMs: number): string {
  const safeMs = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const totalMinutes = Math.floor(safeMs / 60_000);
  if (totalMinutes < 60) {
    return `${String(totalMinutes)}m`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    return `${String(totalHours)}h`;
  }
  const totalDays = Math.floor(totalHours / 24);
  return `${String(totalDays)}d`;
}

/**
 * An ISO instant -> compact elapsed age, or `null` for an absent or
 * unparseable instant. The badge's own null-handling: it renders only when
 * this returns non-null.
 */
export function formatUnassignedAge(
  sinceIso: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (sinceIso === null || sinceIso === undefined) {
    return null;
  }
  const sinceMs = new Date(sinceIso).getTime();
  if (Number.isNaN(sinceMs)) {
    return null;
  }
  return formatCompactDuration(now.getTime() - sinceMs);
}

/**
 * The oldest `unassignedSince` among the tasks currently in the pool
 * (`assignedToUserId === null`) — the raw ISO instant the "Oldest
 * unassigned" metric formats with `formatUnassignedAge`.
 *
 * `null` when there is no pooled task, or every pooled task's age is
 * unknown (it predates the column) — the metric renders a placeholder for
 * either, never a fabricated "0m".
 */
export function oldestUnassignedSince(
  tasks: readonly { assignedToUserId: string | null; unassignedSince?: string | null }[]
): string | null {
  let oldest: string | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;

  for (const task of tasks) {
    if (task.assignedToUserId !== null) {
      continue;
    }
    const since = task.unassignedSince ?? null;
    if (since === null) {
      continue;
    }
    const sinceMs = new Date(since).getTime();
    if (Number.isNaN(sinceMs)) {
      continue;
    }
    if (sinceMs < oldestMs) {
      oldestMs = sinceMs;
      oldest = since;
    }
  }

  return oldest;
}
