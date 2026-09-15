/**
 * Duplicate-positions remediation helpers (#3071 mockup parity)
 *
 * Pure functions shared by the group table (ranking, badges) and the
 * remediation modal (survivor pick, DELETE snippet) — kept in one place so
 * the table's "likely survivor" badge and the modal's generated SQL can
 * never disagree about which row is which.
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
 */
export function liveExposureQuantity(group: DuplicatePositionGroup): number {
  return group.rows.filter((row) => !row.isStale).reduce((sum, row) => sum + row.availableQuantity, 0);
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
  const survivor = group.rows.find((row) => !row.isStale) ?? group.rows[0] ?? null;
  if (survivor === null) {
    return { survivor: null, losers: [], sql: null };
  }
  const losers = group.rows.filter((row) => row.id !== survivor.id);
  const idList = losers.map((row) => `'${row.id}'`).join(', ');
  return {
    survivor,
    losers,
    sql: `DELETE FROM "inventory_items"\n WHERE "id" IN (${idList});`,
  };
}
