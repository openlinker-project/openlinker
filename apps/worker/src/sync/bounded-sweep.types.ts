/**
 * Bounded Sweep Types (#2218 / #2219, ADR-048 decisions 4-6)
 *
 * The contract of `runBoundedSweep` — the shared shape behind the two master
 * `syncAll` handlers. It lives in its own file because two handlers consume it,
 * which makes it a contract rather than a handler-local convenience
 * (`docs/engineering-standards.md` § Type Definitions in Separate Files).
 *
 * @module apps/worker/src/sync
 * @see {@link runBoundedSweep} for the orchestration itself
 */

/** Where a cycle stopped, and which cycle it belongs to. */
export interface SweepCursor {
  /**
   * Identifies one full pass over the source, minted when a fresh cycle starts
   * and carried across every resuming tick of that cycle.
   *
   * It exists because the child idempotency key used to end in the OUTER JOB's
   * id, and a resuming tick is a different job — so an overlapping page would
   * re-enqueue the same child under a fresh key. Keying on the cycle dedupes
   * within a cycle while still letting the next cycle re-sync. A job id is not
   * a run identity (#2039's `reconcileId` lesson).
   */
  cycleId: string;
  /** How many source items this cycle has already consumed. */
  offset: number;
}

/** One page of source items, plus whether the source has more to give. */
export interface SweepPage {
  /** The items to enqueue, already in source order. */
  items: readonly string[];
  /**
   * How far to advance the cursor if every item enqueues successfully. Distinct
   * from `items.length` because a caller may filter items out of a page after
   * reading it (the inventory sweep drops synthetic `product:` ids) — the cursor
   * counts what was READ, not what was kept.
   */
  consumed: number;
  /** True when the source returned everything it has; ends the cycle. */
  exhausted: boolean;
}

export interface BoundedSweepInput {
  /** Resume point, or `null` to start a fresh cycle. */
  cursor: SweepCursor | null;
  /** Maximum children this run may enqueue. Already floored and clamped. */
  budget: number;
  /** Reads up to `budget` items starting at `offset`. */
  readPage: (offset: number, budget: number) => Promise<SweepPage>;
  /** Enqueues one child. Rejects on failure; the sweep stops the cursor there. */
  enqueue: (externalId: string, cycleId: string) => Promise<unknown>;
  /** Mints a fresh cycle id. Injected so specs are deterministic. */
  newCycleId: () => string;
}

export interface BoundedSweepResult {
  cycleId: string;
  /** Children successfully enqueued this run. */
  enqueued: number;
  /** Enqueues that rejected this run. */
  failed: number;
  /** Cursor for the next tick, or `null` when the cycle completed. */
  nextCursor: SweepCursor | null;
  /** True when the source was exhausted AND nothing failed. */
  completed: boolean;
}
