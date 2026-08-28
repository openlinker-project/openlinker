/**
 * Bounded Sweep (#2218 / #2219, ADR-048 decisions 4-6)
 *
 * The shared shape behind `master.product.syncAll` and `master.inventory.syncAll`:
 * enqueue at most `budget` children per run, record where the run stopped, and
 * let the next cron tick resume. ADR-048 decision 4 requires copying an existing
 * pattern rather than inventing a second one; the pattern here is the
 * scan-offset family (`IOfferStatusSyncService` / `IShopStatusSyncService` —
 * `{ limit, offset }` in, `nextOffset` out, handler persists the cursor), NOT
 * taxonomy's frontier-as-query, which re-derives remaining work from a predicate
 * the master sweeps do not have.
 *
 * This function performs no I/O of its own — it composes the caller's `readPage`
 * and `enqueue` — so both handlers share one implementation that is unit-testable
 * without a cursor, lock, or queue double.
 *
 * @module apps/worker/src/sync
 * @see {@link BoundedSweepInput} for the contract
 */

import type { MasterSweepKind } from '@openlinker/core/sync';
import type {
  BoundedSweepInput,
  BoundedSweepResult,
  SweepCursor,
  SweepPage,
} from './bounded-sweep.types';

/**
 * Children enqueued per run.
 *
 * Derived from drain rate, NOT copied from taxonomy's 500 (whose unit of work is
 * a local category upsert). One unit here is a child job performing a full
 * per-product platform sync — ~2-5 s each — against a runner whose execution
 * concurrency is 1. The arithmetic that matters is
 * `budget x per-child-duration < tick interval`: the inventory tick is 900 s, so
 * 180 children at the pessimistic 5 s exactly saturates it and leaves nothing for
 * the buyer-facing work sharing that single slot. 100 lands at ~55% of the
 * shorter tick, and coincides with the `DEFAULT_LIMIT` the eight other sweep
 * handlers use for comparable per-item platform work.
 *
 * This bounds the fan-out. It does not make the catalog fast — a large connection
 * takes many ticks per full cycle by design. Contention between that work and a
 * buyer's order is ADR-050's subject (#2167), not this one's.
 */
export const SWEEP_BUDGET_DEFAULT = 100;
/** Ceiling regardless of payload, matching the shipped clamp idiom. */
export const SWEEP_BUDGET_MAX = 500;

/** How many enqueues are issued concurrently within one run. */
const ENQUEUE_CHUNK_SIZE = 25;

const CURSOR_SEPARATOR = ':';

/**
 * Lock TTL, covering ONE BUDGETED RUN — never one cycle, which spans many ticks
 * and must not hold a lock between them.
 *
 * Expiry is an efficiency and honesty measure, not a correctness dependency
 * (`taxonomy-sync-lock.ts:20-44` states the same): a lost lock degrades to two
 * overlapping runs, which `cycleId`-keyed child idempotency already makes safe.
 */
const SWEEP_LOCK_TTL_DEFAULT_MS = 300_000;
const SWEEP_LOCK_TTL_MIN_MS = 60_000;
const SWEEP_LOCK_TTL_MAX_MS = 1_800_000;

export function resolveSweepLockTtlMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return SWEEP_LOCK_TTL_DEFAULT_MS;
  }
  return Math.min(Math.max(parsed, SWEEP_LOCK_TTL_MIN_MS), SWEEP_LOCK_TTL_MAX_MS);
}

/**
 * The sweep families that own a lock + cursor namespace.
 *
 * `product-reconcile` (#2222) is the deletion pass: it enumerates OL's own
 * mappings rather than the master, so it is a fourth kind for the same reason
 * `product-delta` is a third — its own lock, so the full sweep cannot starve it.
 *
 * `product-delta` (#2220) is deliberately a THIRD kind rather than a mode of
 * `product`: the incremental pass takes its own lock so it can run concurrently
 * with the full pass. Sharing `product`'s lock would let the 20-minute full sweep —
 * which is mid-cycle more or less permanently on a large catalog — starve the delta
 * pass indefinitely while it logged "already in progress" and returned ok.
 *
 * The kind union and the CURSOR key builders moved to `@openlinker/core/sync`
 * (#2258) so the catalog-trust read side builds the same keys from one source;
 * they are re-exported here under their original names so the handlers and
 * specs stay untouched. The LOCK key stays worker-local — nothing outside the
 * worker takes a sweep lock.
 */
export type { MasterSweepKind as SweepKind } from '@openlinker/core/sync';
export {
  masterSweepCursorKey as sweepCursorKey,
  masterSweepCompletedAtCursorKey as sweepCompletedAtCursorKey,
} from '@openlinker/core/sync';

/** `master:{kind}:sweep:{connectionId}` — one in-flight run per connection. */
export function sweepLockKey(kind: MasterSweepKind, connectionId: string): string {
  return `master:${kind}:sweep:${connectionId}`;
}

/**
 * Collects up to `budget` external ids by paging a master's own enumeration.
 *
 * Shared by BOTH master-product sweeps — the full pass and the #2220 delta pass —
 * which differ only in which lister method they close over. Two invariants live
 * here rather than in each caller, because they are what the sweep's cursor
 * arithmetic depends on:
 *
 * - **The budget truncates at a PAGE boundary.** Pages are fetched while the
 *   collected count is below budget, so a non-multiple budget overshoots to the
 *   end of the page in flight rather than splitting it. The overshoot is bounded
 *   by one page, and it is also what keeps `offset` a multiple of the page size —
 *   which the WooCommerce adapter's offset-to-page derivation relies on.
 * - **`consumed` counts rows READ, not rows returned.** The de-duplication below
 *   can shrink `items`; advancing the cursor by the smaller number would re-read
 *   the collapsed rows forever.
 *
 * The inventory sweep deliberately does NOT use this: it reads one page and then
 * filters synthetic variants out, so its `consumed` and `items` diverge for a
 * different reason and its loop is genuinely a different shape.
 */
export async function readPagedIds(
  fetchPage: (offset: number, limit: number) => Promise<readonly string[]>,
  startOffset: number,
  budget: number,
  pageSize: number
): Promise<SweepPage> {
  const collected: string[] = [];
  let exhausted = false;
  let consumed = 0;

  while (collected.length < budget) {
    const batch = await fetchPage(startOffset + consumed, pageSize);
    if (batch.length === 0) {
      exhausted = true;
      break;
    }
    collected.push(...batch);
    consumed += batch.length;
    if (batch.length < pageSize) {
      exhausted = true;
      break;
    }
  }

  // Some sources repeat ids across pages; the cursor still counts what was read.
  return { items: [...new Set(collected)], consumed, exhausted };
}

/**
 * Synthetic variant external ids (e.g. `product:13`) are minted by the PrestaShop
 * adapter as stable offer-link targets for simple products. Their internal id is a
 * VARIANT id, not a product id, so any sweep enumerating `Product` mappings must
 * filter them: the inventory sweep would violate the `inventory_items.productId` FK,
 * and the reconcile pass would re-check the wrong entity. The plain numeric
 * externalId of the same simple product is enumerated alongside and covers it.
 *
 * Shared rather than re-declared per handler: this is a fact about an ADAPTER's id
 * minting that two sweeps must agree on, so two copies of the literal are drift with
 * no upside.
 */
export const SYNTHETIC_VARIANT_PREFIX = 'product:';

/**
 * Reads one page of OL's OWN mapped external ids for a connection, filtering the
 * synthetic variant ids.
 *
 * Shared by the two sweeps that enumerate MAPPINGS rather than a master's catalog —
 * `master.inventory.syncAll` and `master.product.reconcile`. Deliberately NOT
 * `readPagedIds`: that helper loops pages until the budget fills and derives
 * `exhausted` inside its own loop, whereas this shape issues ONE paged read and
 * filters afterwards, so its `consumed` counts rows read from the mapping page.
 * Forcing the two together would break the cursor invariant.
 *
 * The filter runs AFTER the read, so a page can yield fewer children than the
 * budget. That is correct: the budget bounds *enqueues*, and the cursor advances by
 * what was READ — advancing by what survived would re-read the filtered rows on
 * every tick, forever.
 */
export async function readMappingPage(
  listExternalIds: (page: { limit: number; offset: number }) => Promise<readonly string[]>,
  offset: number,
  budget: number
): Promise<SweepPage> {
  const externalIds = await listExternalIds({ limit: budget, offset });

  return {
    items: externalIds.filter((id) => !id.startsWith(SYNTHETIC_VARIANT_PREFIX)),
    consumed: externalIds.length,
    // A short page means the store had nothing more to give.
    exhausted: externalIds.length < budget,
  };
}

/**
 * Items one BATCHED run may enqueue, and the ceiling on an override (#2593).
 *
 * Re-derived, not scaled arbitrarily. The 100 above bounds a fan-out whose unit
 * is one child job doing a full per-product platform sync - four requests and a
 * fresh adapter instance each. On the batched path the unit is a PAGE: one
 * adapter instance hydrates 100 products in three requests, so the per-product
 * cost inside a batch is the database work plus a memo read. Five batches of 100
 * is what fits the same drain-rate rule the 100 was derived from - budget x
 * per-child-duration inside the tick - given that at most
 * `OL_LANE_BULK_SCOPE_CAP` of them run at once per connection (#2594).
 *
 * It is NOT raised further. Five children is below that per-scope cap, so the
 * budget is the binding constraint here and the lane is not: raising it buys
 * real throughput up to the cap and only queue depth past it. Measure before
 * moving it, which is what the epic's own measurement warns about.
 */
export const BATCHED_SWEEP_BUDGET_DEFAULT = 500;
export const BATCHED_SWEEP_BUDGET_MAX = 2000;

/**
 * Products one batch child covers.
 *
 * 100 is PrestaShop's own collection page size, so a batch is one page of the
 * shop's paging rather than a number of our own - a larger value buys no fewer
 * requests and makes one failure cost more work.
 */
export const SWEEP_BATCH_SIZE_DEFAULT = 100;
export const SWEEP_BATCH_SIZE_MAX = 100;

/** Floors then clamps a payload-supplied budget. */
export function resolveSweepBudget(
  pageLimit: number | undefined,
  bounds?: { default: number; max: number }
): number {
  const fallback = bounds?.default ?? SWEEP_BUDGET_DEFAULT;
  const ceiling = bounds?.max ?? SWEEP_BUDGET_MAX;
  const requested = typeof pageLimit === 'number' ? pageLimit : fallback;
  return Math.min(Math.max(1, Math.floor(requested)), ceiling);
}

/**
 * Picks the budget for a run, honouring which ceiling the value earned.
 *
 * A value that came from the SETTINGS surface may sit above the recommended
 * ceiling: getting there required an explicit `acknowledgeAboveRecommended`,
 * and clamping it back here would report a budget the sweep does not run.
 *
 * A value from the JOB PAYLOAD did not pass that gate - a payload is a raw
 * enqueue with nowhere to record an acknowledgement - so it keeps the
 * RECOMMENDED ceiling. The narrower bound is the safe direction for the input
 * that carries no stated intent.
 */
export function resolveRunBudget(
  payloadLimit: number | undefined,
  settingValue: number,
  bounds: { default: number; recommendedMax: number; absoluteMax: number }
): number {
  if (payloadLimit !== undefined) {
    return resolveSweepBudget(payloadLimit, {
      default: bounds.default,
      max: bounds.recommendedMax,
    });
  }
  return resolveSweepBudget(settingValue, {
    default: bounds.default,
    max: bounds.absoluteMax,
  });
}

/**
 * Parses a stored cursor value. An absent, empty, or unparseable value starts a
 * fresh cycle rather than throwing — a malformed cursor must never wedge a sweep,
 * and re-running a cycle is idempotent.
 *
 * This is the repo's first COMPOSITE cursor value (every other cursor —
 * `allegro.offerStatus.scanOffset`, `allegro.orders.lastEventId`, the taxonomy
 * watermark — is scalar). The deviation buys the cycle identity the child
 * idempotency key needs; see `SweepCursor.cycleId`.
 */
export function parseSweepCursor(stored: string | null): SweepCursor | null {
  if (stored === null || stored.length === 0) {
    return null;
  }
  const separatorIndex = stored.lastIndexOf(CURSOR_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }
  const cycleId = stored.slice(0, separatorIndex);
  const offset = Number(stored.slice(separatorIndex + 1));
  if (cycleId.length === 0 || !Number.isInteger(offset) || offset < 0) {
    return null;
  }
  return { cycleId, offset };
}

export function formatSweepCursor(cursor: SweepCursor): string {
  return `${cursor.cycleId}${CURSOR_SEPARATOR}${String(cursor.offset)}`;
}

/**
 * Runs one budgeted, resumable page of a sweep.
 *
 * The cursor advances only when EVERY enqueue in the page succeeded
 * (`docs/code-review-guide.md` § Security & Safety: "only advance after
 * success"). Before resumption existed, a partially-failed `allSettled` was
 * tolerable because the next tick re-enumerated everything; now, advancing past a
 * failed id would skip it silently until the next full cycle — hours away.
 */
export async function runBoundedSweep(input: BoundedSweepInput): Promise<BoundedSweepResult> {
  const cycleId = input.cursor?.cycleId ?? input.newCycleId();
  const startOffset = input.cursor?.offset ?? 0;

  const page = await input.readPage(startOffset, input.budget);

  if (page.items.length === 0) {
    return {
      cycleId,
      enqueued: 0,
      failed: 0,
      // An empty page from an exhausted source completes the cycle. An empty
      // page from a source with MORE to give still has to advance, or the sweep
      // re-reads the same offset forever — this is the all-items-filtered case
      // (the inventory sweep drops synthetic ids after reading them), where
      // `consumed` is the rows read and is what advances.
      //
      // `consumed: 0` with `exhausted: false` is a caller-contract violation,
      // not a state either handler can produce (both report exhausted on a
      // zero-length read). It is left to advance by `consumed` — i.e. not at
      // all — rather than nudged forward by one, because skipping an unread
      // source row to break a hypothetical loop trades a stall for silent data
      // loss, and a stalled cursor is the visible failure of the two.
      nextCursor: page.exhausted ? null : { cycleId, offset: startOffset + page.consumed },
      completed: page.exhausted,
    };
  }

  const groups = groupItems(page.items, input.groupSize ?? 1);
  const outcomes = await enqueueInChunks(groups, cycleId, input.enqueue);
  const enqueued = outcomes.filter((ok) => ok).length;
  const failed = outcomes.length - enqueued;

  if (failed > 0) {
    // Do not advance AT ALL — retry the whole page next tick.
    //
    // Stopping at the failing item's index would be tighter, but the index into
    // `items` is not a source offset: a caller may filter items out of a page
    // after reading it (the inventory sweep drops synthetic `product:` ids), so
    // the two only coincide when nothing was filtered. Re-reading the page is
    // cheap and re-enqueueing its successes is a no-op, because the child key is
    // cycle-scoped rather than tick-scoped.
    //
    // An enqueue failure is almost always infrastructure-wide (Postgres or Redis
    // unavailable) rather than per-item, so the cycle resumes on its own once the
    // outage clears. A genuinely poisonous single id would hold the cycle at this
    // offset — visible as a cursor that stops moving while the handler logs the
    // failure every tick.
    return {
      cycleId,
      enqueued,
      failed,
      nextCursor: { cycleId, offset: startOffset },
      completed: false,
    };
  }

  return {
    cycleId,
    enqueued,
    failed: 0,
    nextCursor: page.exhausted ? null : { cycleId, offset: startOffset + page.consumed },
    completed: page.exhausted,
  };
}

/**
 * Cuts a page into the units one child covers.
 *
 * A `groupSize` of 1 yields one single-element group per item, so the per-item
 * fan-out is the same code path rather than a branch beside it.
 */
function groupItems(items: readonly string[], groupSize: number): readonly string[][] {
  const size = Math.max(1, Math.floor(groupSize));
  const groups: string[][] = [];
  for (let start = 0; start < items.length; start += size) {
    groups.push(items.slice(start, start + size));
  }
  return groups;
}

async function enqueueInChunks(
  groups: readonly (readonly string[])[],
  cycleId: string,
  enqueue: BoundedSweepInput['enqueue']
): Promise<boolean[]> {
  const outcomes: boolean[] = [];
  for (let start = 0; start < groups.length; start += ENQUEUE_CHUNK_SIZE) {
    const chunk = groups.slice(start, start + ENQUEUE_CHUNK_SIZE);
    const settled = await Promise.allSettled(chunk.map((group) => enqueue(group, cycleId)));
    outcomes.push(...settled.map((result) => result.status === 'fulfilled'));
  }
  return outcomes;
}
