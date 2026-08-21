/**
 * Master Sweep Cursor Keys
 *
 * The `connection_cursors` key vocabulary shared by the master sweeps
 * (#2218/#2219/#2220/#2222, ADR-048) and their read side (#2258). The
 * WRITERS live in the worker (`apps/worker/src/sync/bounded-sweep.ts` and the
 * sweep handlers); the READER is the catalog-trust context, which must build
 * the same keys and cannot import from an app — so the key builders live here,
 * as the single source of truth, and the worker re-exports them.
 *
 * Pure-rule exception (`docs/engineering-standards.md`): these functions ARE
 * the rule for the `MasterSweepKind` union they sit with — deriving the cursor
 * key for a kind. Adding a kind means auditing both builders in the same
 * commit.
 *
 * The formats are pinned by unit spec AND independently hard-coded in the
 * worker handler/e2e specs (`master-product-reconcile.handler.spec.ts`,
 * `master-product-reconcile-e2e.int-spec.ts`), so drift fails two suites.
 *
 * @module domain/types
 */

/**
 * The sweep families that own a lock + cursor namespace.
 *
 * `product-reconcile` (#2222) is the deletion pass; `product-delta` (#2220)
 * the opt-in incremental pass. Each is a distinct kind so it takes its own
 * lock and cursor — see `apps/worker/src/sync/bounded-sweep.ts` for the
 * starvation rationale.
 */
export const MasterSweepKindValues = [
  'product',
  'inventory',
  'product-delta',
  'product-reconcile',
] as const;
export type MasterSweepKind = (typeof MasterSweepKindValues)[number];

/**
 * `master.{kind}.sweep:connection:{connectionId}` — the resumable sweep
 * cursor (composite `{cycleId}:{offset}` value; cleared to `''` when a cycle
 * completes). A present, non-empty value means a cycle is OPEN — started and
 * not yet completed. It does NOT mean the sweep is actively running: the
 * failure branch retains the cursor across backoff, and the value survives
 * the scheduler task being disabled.
 */
export function masterSweepCursorKey(kind: MasterSweepKind, connectionId: string): string {
  return `master.${kind}.sweep:connection:${connectionId}`;
}

/**
 * `master.{kind}.completedAt:connection:{connectionId}` — ISO-8601 timestamp
 * of the most recent COMPLETED cycle (#2258). Deliberately a separate key
 * from the sweep cursor: the cursor is unconditionally cleared to `''` on
 * every run's completion branch, and its composite format rejects a third
 * segment. Written today only by the `product-reconcile` handler; other
 * kinds may adopt it without any contract change.
 */
export function masterSweepCompletedAtCursorKey(
  kind: MasterSweepKind,
  connectionId: string
): string {
  return `master.${kind}.completedAt:connection:${connectionId}`;
}
