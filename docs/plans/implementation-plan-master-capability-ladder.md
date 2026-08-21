# Implementation Plan — Wave 2c: the master capability ladder (#2220) + the PrestaShop watermark spike (#2221)

> Implements [ADR-048](../architecture/adrs/048-incremental-catalog-replication.md) decisions **1**, **3** and **7**.
> Sequenced after #2218/#2219 (bounded, resumable master sweeps — merged).
> Decision **2** (two cadences, reconciliation-owns-deletion) is explicitly **out of scope** — it is #2222's.
>
> **Revision 2** — applies the `/pre-implement` gate (`analysis/ANALYSIS-master-capability-ladder.md`, NEEDS-REVISION,
> C1+C2) and the deep `/tech-review` (Approve with changes, 1 BLOCKING + 5 IMPORTANT). Changes from revision 1 are
> marked **[R2]**.
>
> **Revision 3** — applies the deep `/tech-review` of the implemented diff (Approve with changes, 0 blocking).
> The substantive one: **the watermark advances to the instant the CYCLE opened, not to the completing tick's
> clock**, carried across resumptions on a `master.product-delta.pending-watermark:connection:{id}` cursor. A
> multi-tick cycle queries one fixed `since`, so stamping the last tick would move the watermark past rows the
> cycle never had the chance to observe — turning the § 6(b) row-skip from "missed for one cycle" into "missed
> permanently". Recorded in ADR-048 as a partial narrowing of that window. Also: the default cron is **`*/15`**,
> derived from `bounded-sweep.ts`'s own drain-rate rule rather than guessed (`*/5` was ~167% of a tick at the
> default budget, worst case, on a runner the full sweeps already feed); `lookbackSeconds: 0` is rejected rather
> than accepted as "no overlap", since that is exactly the shape decision 3 forbids; the non-declaring-adapter
> skip logs at `debug`, because the task is gated on `ProductMaster` so every PrestaShop connection reaches it
> every tick; the two non-atomic cursor writes carry a do-not-reorder note; and `master.product.syncDelta` was
> added to the FE job-type filter list.

## Goal

Let a `ProductMaster` adapter **say** that it can enumerate only what changed since a watermark, and let the
catalog sweep use that when it is offered — without any adapter that cannot do it changing behaviour.

Layer: **CORE** (new sub-capability) + **Integration** (WooCommerce) + **Interface** (worker handler, scheduler task).

### Non-goals

- Catalog-level staleness / deletion authority (#2222, ADR-048 decision 2).
- Relaxing the existing `master.product.syncAll` cadence — the delta pass is additive and ships **opt-in**.
- Any inventory rung (see § Scope deviation).
- Monotonic-cursor and cheap-digest rungs — ADR-048 decision 1 forbids writing a rung with no implementer.

---

## #2221 — spike verdict (DONE, recorded in ADR-048)

Measured against a live **PrestaShop 9.0.2** (the build `docker-compose.yml` pins), every write made over the
webservice through the same PHP path an operator's would take.

| Question | Answer |
|---|---|
| Does a combination write bump the parent's `date_upd`? | **No.** `PUT /api/combinations/40` changed the combination; parent `date_upd` held at `16:42:58`. |
| Positive control — does a product write bump it? | **Yes.** `PUT /api/products/22` moved it to `16:47:41`; an untouched sibling held. |
| What timezone is `date_upd`? | **Shop-local `PS_TIMEZONE`**, not UTC — `UTC+2` against a `UTC` MySQL server under `Europe/Paris` in August. |
| Does `filter[date_upd]` behave on 9.0.2? | **Yes**, and `date=1` is not required for it to apply. |
| (bonus) Does a `stock_availables` write bump the parent? | **No** — quantity went 100 → 137, `date_upd` unmoved. PS #20465 reproduced. |

**Verdict: PrestaShop declares neither rung.** `date_upd` covers product-level fields only, and since #822/#823 a
combination carries first-class OL data (per-variant price, EAN, reference, weight) — so a `products` delta rung
would look healthy while silently skipping every variant-level change. There is no second watermark to union
against: `ps_product_attribute` and `ps_stock_available` carry **no mutation timestamp of any kind**
(`available_date` is a business availability date). Structural limit, not a missing workaround.

Also worth carrying forward: `PrestashopQueryBuilder.formatDate` builds its `filter[date_upd]` bound from the **OL
worker process's** local-time getters, so today's `updatedSince` filter is a *three*-way timezone mismatch
(worker-local vs shop-local vs UTC DB). Not fixed here — nothing on the delta path reaches it, and no in-tree
caller passes `updatedSince` — but it is the reason the rung must never be declared "because the filter exists".

---

## Scope deviation from the issue text (deliberate, ADR-governed)

#2220's scope item 1 asks for **both** `products/domain/ports/capabilities/` **and**
`inventory/domain/ports/capabilities/`. This plan creates **only the products one**, because ADR-048 decision 1 —
which the same issue implements — says *only rungs with an implementer are written as code*, and after #2221 no
`InventoryMaster` in the tree can implement a modified-since rung:

- **PrestaShop**: stock is structurally invisible to any watermark (confirmed twice — PS #20465 and the #2221 run).
- **WooCommerce**: order-driven stock writes bypass `wp_update_post()`, so the one mutation operators care about
  most never appears in `modified_after` (ADR-048's platform table; the issue itself flags it).

An `InventoryMaster` that declares nothing stays reconcile-only, which decision 7 calls **correct rather than
degraded**. Creating an empty directory plus an interface with no implementer is the speculation decision 1
forbids. If a stock-capable master ever arrives, the directory is one file away.

**[R2]** This deviation is posted as a comment on #2220 so the acceptance criterion is closed knowingly rather
than silently.

---

## Design

### 1. The rung is guard-only, NOT manifest-advertised **[R2 — rationale corrected]**

Revision 1 argued that advertising the rung in `supportedCapabilities` "would create a retro-fill gap". That is
**false as written**, and the corrected argument matters because the wrong version would mislead a later author.

What is true: `listCapabilityAdapters` requires `connection.enabledCapabilities.includes(capability)`
(`integrations.service.ts:191`), and `enabledCapabilities` is stamped at create from the manifest
(`connection.service.ts:302-304`) with **no retro-fill anywhere** — an existing connection only gains a name via an
explicit `PATCH`. So the gap is in *gating*, not in *advertising*. Advertising the name and still registering the
task against `ProductMaster` (the shipped `ShopCategoryBrowser` pattern) would be perfectly safe.

Guard-only is chosen anyway, for three reasons, the third being the load-bearing one:

1. We must not **gate** on the new name — that is where the retro-fill gap is real, and it would silently drain
   nothing for exactly the installs with a catalog worth delta-syncing (the "not retro-filled" shape of #2085).
2. A manifest edit ripples into the routing/manifest int-specs and changes `defaultCapabilities` for new
   connections — cost with no consumer, since nothing in this change reads the manifest for this name.
3. **An advertised name is bait.** It reads like something you may gate on, and the next author who does reopens
   the gap in (1). Guard-only makes the wrong thing unavailable rather than merely discouraged.

**Deliberately given up**: operator-facing discoverability — the connection response will not say "this master can
delta-sync". Revisit if an FE surface ever needs to show it, at which point advertising-without-gating is correct.

Consequences: no `CoreCapabilityValues` entry, no manifest edit, and the delta task fans out to `ProductMaster`
connections that then no-op (one adapter resolve per non-capable connection per tick — zero on a default install,
since the task is opt-in).

### 2. Files **[R2 — corrected; three rows were wrong, two were missing]**

| # | File | Change |
|---|---|---|
| 1 | `libs/core/src/products/domain/ports/capabilities/modified-product-lister.capability.ts` | **NEW** — `ModifiedProductLister` + `isModifiedProductLister`. First file in a new directory. |
| 2 | `libs/core/src/products/index.ts` | Export `type { ModifiedProductLister }` + `{ isModifiedProductLister }` (two-line pattern, section comment). |
| 3 | `libs/core/src/sync/domain/types/sync-job.types.ts` | Add `'master.product.syncDelta'` to `JobTypeValues`. |
| 4 | `libs/core/src/sync/domain/types/master-job-payloads.types.ts` | **EXTEND** (not new — it already ships four payloads). Add `MasterProductSyncDeltaPayloadV1`. |
| 5 | `libs/core/src/sync/index.ts` | **[R2]** Export the new payload type (existing `:98` pattern). |
| 6 | `apps/worker/src/sync/bounded-sweep.ts` | **[R2]** Widen `sweepLockKey`/`sweepCursorKey` `kind` to include `'product-delta'`. |
| 7 | `libs/integrations/woocommerce/.../woocommerce-product-master.adapter.ts` | `implements ProductMasterPort, ModifiedProductLister`; add `listExternalIdsModifiedSince`. |
| 8 | `apps/worker/src/sync/handlers/master-product-sync-delta.handler.ts` | **NEW** — narrows the rung, reuses `runBoundedSweep`, own lock + cursor + watermark. |
| 9 | `apps/worker/src/sync/sync-worker.module.ts` + `handlers/handler-registration.service.ts` | Register the handler. |
| 10 | `apps/api/src/sync/application/services/scheduler.service.ts` | New `CoreCapabilityTaskDescriptor`, `defaultEnabled: false`. |
| 11 | `apps/{api,worker}/.env.example` | Document `OL_MASTER_PRODUCT_DELTA_SYNC_ENABLED`, `OL_MASTER_PRODUCT_DELTA_SYNC_CRON`, `OL_MASTER_DELTA_LOOKBACK_SECONDS`. |
| 12 | `docs/capabilities.md` | **[R2]** New `ProductMasterPort (products) — 1` **section** (none exists) + bump the total in the heading. |
| 13 | `docs/architecture-overview.md` | § Products entry; bump "46 sub-capabilities" → 47. |

**[R2]** The FE `JobType` mirror (`apps/web/src/features/sync-jobs/api/sync-jobs.types.ts:52`) is **deliberately not
updated**: the mirror is already partial, `SyncJob.jobType` is `string` so nothing breaks, no invariant guards it,
and an opt-in internal sweep has the same character as `marketplace.offer.pauseStale`, which carries an inline
comment saying so. A one-line comment records the choice.

### 3. The capability **[R2 — renamed; limit/offset now required]**

```ts
export interface ModifiedProductLister {
  listExternalIdsModifiedSince(input: {
    since: Date;
    limit: number;
    offset: number;
  }): Promise<string[]>;
}

export function isModifiedProductLister(
  adapter: ProductMasterPort,
): adapter is ProductMasterPort & ModifiedProductLister { /* typeof probe */ }
```

**[R2] Renamed** from `ModifiedSinceLister`: every shipped capability names its *subject* (`OfferLister`,
`ShopAttributeReader`, `CatalogProductReader`), not its filter, and `isModifiedProductLister(adapter)` reads
correctly at a call site with no surrounding context.

**[R2] `limit`/`offset` are required**, unlike `listExternalIds`'s optional pair. This interface exists solely to be
swept; optional bounds let a caller silently pull the platform's default page with no type error.

`since` is a `Date` (UTC instant), never a preformatted string — the adapter owns the platform's wire format and
its timezone flag, which is the whole lesson of #2221 and of WooCommerce's `dates_are_gmt`.

### 4. Locking: a SEPARATE lock, and why **[R2 — new section; this was the BLOCKING gap]**

Revision 1 never said which lock the delta run takes. The choice is a real design decision:

- **Shared lock** (`sweepLockKey('product', …)`): on a catalog large enough to matter, the 20-minute full sweep is
  *always* mid-cycle — that is #2218's design — so the delta task would be permanently locked out while logging
  "already in progress" and returning `ok`. That is precisely the failure ADR-048 § Consequences predicts: *the
  delta path is the one that will look healthy while being wrong*. Unrecoverable without operator action.
- **Separate lock** (`sweepLockKey('product-delta', …)`): both passes run concurrently. The child idempotency key
  is cycle-scoped, and the two passes mint different `cycleId`s, so a product in both sets is enqueued **twice** —
  real duplicate work on a concurrency-1 runner.

**Separate lock is chosen.** The duplication is bounded (delta budget 100/tick, and the delta set is a subset of
the full set), self-limiting, and harmless because `syncByExternalId` is idempotent; starvation is neither bounded
nor self-correcting. The duplication is stated in the handler header so it is not later "fixed" by sharing a lock.

Keys (**[R2]** — the formatter's own spelling, not revision 1's invented dotted form):

- lock — `sweepLockKey('product-delta', cid)` → `master:product-delta:sweep:{cid}`
- sweep cursor — `sweepCursorKey('product-delta', cid)` → `master.product-delta.sweep:connection:{cid}`
- watermark — `master.product-delta.watermark:connection:{cid}` (handler-local constant; not a sweep key)
- scheduler idempotency — `master:{cid}:product:syncDelta:{ts}`, distinct from `syncAll`'s namespace.

### 5. Watermark discipline (ADR-048 decision 3)

Per run, in this order:

1. `capturedAt = new Date()` — **before** the read, never `lastRunAt`.
2. `since = storedWatermark - lookback` (default **300 s**, `OL_MASTER_DELTA_LOOKBACK_SECONDS`, clamped).
3. Sweep with `runBoundedSweep`, exactly as the full pass does.
4. Advance the watermark to `capturedAt` **only when the cycle completed**. A budget-truncated or partly-failed run
   leaves it, so `since` is recomputed from the *unadvanced* watermark on every resuming tick and the query set
   stays stable across a multi-tick cycle. **This is the invariant everything else rests on** and it gets a test.

Re-reading is free **only because every downstream write is idempotent** (`syncByExternalId` upserts; the child
idempotency key is cycle-scoped). That assumption is load-bearing and gets a comment at the site that relies on it.

**First run with no stored watermark** enumerates nothing and stamps the watermark, rather than treating a missing
watermark as "since the epoch" (which would make the delta pass a full pass on its first tick, on top of the full
pass already running). The full sweep is what bootstraps a catalog. **[R2]** Two consequences to encode:

- The sweep cursor stays `null` on that run — no cycle is opened.
- A **cleared or lost** watermark is byte-identical to "never ran", so the handler would silently re-stamp and
  swallow the whole gap. Log this at **`warn`**, not `debug`, so a second occurrence is visible.

### 6. Two failure modes that must be observable, not silent **[R2 — new section]**

**(a) The never-completing cycle.** If the modified-set drains slower than it fills (budget 100/tick vs arrival
rate), the cycle never exhausts, `since` never advances, and the delta pass silently degenerates into a permanent
full pass at extra cost — while every job row reads `outcome: 'ok'`. `bounded-sweep.ts:22-46` does exactly this
drain-rate arithmetic for the full sweep. Mitigation: **`warn` when `since` is older than `OL_MASTER_DELTA_STALE_
WARN_HOURS` (default 24)**. This needs no schema change — the watermark is already a timestamp — and the cursor
remains the primary observable.

**(b) Offset paging over a live ordered set drops rows.** `orderby=modified&order=asc` is right for *appends* (new
rows land past the cursor), but it does not survive *re-modification*: a row already read at offset *k* that is
edited mid-cycle moves to the tail, shifting every later row left by one, so the row now at the current offset is
never read. Its `modified` is `< capturedAt`, so neither the next cycle's `since` nor the 300 s lookback reaches
it. It stays unsynced until a full pass covers it.

Keyset paging would fix it properly, but it requires the adapter to return each row's `modified` timestamp
alongside its id — a different interface shape, and premature for a rung with one implementer. **Accepted and
documented**, on one explicit condition: it is survivable *only* because #2220 leaves the full pass running
unchanged. That makes it a **hard dependency for #2222**, which is the issue that may relax the full cadence, and
so it is recorded in ADR-048 rather than only in this plan — the plan is a transient artefact, the assumption is
not.

### 7. What the delta path must NOT do

- **No catalog-level prune.** None exists yet (#2222 introduces it); the delta handler must never grow one. Pinned
  by a spec asserting the handler enqueues only `master.product.syncByExternalId` and touches no stale/prune seam.
- **It does NOT skip the per-product variant prune**, and this is the distinction a later editor is most likely to
  get wrong. ADR-048 decision 2 ¶2 is explicit: `markVariantsStaleExcept` runs *inside* `syncByExternalId` against
  the variants of one product the master just returned, is authoritative there, and must keep running or
  #1599/#1689 loses its per-product half. The delta path enqueues the same child, so it inherits that prune —
  correctly, including the #1904 rival-claimant guard on both branches.
- **[R2] `handleMasterDeletion` also fires on the delta path** — when a product is deleted between enumeration and
  child execution — and that is **correct**: it is a per-product 404, which is authoritative. "Delta cannot observe
  deletions" is a statement about the *enumeration*, not about the path. Said explicitly, because § 7 as written in
  revision 1 could be misread as requiring that branch to be suppressed.
- **No claim of variant freshness.** WC #19562: a variation edit does not bump the parent's `date_modified`, and
  there is no store-wide variations collection. Stated in the adapter and handler headers, because the honest
  reading of a green delta run is "product-level fields are fresh", not "the catalog is fresh".

### 8. WooCommerce adapter

```
GET /wp-json/wc/v3/products
  ?_fields=id
  &per_page=<page size, NOT the budget>&page=<floor(offset/perPage)+1>
  &modified_after=<since.toISOString()>
  &dates_are_gmt=true          // default is false = site-local, DST-shifting
  &orderby=modified&order=asc  // see § 6(b) for what this does and does not buy
```

**[R2] `per_page` is the page size (100), never the sweep budget (≤500).** WooCommerce hard-caps `per_page` at 100
and 400s above it — the reason the full handler keeps a separate `DEFAULT_PAGE_SIZE = 100` with its #1723 comment.
The delta `readPage` reuses the same page-size loop, which is also what keeps `offset` a multiple of the page size
so the adapter's `floor(offset/perPage)+1` derivation stays exact.

`dates_are_gmt=true` is the single most important literal in this change and gets its own pinning test — the order
source already carries the same flag with the same rationale, so this is an established fix, not a new theory.
Requires WC ≥ 5.8. Boolean serialization is safe: the client passes params through `String(v)` into
`URLSearchParams`.

**Do not validate this rung with an API round-trip test** (write via REST, assert it appears): a REST `PUT` *does*
bump `date_modified`, so such a test passes while the real order-driven path it stands in for does not. Unit tests
assert the emitted query params; the platform's own semantics are documented, not mock-verified.

---

## Test plan **[R2 — three additions]**

| Test | Asserts |
|---|---|
| `modified-product-lister.capability.spec.ts` | Guard true for an implementer, false for a bare `ProductMasterPort`. |
| `woocommerce-product-master.adapter.spec.ts` (extend) | `dates_are_gmt=true`, `modified_after` = ISO of `since`, `orderby=modified&order=asc`, `_fields=id`, `per_page` ≤ 100; offset→page derivation matches `listExternalIds`. |
| `master-product-sync-delta.handler.spec.ts` | Non-capable adapter → no enqueue, `outcome: 'ok'`; lock contention → skip; watermark advances **only** on completion; lookback subtracted; budget honoured; first run stamps without enumerating and opens no cycle; **only** `syncByExternalId` enqueued. |
| **[R2]** same file | `since` is recomputed from the *unadvanced* watermark on a resuming tick — the § 5 invariant. |
| **[R2]** same file | Lock and cursor keys are **distinct** from `syncAll`'s (pure regression bait). |
| **[R2]** `handler-registration` | `master.product.syncDelta` resolves in the runner — a missing registration otherwise fails silently at 3 a.m. |
| `scheduler.service.spec.ts` (extend) | Task registers only when its env var is explicitly enabled (`defaultEnabled: false`). |

---

## Resolved gate questions

1. **Separate job type vs a payload flag** — separate, and both gates concur: two cursors, two cadences, two locks,
   and #2222 attaching a catalog prune to the full pass only. A shared handler would carry a permanent
   `if (isDelta) skipPrune` guard in the one place where getting it wrong stales an entire catalog.
2. **Opt-in default** — correct for #2220: without #2222 the delta pass is additive work on top of an unchanged
   20-minute full pass. Flipping it, and relaxing the full cadence, belongs to #2222 — which must first address
   § 6(b).
