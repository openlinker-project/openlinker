# Implementation Plan — bounded, resumable master sweeps (#2218 + #2219)

**Issues**: #2218 (product sweep), #2219 (inventory sweep + paginated enumeration)
**Decision of record**: [ADR-048](../architecture/adrs/048-incremental-catalog-replication.md) decisions 4, 5, 6
**Branch**: `2218-2219-bound-resume-master-sweeps`

---

## 1. Understand the task

**Goal.** Both `syncAll` handlers currently enumerate an entire catalog and then `map(...)` + `Promise.allSettled` one child job per product, uncapped, every 20 (product) / 15 (inventory) minutes, into a runner whose execution concurrency is 1. Replace that with a **budgeted, resumable** run: enqueue at most N children per tick, record where the run stopped, resume on the next tick, serialise per connection.

**Layer**: `apps/worker` (handlers) + `libs/core/src/sync` (payload types) + `libs/core/src/identifier-mapping` (paginated enumeration, #2219 only).

**Explicit non-goals** (each has its own issue):
- No capability ladder, no `modified-since` delta path — #2220.
- No deletion-detection / reconcile-cadence change — #2222.
- No lane or priority work — ADR-050 / #2167.
- No change to what the child jobs (`master.*.syncByExternalId`) do.

---

## 2. Research — what already exists

| Fact | Location |
|---|---|
| Product sweep: `MAX_PAGES=1000` × `DEFAULT_PAGE_SIZE=100`, `collectExternalIds` accumulates into one array | `master-product-sync-all.handler.ts:42-43, 131-161` |
| **The truncation guard lies**: warns `pagination may be truncated`, then returns `{ outcome: 'ok' }` | same file, `:153-157` + `:118` |
| Inventory sweep enumerates the **mapping store**, not the platform | `master-inventory-sync-all.handler.ts:48-51` |
| `listExternalIdsByConnection` is a bare `find({entityType, connectionId})` — no `take`/`skip`/order | `identifier-mapping.repository.ts:101-112` |
| Inventory handler injects `IdentifierMappingQueryPort` (a **port**, not a repository port) — cross-context-legal | `master-inventory-sync-all.handler.ts:36-38` |
| **The pattern to copy** (corrected by the gate): scan-offset paging — `{ limit, offset }` in, `nextOffset` out, handler persists the cursor | `offer-status-sync.service.interface.ts:15-20`; `shop-status-sync.service.interface.ts:5-31`; cursor precedent `allegro.offerStatus.scanOffset` |
| **NOT the pattern**: taxonomy / `fxStampSweep` / `pauseStaleSweep` are *frontier-as-query* — they re-derive remaining work from a predicate. Master sweeps have no such predicate | `destination-taxonomy.service.ts:183` (`findExpandable`) |
| Clamp idiom used by eight sweep handlers: `Math.min(payload.limit ?? DEFAULT, MAX)` | `marketplace-order-fx-stamp-sweep.handler.ts:42-45` (`DEFAULT_LIMIT=100`, `MAX_LIMIT=500`) |
| Contention semantics to copy (lock returns incomplete, never throws) | `destination-taxonomy.service.ts:119-152` |
| Handler owns cursor I/O via `ISyncCursorsService` (repository port would trip `check-cross-context-imports`) | `destination-taxonomy-sync.handler.ts:68-76` |
| `SyncLockPort` + `SYNC_LOCK_TOKEN` exported from `@openlinker/core/sync`; **no worker handler uses it yet** | `sync.tokens.ts:16`, `sync/index.ts:22` |
| Both `syncAll` payloads are `{ schemaVersion: 1 }` only | `master-job-payloads.types.ts:21-27` |
| Existing coverage: 2 unit specs + 1 int-spec | `__tests__/master-{product,inventory}-sync-all.handler.spec.ts`, `master-inventory-sync-all-e2e.int-spec.ts` |

---

## 3. Design

### 3.1 One shared shape, applied twice

Both handlers converge on the same five-step run. ADR-048 decision 4 requires copying an existing pattern rather than inventing a second one; per the gate the pattern is the **scan-offset** family (`IOfferStatusSyncService` / `IShopStatusSyncService`), not taxonomy's frontier-as-query:

1. **Acquire** a per-connection lock with an explicit TTL — `SWEEP_LOCK_TTL_MS` default **300 000** (5 min), env `OL_MASTER_SWEEP_LOCK_TTL_MS`, clamped to [60 s, 1800 s], mirroring `taxonomy-sync-lock.ts:42-58`. The TTL covers **one budgeted run**, not one cycle — a cycle spans many ticks and must never hold a lock between them. Expiry is an efficiency and honesty measure, not a correctness dependency: a lost lock degrades to two overlapping runs, which `cycleId`-keyed idempotency already makes safe. `null` token ⇒ log + `{ outcome: 'ok' }`, never throw (taxonomy contention semantics).
2. **Read** the resume cursor (scalar string, `''`/absent ⇒ fresh cycle).
3. **Enumerate** at most `budget` ids starting from the resume position.
4. **Enqueue** those children, in chunks rather than one 500-wide `Promise.allSettled` (tech review, thundering herd).
5. **Write** the cursor — but only as far as the **last contiguously successful** enqueue. `docs/code-review-guide.md` § Security & Safety states the rule verbatim: *"Cursor safety (only advance after success)"*. Today's handler may tolerate a partial `allSettled` failure because the next tick re-enumerates everything; resumption removes that safety net, so advancing past a failed id would skip it silently until the next full cycle — hours away at the budget above. A failure therefore stops the cursor at the failing index and the next tick retries from there. Cycle completion writes `''`. Release the lock in `finally`, swallowing release errors.

Extracted as `apps/worker/src/sync/bounded-sweep.ts` — sibling of `sync-job.runner.ts`, because `apps/worker/src/sync/` is flat and a `lib/` directory would invent a layout (gate W1). Spec goes in the existing `apps/worker/src/sync/__tests__/`. A pure orchestration helper taking `{ enumerate, enqueue, budget, resumeFrom }` and returning `{ enqueued, nextResumeFrom, completed }`. It performs no I/O itself, so it is unit-testable without a cursor or lock double, and the two handlers cannot drift apart.

### 3.2 Cursor contents

| Sweep | Cursor key | Value |
|---|---|---|
| Product | `master.product.sweep:connection:{cid}` | `{cycleId}:{offset}` |
| Inventory | `master.inventory.sweep:connection:{cid}` | `{cycleId}:{offset}` |

`cycleId` is minted (`randomUUID`) when a fresh cycle starts and carried across every resuming tick of that cycle. It exists for one reason: **the child idempotency key currently ends in `:{job.id}`**, and with resumption each tick is a *different* job id, so an overlapping page would re-enqueue the same child under a new key. Keying on the cycle instead (`master:{cid}:product:sync:{externalId}:{cycleId}`) dedupes within a cycle while still allowing the next cycle to re-sync. This is the #2039 `reconcileId` lesson applied — a job id is not a run identity.

The cursor value is parsed defensively: an unparseable or legacy value starts a fresh cycle rather than throwing.

**This is the repo's first composite cursor value** — `allegro.offerStatus.scanOffset`, `allegro.orders.lastEventId` and the taxonomy watermark are all scalar, and `ISyncCursorsService` documents monotonicity as the caller's concern. The deviation is deliberate and is stated in the handler header: without a cycle identity the child idempotency key (`…:{job.id}` today) changes on every resuming tick, so an overlapping page re-enqueues the same child under a fresh key.

### 3.3 Budget

**Derived from drain rate, not copied.** The tech review's first blocking finding: taxonomy's `SYNC_PAGE_LIMIT_DEFAULT = 500` bounds *category upserts inside the same process*, whereas one unit here is a **child job** performing a full per-product platform sync — ~2-5 s each (#2167), against a runner whose execution concurrency is **1**. The arithmetic that matters is therefore `budget x per-child-duration < tick interval`: the inventory tick is 900 s, so at 5 s/child a budget of 180 exactly saturates it and leaves nothing for the buyer-facing work sharing that single slot.

`SWEEP_BUDGET_DEFAULT = 100` (≈500 s at the pessimistic 5 s/child, ~55% of the shorter tick) and `SWEEP_BUDGET_MAX = 500`. Those land on the same pair as the eight existing sweep handlers (`DEFAULT_LIMIT = 100` / `MAX_LIMIT = 500`), which is corroboration rather than coincidence — they bound comparable per-item platform work. The arithmetic goes in the constant's comment.

Overridable per job via an optional `pageLimit` on the payload (both `MasterProductSyncAllPayloadV1` and `MasterInventorySyncAllPayloadV1` gain `pageLimit?: number`), **floored and clamped** — `Math.min(Math.max(1, payload.pageLimit ?? SWEEP_BUDGET_DEFAULT), SWEEP_BUDGET_MAX)`. The floor is taxonomy's rule (`:161-166`: a `0` limit would authorise an unbounded run); the ceiling is the shipped idiom.

**Honest scope**: this bounds the fan-out. It does not make the catalog fast — a 20k-SKU connection now takes many ticks per full cycle, by design. Fixing *contention* between that work and a buyer's order is ADR-050's lanes (#2167), not this change.

**Never throws.** ADR-048 decision 5: on a cron path a throw costs `maxAttempts=10` with backoff to 6h and one accumulating dead row per tick, while the catalog stays unreplicated.

### 3.4 The `MAX_PAGES` lie disappears by construction

There is no longer a truncation branch to mis-report: a run that hits its budget is a *normal, resuming* run, and the cursor is the observable proof that more work remains. `MAX_PAGES` is deleted.

> **Deviation from #2218's AC wording.** The AC asks that "a truncated or incomplete run is distinguishable from a complete one **in `sync_jobs`**". `JobOutcomeReasonValues` currently holds exactly one value (`'master_deleted'`) and is mirrored FE-side; adding a value for "budgeted, will resume" would put an attention-shaped label on the *healthy* steady state. Instead the distinction lives where taxonomy puts it — the **cursor** (non-empty ⇒ cycle in flight) plus a structured completion log line. **Gate verdict: accepted.** Every comparable sweep (`fxStampSweep`, taxonomy, offer-status) returns a plain `outcome: 'ok'` per tick, and a budgeted run is the healthy steady state, not an incident. The reasoning is recorded in the handler header so it is not re-litigated against the issue text later.

### 3.5 Product enumeration (#2218)

Resume position is the `offset` already passed to `listExternalIds({limit, offset})`. One page per budget unit; stop at budget or at a short page (cycle complete).

The budget truncates **at a page boundary**: pages are fetched while `collected < budget`, so a non-multiple budget overshoots to the end of the page in flight rather than splitting it. Simpler than mid-page slicing and harmless — the overshoot is bounded by one page.

**Known limitation, documented in the handler:** `ProductMasterPort.listExternalIds` documents order as *platform-defined*, so an offset resumed across ticks can skip or repeat an id if the catalog shifts mid-cycle. Repeats are harmless (child sync is an idempotent upsert). A skip is picked up by the next cycle, because completion clears the cursor and the following tick re-enumerates from `0`. This is inherent to the enumerate-only rung — ADR-048's whole point is that this rung cannot do better — and is strictly better than today, which re-enumerates the entire catalog every tick and enqueues all of it.

### 3.6 Inventory enumeration (#2219)

Needs a paginated `listExternalIdsByConnection`. **Settled by the gate**: an added **optional** third parameter — `listExternalIdsByConnection(entityType, connectionId, opts?: { limit: number; offset?: number }): Promise<string[]>` — keeping the **return type `string[]`**.

Both properties are load-bearing. `IIdentifierMappingService extends IdentifierMappingPort {}` has no own members, so this signature is simultaneously the port, the service interface, the in-memory testing adapter and a **plugin-facing** contract (~12 type-dependency sites across WooCommerce and Erli, none of which call it). An optional param leaves every one source-compatible; returning a page object instead of `string[]` would break the sole production caller and all 11 `mockResolvedValue([...])` shape-fillers. The caller detects completion the way the rest of the repo does — a short page means done.

**Ordering**: the repository adds a stable `ORDER BY "externalId"`. Per the gate's C2 there is **no index** supporting an ordered `(entityType='Product', connectionId)` scan — the only ordered/keyset-shaped index is partial on `entityType = 'Offer'`, `id` is a random UUIDv4 and `createdAt` is unindexed — so each page costs a sort of the connection's Product partition. **Decision: accept the sort, do not add an index.** At realistic catalogue sizes (20k rows) it is survivable, it is strictly cheaper than today's unbounded read plus unbounded fan-out, and #2220 may reshape this read entirely. The cost is recorded in the repository method's comment so the next reader does not mistake it for an oversight. Adding the partial index later is a migration and needs no contract change.

Note the synthetic-id filter (`id.startsWith('product:')`) is applied *after* the page is fetched, so a page can yield fewer than `budget` children. That is correct: the budget bounds *enqueues*, and under-filling a page is harmless.

### 3.7 What is deliberately NOT changed

- The `Promise.allSettled` per-child resilience and its logging.
- The child payloads and job types.
- Cadence and scheduler registration (still `*/20` and `*/15`).
- `inventory.propagateToMarketplaces` (no cron; fires from `setInventory`).

---

## 4. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/core/src/sync/domain/types/master-job-payloads.types.ts` | add `pageLimit?: number` to both `syncAll` payloads | type-check passes; existing enqueues unaffected |
| 2 | `apps/worker/src/sync/bounded-sweep.types.ts` (new) | the helper's input/output contract (two consumers ⇒ it is a contract, so `*.types.ts` per engineering-standards § Type Definitions) | type-check passes |
| 2b | `apps/worker/src/sync/bounded-sweep.ts` (new) | pure `runBoundedSweep` + `parseSweepCursor` / `formatSweepCursor` + lock key/TTL | unit spec covers budget boundary, completion, malformed cursor, **partial-failure cursor stop** |
| 3 | `apps/worker/src/sync/__tests__/bounded-sweep.spec.ts` (new) | unit tests for the helper | AAA, edge cases |
| 4 | `master-product-sync-all.handler.ts` | adopt helper; inject `ISyncCursorsService` + `SyncLockPort`; delete `MAX_PAGES`; cycle-scoped idempotency key | resumes across runs; budget respected; contention returns ok |
| 5 | `identifier-mapping` port + service + repository | paginated `listExternalIdsByConnection` with `ORDER BY id` | existing callers compile unchanged |
| 6 | `master-inventory-sync-all.handler.ts` | same adoption as step 4, over the paginated enumeration | as step 4 |
| 7 | `__tests__/master-{product,inventory}-sync-all.handler.spec.ts` | extend: resume, budget, contention, completion clears cursor. **Named churn (gate W3)**: `master-inventory-sync-all.handler.spec.ts` has 7 assertion sites (`:24,52,57,69,77,90,102`) incl. the `product:` filter and DB-outage cases | all green |
| 7c | both handler specs | **a partially-failed enqueue page does not advance the cursor past the failure**; **a run that dies after enqueue but before the cursor write re-enqueues under the same `cycleId` and dedupes** (the property that makes the design crash-safe) | all green |
| 7b | `libs/core/src/identifier-mapping/**` specs | `identifier-mapping.service.spec.ts:551,577-588` asserts the exact 2-arg call; `testing/__tests__/in-memory-identifier-mapping.adapter.spec.ts:144,152` mirrors the signature | all green |
| 8 | `apps/worker/test/integration/…` | int-spec: a catalog larger than one budget completes across successive ticks | green under `pnpm test:integration` |
| 9 | `docs/architecture-overview.md` § Products / Inventory | record the bounded-sweep behaviour | reviewed |

---

## 5. Validation

- **Architecture**: handlers stay in `apps/worker`; cursor via `ISyncCursorsService` and enumeration via `IdentifierMappingQueryPort` — both service/port-level, so `check-cross-context-imports` stays green. No repository port crosses a context.
- **Naming**: `*.handler.ts`, `*.spec.ts`, `UPPER_SNAKE_CASE` constants, helper file carries a header comment.
- **Types**: no `any`; cursor parsing narrows from `string | null`.
- **Security**: no new external input; `pageLimit` is floored and bounded.
- **DB**: no ORM entity change ⇒ **no migration**. Step 5 adds an `ORDER BY`, not a column. Per the gate's C2 the ordered scan is **unindexed** for `entityType='Product'` and costs a per-page sort of the connection's partition; that is an accepted, documented cost (§3.6), not an oversight. Adding the partial index later is additive and needs no contract change.

---

## 6. Gate resolutions

`/pre-implement` verdict was **NEEDS-REVISION**; all findings are folded in above. Full report: [`analysis/ANALYSIS-bounded-resumable-master-sweeps.md`](./analysis/ANALYSIS-bounded-resumable-master-sweeps.md).

| Finding | Resolution |
|---|---|
| **Reuse miss** — plan copied taxonomy (frontier-as-query) | Corrected to the scan-offset family (`IOfferStatusSyncService` / `IShopStatusSyncService`), §2 + §3.1 |
| **C1** — port change is plugin-facing (~12 type-dependency sites) | Optional third param, return type stays `Promise<string[]>`, §3.6. Blast radius is one production caller, so #2219 is not split out |
| **C2** — "no migration" unverified; no index supports the ordered scan | Accept the per-tick sort, document it in the repository method; no index, no migration, §3.6 + §5 |
| **W1** — `lib/` invents a layout | Helper at `apps/worker/src/sync/bounded-sweep.ts`, spec in the existing `__tests__/`, §3.1 |
| **W2** — composite cursor has no precedent | Kept, with the justification stated in the handler header, §3.2 |
| **W3** — two specs assert exact call shape | Named as steps 7 and 7b |
| **W4** — §3.4 AC deviation | Accepted; reasoning goes in the handler header |
| Clamp idiom | Budget now floored **and** clamped, §3.3 |

### `/tech-review` resolutions (verdict: Request changes)

| Finding | Resolution |
|---|---|
| **BLOCKING** — budget copied from taxonomy, whose unit of work is a local upsert not a platform sync | Derived from drain rate: `100` default / `500` max, arithmetic in the comment, §3.3 |
| **BLOCKING** — cursor advanced past failed enqueues, skipping ids silently until the next cycle | Advance only to the last contiguously successful enqueue, §3.1 step 5 |
| **IMPORTANT** — lock TTL unspecified | `SWEEP_LOCK_TTL_MS` 300 s, env-overridable, clamped; covers one run, §3.1 step 1 |
| **IMPORTANT** — no test for either blocking item | Step 7c |
| **SUGGESTION** — 500-wide `Promise.allSettled` | Chunked, §3.1 step 4 |
| **SUGGESTION** — budget/pageSize interaction undefined | Truncates at a page boundary, §3.5 |
| **SUGGESTION** — helper types placement | `bounded-sweep.types.ts`, step 2 |
| *Verified non-issue* | DI needs no module change — `sync-worker.module.ts:59` imports `SyncModule`, which exports both tokens |

