/**
 * Duplicate-positions remediation helpers (#3071 mockup parity)
 *
 * Pure functions shared by the group table (ranking, badges) and the
 * remediation modal (survivor pick, DELETE snippet). `buildRemediationDeleteSql`
 * COMPOSES `findSurvivorId` rather than re-picking the row itself — so the
 * table's "likely survivor" badge and the modal's generated SQL cannot
 * disagree about which row is which, because there is only one place the
 * pick is made (#3264 review: an earlier revision re-implemented the pick
 * inline here, which meant an edit to `findSurvivorId` would silently stop
 * reaching the generated `DELETE`).
 *
 * @module apps/web/src/features/inventory/lib
 */
import type { DuplicatePositionGroup, DuplicatePositionRow } from '../api/inventory.types';

/**
 * Sum of `availableQuantity` across a group's LIVE (non-stale) rows — the
 * quantity currently over-counted for this position, i.e. what an
 * availability read publishes when it can't tell only one row is real.
 * "Largest" for triage purposes means highest live-stock exposure, not row
 * count: a group with 5 stale rows and 0 live ones is cosmetic cleanup for
 * the #2325 gate, not an active oversell risk.
 *
 * NOTE: this sum is only evidence of an oversell when it aggregates TWO OR
 * MORE live rows (see `hasOversellRisk` below). With exactly one live row
 * this value equals that row's own `availableQuantity` — the correct,
 * undistorted figure, not an over-count — so callers deciding "is this
 * currently distorting available-to-promise" must gate on `hasOversellRisk`,
 * never on `exposure > 0` alone (#3264 review).
 */
export function liveExposureQuantity(group: DuplicatePositionGroup): number {
  return group.rows.filter((row) => !row.isStale).reduce((sum, row) => sum + row.availableQuantity, 0);
}

/**
 * Whether this position's live rows actually distort available-to-promise
 * today. Availability reads already exclude stale positions (#1478/#2345),
 * so with exactly one live row and any number of stale ones the sum across
 * live positions IS the survivor's own figure — there is no over-count and
 * nothing to reconcile, only cosmetic stale rows to delete before the
 * #2325 uniqueness index can build. Distortion requires summing at least
 * TWO live rows over the same position (#3264 review — the prior boundary
 * of `liveRowCount > 0` told an operator a perfectly healthy single-live-row
 * group was actively overselling).
 *
 * Derived from `group.rows` rather than the server's own `liveRowCount`
 * field so the table badge, this alert gate, and `liveExposureQuantity`'s
 * sum can never disagree about what counts as "live" — one source, not two
 * (#3264 review).
 */
export function hasOversellRisk(group: DuplicatePositionGroup): boolean {
  return group.rows.filter((row) => !row.isStale).length >= 2;
}

/**
 * `liveExposureQuantity`, gated by `hasOversellRisk` — `0` for a group that
 * is not actually at risk (zero or exactly one live row), where the raw sum
 * is either `0` or a single row's own correct, undistorted quantity, never
 * an over-count. This is what the "Live qty at risk" column and the
 * default group ranking must read: a naive sort on the raw sum ranks a
 * healthy single-live-row group with a large quantity ABOVE a genuinely
 * at-risk two-live-row group with a small one, in a table whose column is
 * literally named "at risk" (#3264 review — the same class of bug
 * `hasOversellRisk` fixed for the detail alert and the `Live rows` badge,
 * left over here).
 */
export function atRiskExposureQuantity(group: DuplicatePositionGroup): number {
  return hasOversellRisk(group) ? liveExposureQuantity(group) : 0;
}

/**
 * Default remediation rule (see the runbook): the newest LIVE row wins.
 * `rows` arrives newest-first (`DuplicatePositionRowResponseDto`'s own
 * documented order), so this is simply the first non-stale row; `null` when
 * every row in the group is stale — nothing survives automatically, see
 * the runbook's all-stale fallback.
 */
export function findSurvivorId(group: DuplicatePositionGroup): string | null {
  return group.rows.find((row) => !row.isStale)?.id ?? null;
}

/**
 * Rows that are NOT the survivor but still carry an open reservation —
 * deleting one of these orphans a live order's hold. The survivor rule
 * (newest live row) never looks at this, which is exactly why it needs its
 * own warning rather than being folded into the survivor pick.
 */
export function reservationRiskRows(
  group: DuplicatePositionGroup,
  survivorId: string | null
): DuplicatePositionRow[] {
  return group.rows.filter((row) => row.id !== survivorId && row.reservedQuantity > 0);
}

export interface RemediationDeletion {
  survivor: DuplicatePositionRow | null;
  losers: DuplicatePositionRow[];
  sql: string | null;
}

/**
 * The ready-to-review `DELETE` for a group's loser rows (everything but the
 * survivor). Deliberately keyed on primary key (`id IN (...)`) only — a
 * DELETE keyed on the position columns can't express "all but one" and would
 * empty the whole group. Nothing on the page ever executes this; it exists
 * to be copied and run by an operator after re-confirming the ids are still
 * current (per the runbook's own warning).
 */
export function buildRemediationDeleteSql(group: DuplicatePositionGroup): RemediationDeletion {
  // The all-stale fallback (`?? group.rows[0]`) is intentional and correct —
  // runbook step 2 says keep the newest when every row is stale — but it
  // must be the ONE place that fallback is spelled, hence composing
  // `findSurvivorId` rather than re-testing `!row.isStale` here.
  const survivorId = findSurvivorId(group) ?? group.rows[0]?.id ?? null;
  const survivor = survivorId === null ? null : (group.rows.find((row) => row.id === survivorId) ?? null);
  if (survivor === null) {
    return { survivor: null, losers: [], sql: null };
  }
  const losers = group.rows.filter((row) => row.id !== survivor.id);
  // `row.id` is never operator input — it's minted server-side by
  // `formatInternalId` (`ol_<prefix>_<hex>`), so no character here can
  // break out of the quoted literal. Interpolated rather than parameterised
  // because this string is never executed by anything in this app; it is
  // generated text an operator reviews and pastes into a database client.
  const idList = losers.map((row) => `'${row.id}'`).join(', ');
  return {
    survivor,
    losers,
    sql: `DELETE FROM "inventory_items"\n WHERE "id" IN (${idList});`,
  };
}
