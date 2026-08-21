# Implementation Plan — Wave 2d: reconciliation as the deletion authority (#2222)

> Implements [ADR-048](../architecture/adrs/048-incremental-catalog-replication.md) decision 2.
> Depends on #2218 / #2219 / #2220 — all merged.
>
> **Revision 2.** Revision 1 was re-premised by the deep `/tech-review` (Request changes) and the deep
> `/pre-implement` gate (NEEDS-REVISION, 3 Critical). Both were right; the original design is abandoned, not
> patched. See § What revision 1 got wrong — it is the most useful part of this document.

## What revision 1 got wrong

Revision 1 asserted that *a hard deletion is currently undetectable by the sweeps* and proposed to build a
catalog-level "absence = deletion" authority: a `lastObservedAt` column on `identifier_mappings`, a migration
with a backfill, per-page stamping, a cycle-completion sweep and four guards. **Three independent findings
killed it, and all three were verified against the code:**

1. **Deletion is already detected.** `master.inventory.syncAll` enumerates **OL's own `identifier_mappings`**
   via `listExternalIdsByConnection` (#2219) — not the master — so a deleted product is *still* enumerated.
   Its child calls `listInventory`, the adapter translates its 404, and `MasterProductNotFoundError` reaches
   `MasterInventorySyncService.handleMasterDeletion` within ~15 minutes, no webhook required.
2. **"Absence" is not a safe signal here anyway.** `PrestashopProductMasterAdapter.listExternalIds` issues no
   `sort` and `WooCommerceProductMasterAdapter.listExternalIds` no `orderby` (WC defaults to `date DESC`).
   A cycle spans many ticks, so one mid-cycle delete shifts every later row left and a **live** product is
   never read — then swept, and its offers zeroed on every marketplace via #1689. A single-row false positive,
   which none of revision 1's mass-stale guards addressed.
3. **The predicate was uncomputable.** The sweep needed "the cycle's start instant"; the cursor carries
   `{cycleId, offset}` with `cycleId = randomUUID()`. Nothing persists it.

Correcting (2) is what produced this revision: *never stale on absence — re-verify by id and let the adapter's
404 be the authority.* But that is precisely what the inventory sweep already does. **So the deletion
authority is not a new mechanism; it is a pass products is missing.**

## The actual defect (a shipped bug, not a design gap)

Detection works. **The pause does not.** End to end today, for a product hard-deleted at a master:

| Step | What happens | Where |
|---|---|---|
| 1 | Inventory sweep enumerates OL's mapping; child job runs | `master-inventory-sync-all.handler.ts` |
| 2 | Adapter 404 → `MasterProductNotFoundError` → `handleMasterDeletion` | `master-inventory-sync.service.ts:201` |
| 3 | `pruneStaleVariants` → `markStaleExceptVariants` sets **`inventory_items.isStale`** | `inventory.repository.ts:228-248` |
| 4 | Emits `master.product.stale` with the variant ids | `master-inventory-sync.service.ts:222-229` |
| 5 | `marketplace.offer.pauseStale` runs; re-verifies `variant.isStale !== true \|\| !variant.staleAt` against **`product_variants`** | `stale-offer-pause.service.ts:91-96` |
| 6 | **Every variant fails the check. Nothing is paused. The offers keep selling.** | |

The two halves check **different tables**. The whole #1689 machinery fires correctly and no-ops at the last
step. The hourly `marketplace.offer.pauseStaleSweep` backstop reads `findStaleMappedVariants` — the same
variant flag — so it does not save it either.

## Goal

Two parts, neither needing a schema change.

**A — make the detection that already works actually pause offers.** The inventory-context deletion path must
reach `product_variants.isStale`, which is the flag #1689 re-verifies against.

**B — give products the mapping-enumerating reconcile pass inventory already has**, so a `ProductMaster`
connection with **no** `InventoryMaster` (and the #1904 rival case, where inventory withholds its prune) is
also covered. It enqueues the *existing* `master.product.syncByExternalId`, whose adapter 404 is the existing
authority — no new deletion mechanism, no stamping, no absence-based inference.

Layer: **CORE** (products, inventory) + **Interface** (one worker handler, one scheduler descriptor).

### Non-goals

- **Relaxing the full-pass cadence or defaulting the delta pass on.** ADR-048's #2220 amendment makes the
  delta rung's offset-paging row-skip survivable *only* because the full pass runs unchanged. `scheduler.service.ts:131-134`
  points at this issue for that policy; this plan declines it and records why in the ADR. Both gates endorsed
  the refusal.
- Any `lastObservedAt` / absence-based sweep — see § What revision 1 got wrong.
- The operator-facing rung read (revision 1 § 5). **Split out** — both gates independently recommended it. It
  shares nothing with A or B but a timestamp, and has no consumer until B exists. Filed as a follow-up.

---

## Design

### A. Route the inventory deletion through the products-context authority

`MasterProductSyncService.handleMasterDeletion` already does the right thing — stales **variants**, emits the
event, and honours the #1904 rival guard. The inventory path duplicates that shape against a different table.

The fix is for the inventory deletion path to *also* mark the variant, by delegating rather than by growing a
second write. `MasterProductSyncService.handleMasterDeletion` is `private` (`:161-198`), so this needs a public
seam on `IMasterProductSyncService` — a `markProductDeletedAtMaster(connectionId, externalId, internalProductId)`
that both paths call.

**Why delegate rather than add a `product_variants` write to the inventory service:** two independent writers
to `isStale` would each need their own copy of the #1904 rival guard and the `markedStale.length > 0` event
gate, and the two would drift. It also keeps the products context the single owner of `product_variants`,
which is the boundary rule.

**[Decision for the gates]** inventory → products is a new cross-context edge. `libs/core/src/inventory`
already imports `@openlinker/core/products` (per the § Cross-context map), and an `I*Service` is an allowed
shape, so this is legal. Confirm it introduces no module-graph cycle.

### B. `master.product.reconcile` — the pass products is missing

Structurally the inventory sweep, one context over:

- Enumerates **OL's own `Product` mappings** for the connection via
  `IdentifierMappingQueryPort.listExternalIdsByConnection(entityType, connectionId, page)` — the paged read
  #2219 added.
- Reuses `runBoundedSweep` verbatim: budget, resumable cursor, per-connection `SyncLockPort` lock. New
  `SweepKind` member `'product-reconcile'`, so keys are `master:product-reconcile:sweep:{id}` /
  `master.product-reconcile.sweep:connection:{id}`, distinct from both existing product sweeps.
- Enqueues the **existing** `master.product.syncByExternalId`. A live product re-syncs (idempotent, and cheap
  on a warm catalog); a deleted one raises `MasterProductNotFoundError` and flows into the same
  `handleMasterDeletion` A makes authoritative.

Because the child is the authority, **B needs no guards of its own**. There is no zero-observation risk (an
empty mapping enumeration enqueues nothing and stales nothing), no partial-enumeration risk (a missed mapping
is retried next cycle, never inferred as deleted), and no terminal-marker problem (a confirmed deletion stales
the variants, and the mapping is simply re-checked on later cycles — the same steady-state cost the inventory
sweep already pays).

**Its own lock**, for #2220's reason: sharing `master:product:sweep` would let the full sweep starve it.

**Cadence**: its own descriptor, slower than the sweeps — this is the deletion-detection latency, and its cost
is one platform call per mapped product per cycle. Default derived from the drain-rate rule in
`bounded-sweep.ts`, not guessed.

**[OPEN — for the gates]** should B be gated to connections with **no** `InventoryMaster`, since an
`InventoryMaster` connection already gets detection from the inventory sweep? Gating avoids doubling platform
calls on the common install; not gating is simpler and covers the #1904 rival case where inventory withholds.
Leaning: **do not gate**, default the cadence low, and document the overlap — a capability-shaped exclusion is
the kind of conditional that rots.

### C. Two defects to fix in passing

1. **`pruneSkipped` mis-reports.** `master-product-sync.service.ts:112-113` initialises it `false`; the
   zero-variant branch (`:139-143`) returns without setting it, so a skipped prune is invisible. **Do not
   widen the existing flag** — `docs/architecture-overview.md` § Products documents `pruneSkipped: true` as
   *rival-blocked*, and the worker logs it with that meaning. Add `pruneSkippedReason: 'rival' | 'empty-response' | null`
   and update the overview sentence in the same PR.
2. **§4 of the issue — verify, don't churn.** `master-inventory-sync.service.ts:105-118` already documents the
   products/inventory prune asymmetry as intentional, with the `master_inventory_empty_response_full_stale`
   warn making it observable. Both gates confirmed the AC is already satisfied. Record it in the ADR.

---

## Files

| # | File | Change |
|---|---|---|
| 1 | `libs/core/src/products/application/services/master-product-sync.service.ts` (+ its `*.service.interface.ts`) | Public `markProductDeletedAtMaster`; `pruneSkippedReason`. |
| 2 | `libs/core/src/inventory/application/services/master-inventory-sync.service.ts` | Delegate its deletion path to (1). |
| 3 | `libs/core/src/sync/domain/types/sync-job.types.ts` + `master-job-payloads.types.ts` + `index.ts` | `'master.product.reconcile'` + its payload. |
| 4 | `apps/worker/src/sync/bounded-sweep.ts` | `SweepKind` gains `'product-reconcile'`. |
| 5 | `apps/worker/src/sync/handlers/master-product-reconcile.handler.ts` | **NEW** — the B sweep. |
| 6 | `apps/worker/src/sync/{sync-worker.module.ts,handlers/handler-registration.service.ts}` | Register it. |
| 7 | `apps/api/src/sync/application/services/scheduler.service.ts` | Descriptor (+ cron key in the spec's alphabetical list — it fails every task otherwise). |
| 8 | `apps/{api,worker}/.env.example` | Enable + cron vars. |
| 9 | `docs/architecture/adrs/048-incremental-catalog-replication.md` | Amendment: what deletion authority means; the verified asymmetry; the declined cadence relaxation; **why absence-based detection was rejected** (the unordered-paging finding — it constrains #2222's successors too). |
| 10 | `docs/architecture-overview.md` | § Products / § Inventory entries; `pruneSkippedReason`. |

**No migration.** No ORM entity changes.

## Test plan

| Test | Asserts |
|---|---|
| `master-inventory-sync.service.spec.ts` | The deletion path delegates to the products authority; the #1904 rival guard still withholds; `master.product.stale` still emitted once. |
| `master-product-sync.service.spec.ts` | `markProductDeletedAtMaster` stales variants + emits; `pruneSkippedReason` is `'empty-response'` on the zero-variant skip and `'rival'` when withheld. |
| **regression spec (the bug)** | After an inventory-detected deletion, the variant is `isStale` — i.e. `StaleOfferPauseService`'s re-verification would now pass. This is the test that would have caught the shipped defect. |
| `master-product-reconcile.handler.spec.ts` | Enumerates mappings not the master; enqueues **only** `master.product.syncByExternalId`; own lock/cursor keys; budget honoured; empty enumeration stales nothing. |
| int-spec | A product deleted at a fake master ends with `product_variants.isStale` **and** its offer paused — the full #1689 chain, end to end. |

Worker int-specs are compile-checked only at int-test runtime (`lint`/`type-check` exclude `apps/worker/test`),
so `pnpm test:integration` runs before shipping, not just the unit gate.

## Open questions for the gates

1. Should B be capability-gated to connections without `InventoryMaster` (§B)?
2. Is delegating inventory → products the right direction, versus giving inventory its own `product_variants`
   write, versus moving the deletion authority to a shared seam both call?
3. Does part A alone warrant shipping ahead of B, given it fixes a live bug where deleted products keep
   selling?
