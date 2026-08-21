# Pre-implement analysis — reconciliation as the deletion authority (#2222)

Gate run against **revision 1** of `docs/plans/implementation-plan-reconciliation-deletion-authority.md`.

## Verdict on revision 1: **NEEDS-REVISION** (3 Critical) — plan rewritten rather than patched

A deep `/tech-review` ran in parallel and returned **Request changes**, on an overlapping but distinct basis.
Between them the plan's central premise was falsified and revision 2 abandons its design. Both reports are
preserved here because the *rejected* design is the most reusable part of this record.

## The three Criticals (pre-implement gate)

**C1 — the cycle-start instant does not exist.** `master-product-sync-all.handler.ts` mints
`newCycleId: () => randomUUID()`. `cycleId` is opaque, so "the cycle's start" was not recoverable from the
cursor, and stamping pages with each tick's own clock would have staled every row observed on an earlier page
of the same cycle — a full-catalog stale on the first cycle. (The delta handler's `pending` cycle-start cursor,
`master-product-sync-delta.handler.ts:205-232`, is the shipped pattern that would have fixed it.)

**C2 — "not observed this cycle" ≠ "deleted", because the full pass's paging is unstable.**
`PrestashopProductMasterAdapter.listExternalIds` issues no `sort`; `WooCommerceProductMasterAdapter.listExternalIds`
no `orderby`, deriving `page` from `offset` against WC's default `date DESC`. A cycle spans many ticks, so one
mid-cycle delete shifts every later row left and a **live** product is never read — then swept, zeroing its
offers via #1689. Revision 1's guards all defended against a *mass* stale; this is a single-row false positive.

**C3 — a swept candidate never becomes terminal**, so the same id would be re-selected and re-verified every
cycle forever (`handleMasterDeletion` stales variants but writes nothing to the mapping row).

## What the tech-review found independently

**The premise was false.** `master.inventory.syncAll` enumerates OL's own `identifier_mappings` (#2219), not
the master, so a deleted product is still enumerated; its child's 404 becomes `MasterProductNotFoundError` and
reaches `handleMasterDeletion` within ~15 minutes. Deletion **is** detected today.

**The real defect is narrower and is a shipped bug**: the inventory path stales `inventory_items.isStale`
(`inventory.repository.ts:228-248`) while `StaleOfferPauseService` re-verifies `product_variants.isStale`
(`stale-offer-pause.service.ts:91-96`). The #1689 chain fires end to end and no-ops at the last step — the
offers of a deleted product keep selling.

## How revision 2 resolves all of it

Correcting C2 requires *never staling on absence* — re-verify by id and let the adapter's 404 be the authority.
**That is what the inventory sweep already does.** So the deletion authority is not a new mechanism but a pass
products lacks (its sweep enumerates the master, not OL's mappings). Revision 2 therefore:

- **Part A** — routes the inventory deletion path through the products-context authority so the variant flag
  #1689 checks actually gets set. Fixes the shipped bug.
- **Part B** — adds `master.product.reconcile`, structurally the inventory sweep one context over, enqueuing
  the *existing* `master.product.syncByExternalId`.

This eliminates every Critical by construction: no absence inference (C2), so no cycle-start instant (C1) and
no terminal marker (C3) — and no migration, no `lastObservedAt`, no backfill, no guards.

## Reuse audit (still applicable to revision 2)

| Artifact | Status | Evidence |
|---|---|---|
| `runBoundedSweep` + budget/cursor/lock | **REUSE** | `apps/worker/src/sync/bounded-sweep.ts`; `SweepKind` widening is the #2220 precedent. |
| Paged mapping enumeration | **REUSE** | `IdentifierMappingQueryPort.listExternalIdsByConnection(entityType, connectionId, page?)` (#2219). |
| Per-product deletion authority | **EXISTS, `private`** | `master-product-sync.service.ts:161-198` + rival guard `:210-230` — needs a public seam. |
| Timestamp in `connection_cursors` | **PRECEDENT EXISTS** | taxonomy stores ISO `nextRunStartedAt`; `value` is `text`. (Unused by revision 2.) |
| Prune divergence (AC item 5) | **ALREADY JUSTIFIED** | `master-inventory-sync.service.ts:105-118` states the asymmetry is intentional, with an observability warn. Verify-and-record, do not churn. |
| `pruneSkipped` defect | **CONFIRMED REAL** | `:112-113` init `false`; zero-variant branch `:139-143` returns without setting it. |
| Cross-context legality | **CLEAN** | `check-cross-context-imports.mjs` allows `I*Service` + `*_TOKEN`; `master-product-sync.service.ts:18` already imports the mapping seam. |

## Warnings that survive into revision 2

- **W6** — do not widen `pruneSkipped` (documented as *rival-blocked* in the overview and logged with that
  meaning). Add `pruneSkippedReason` and update the doc in the same PR.
- **W7** — the operator read belongs in a sibling `catalog-trust`, not the connection-diagnostics DTO, which
  is a synchronous static with a live FE consumer. **Split out of this PR entirely** (both gates).
- **W10** — `check-service-interfaces` requires any new core service to `implements I*Service` with a sibling
  interface file. `check-jest-integration-mappers` will not fire. `check-migration-timestamps` is moot —
  revision 2 has no migration.
- The scheduler spec's alphabetical cron-key list must gain the new key, or **every** task fails to register
  (`Unknown alias: tru`) — the #2220 lesson.

## Endorsed as written (both gates)

The premise correction refusing AC1 literally · the declined cadence relaxation · verify-don't-churn on the
prune divergence · the `pruneSkipped` catch · `identifier_mappings` as the natural home *had* stamping been
needed.
