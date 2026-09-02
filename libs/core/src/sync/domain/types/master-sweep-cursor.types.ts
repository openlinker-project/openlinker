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
 * key for a kind. Adding a kind means auditing all THREE builders in the same
 * commit (the third, `masterSweepRemainingCountCursorKey`, arrived with #2317).
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
 *
 * `inventory-provenance` (#2317, ADR-058 ladder step (ii)) is the odd member,
 * and the deviation is worth stating: it owns a lock namespace and BOTH the
 * completion and remaining-count keys, but it never persists a
 * {@link masterSweepCursorKey} value. Its work is selected by the predicate
 * `sourceConnectionId IS NULL`, which each page CONSUMES, so remaining work is
 * re-derived from the table rather than tracked at an offset — an advancing
 * offset over a shrinking set would step over unstamped rows. The builder still
 * works for the kind; nothing calls it. It is a member of this union rather
 * than a worker-local key vocabulary so that one file remains the single source
 * of every `connection_cursors` sweep key, reader and writer alike.
 */
export const MasterSweepKindValues = [
  'product',
  'inventory',
  'product-delta',
  'product-reconcile',
  'inventory-provenance',
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
 * segment.
 *
 * TWO writers today, not one: the `product-reconcile` handler (#2258) and the
 * `inventory-provenance` backfill handler (#2317), the latter latching on
 * `remainingNull === 0` rather than on a page boundary. Other kinds may adopt
 * it without any contract change.
 */
export function masterSweepCompletedAtCursorKey(
  kind: MasterSweepKind,
  connectionId: string
): string {
  return `master.${kind}.completedAt:connection:${connectionId}`;
}

/**
 * `master.{kind}.remainingNull:connection:{connectionId}` — how many rows the
 * sweep's own predicate still matched at the end of its most recent run
 * (#2317).
 *
 * Written today only by the `inventory-provenance` backfill, where it is the
 * operator-facing readiness artefact for #2325's `SET NOT NULL`: the completion
 * stamp says a run concluded, this says what it concluded ABOUT. A `'0'` here
 * alongside a completion stamp is the un-gate signal.
 *
 * Honest about its own staleness: it is a count taken at a moment, and a caller
 * with no connection axis can insert a fresh NULL-provenance row immediately
 * afterwards. #2325 re-counts before it acts; this value is a signal to look,
 * never a permission to skip looking.
 */
export function masterSweepRemainingCountCursorKey(
  kind: MasterSweepKind,
  connectionId: string
): string {
  return `master.${kind}.remainingNull:connection:${connectionId}`;
}
