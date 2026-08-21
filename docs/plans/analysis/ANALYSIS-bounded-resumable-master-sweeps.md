# Pre-implement gate — bounded, resumable master sweeps (#2218 + #2219)

**Plan**: [`implementation-plan-bounded-resumable-master-sweeps.md`](../implementation-plan-bounded-resumable-master-sweeps.md)
**Date**: 2026-08-20
**Scope**: read-only. No plan or source edits made by this gate.

## Verdict: **NEEDS-REVISION**

Two Critical findings (one contract surface, one unbacked "no migration" claim) and four Warnings. Nothing here invalidates the approach — the shape is right and ADR-048 backs it — but three of the plan's concrete choices are wrong against the live tree, and one is a reuse miss that would have produced a second pattern where a closer one already ships.

---

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| Bounded-sweep orchestration | **PARTIAL — a closer precedent exists than the one cited** | The plan cites `destination.taxonomy.sync`. That is a *frontier-as-query* sweep (`findExpandable` re-derives remaining work from a predicate), as are `marketplace.order.fxStampSweep` and `marketplace.offer.pauseStaleSweep`. Master sweeps have **no such predicate**, so the right family is the **scan-offset** one: `IOfferStatusSyncService` / `IShopStatusSyncService` take `{ limit, offset }` and return `nextOffset`, which the worker handler persists to a cursor (`shop-status-sync.service.interface.ts:5-31` states this contract explicitly). Cite and copy *that*. |
| Page-limit clamping | **ALREADY EXISTS → reuse** | Eight sweep handlers use `Math.min(payload.limit ?? DEFAULT, MAX)` — e.g. `marketplace-order-fx-stamp-sweep.handler.ts:42-45` (`DEFAULT_LIMIT=100`, `MAX_LIMIT=500`), plus `regulatory-status-reconcile`, `offline-resubmit`, `pending-recovery`, `shop-product-status-sync`, `marketplace-offer-status-sync`. The plan's "floored, not defaulted" is only half of the shipped idiom — it must be floored **and** clamped, or a payload can request an unbounded page. |
| Scan-offset cursor | **ALREADY EXISTS → reuse** | `allegro.offerStatus.scanOffset` (#816) is the shipped naming precedent, read/written through `ISyncCursorsService`. |
| `SyncLockPort` per-connection lock | **NEW in the worker** (exists in core) | `SYNC_LOCK_TOKEN` / `SyncLockPort` exported from `@openlinker/core/sync` (`sync.tokens.ts:16`, `index.ts:22`); **no `apps/worker` file injects it today**. First worker use — fine, but it is a new DI wire in `sync-worker.module.ts`, not a free reuse. |
| `pageLimit?` on both `syncAll` payloads | **NEW (confirmed absent)** | `master-job-payloads.types.ts:21-27` — both are `{ schemaVersion: 1 }`. Additive optional ⇒ no break. |
| `runBoundedSweep` helper | **NEW (confirmed absent)** | No sweep helper exists; each handler inlines its own loop. |
| Paginated `listExternalIdsByConnection` | **PARTIAL — see C1** | `identifier-mapping.port.ts:50`. |

---

## Backward-compatibility findings

### C1 — Critical: the port change is a **plugin-facing** contract change, not a core-internal one

`IIdentifierMappingService extends IdentifierMappingPort {}` (`identifier-mapping.service.interface.ts:12`) has **no own members** — it inherits `listExternalIdsByConnection` verbatim. So the port, the service interface, the in-memory testing adapter (`testing/in-memory-identifier-mapping.adapter.ts:104-112`) and every plugin that type-depends on `IdentifierMappingPort` move together. Injection sites that type-depend (none *call* it): `woocommerce-integration.module.ts:24,126,175`, four WooCommerce adapters, `woocommerce-provisioner.types.ts:13,53`, `woocommerce-customer-provisioner.ts:26,65,218`, `erli-integration.module.ts:56,124,168`, plus the shared mock factory `prestashop/src/__tests__/mocks/mock-identifier-mapping.factory.ts:20`.

**Mitigation**: an **added optional third parameter** keeps every one of those source-compatible — the plan's stated shape is correct. What must *not* happen is changing the **return type** from `Promise<string[]>` to a page object: that breaks the sole production caller and all 11 `mockResolvedValue([...])` shape-fillers. Return `string[]` and let the caller detect "short page ⇒ done".

**Blast radius is genuinely small on the production side — exactly one caller** (`master-inventory-sync-all.handler.ts:48-51`). The promise made on #2219 (split if wide) is not triggered.

### C2 — Critical: the plan's "no migration" claim is unverified, and probably wrong if offset paging is used

Plan §5 asserts *"no ORM entity change ⇒ no migration"*. True for the entity, but the plan also requires a **stable `ORDER BY`** so an offset means the same thing across ticks — and there is **no index supporting an ordered `(entityType='Product', connectionId)` scan**:

- Entity decorators declare `(entityType, platformType, connectionId, externalId)` unique and `(entityType, connectionId, internalId)` (`identifier-mapping.orm-entity.ts:24-27`).
- Live migrations add `(entityType, platformType, connectionId, internalId)`, `(entityType, internalId)`, `(entityType, connectionId, internalId)`, and — the only ordered/keyset-shaped one — `("connectionId","createdAt" DESC,"id" DESC) WHERE "entityType" = 'Offer'` (`1833000000004-…:43-46`), **partial on `Offer`**, so it cannot serve a `Product` scan.
- `id` is a random UUIDv4 (`:30`), so `ORDER BY id` is not time-ordered; `createdAt` is unindexed (`:51`).

So an ordered page is a sort of the connection's whole `Product` partition per tick. At 20k rows that is survivable but it is a *new* recurring cost, and the plan currently claims it is free. **Decide explicitly**: (a) accept the sort and say so in the handler comment, or (b) add a partial index mirroring the `Offer` precedent — which **is** a migration, with the synthetic-timestamp rules in `docs/migrations.md` §Timestamp uniqueness invariant.

### W1 — Warning: `apps/worker/src/sync/lib/` has no precedent

`apps/worker/src` has exactly five directories (`content`, `events`, `health`, `integrations`, `sync`), and `sync/` is flat: `job-intake.consumer.ts`, `sync-job.runner.ts`, `sync-worker.module.ts`, plus `handlers/`. The only non-handler file inside `handlers/` is `handler-registration.service.ts` / `sync-job-handler.registry.ts`. Introducing `lib/` invents a layout. Put the helper at `apps/worker/src/sync/bounded-sweep.ts` (sibling of the runner) with its spec in `apps/worker/src/sync/__tests__/`, which already exists.

### W2 — Warning: composite cursor value has no precedent

Plan §3.2 proposes `{cycleId}:{offset}`. Every shipped cursor is **scalar** (`allegro.offerStatus.scanOffset`, `allegro.orders.lastEventId`, taxonomy's run watermark), and `ISyncCursorsService` documents monotonicity as the caller's responsibility. The `cycleId` is *justified* — the child idempotency key currently ends in `:{job.id}` (`master-product-sync-all.handler.ts:91`, `master-inventory-sync-all.handler.ts:82`) and a resumed tick is a different job id, so overlapping pages would re-enqueue under fresh keys — but the plan must say that a composite value is a deliberate first, and parse it defensively (it already promises this).

Cross-check that reasoning against #2039, which the plan cites: that issue's lesson is precisely *a job id is not a run identity*. The citation holds.

### W3 — Warning: two specs assert the exact call shape and will fail

- `identifier-mapping.service.spec.ts:551,577-588` asserts `findByEntityTypeAndConnection` called with exactly `('Product','conn-1')`.
- `master-inventory-sync-all.handler.spec.ts` — 7 assertion sites (`:24,52,57,69,77,90,102`), including the `product:` filter case and the DB-outage rejection case.

Both are in the plan's step 7 by implication but neither is named. The 11 shape-filler mocks only break if a **required** param is added — another reason the param must be optional.

### W4 — Warning: §3.4's AC deviation is real and should be decided, not just noted

`JobOutcomeReasonValues` holds exactly one value (`'master_deleted'`) and is FE-mirrored. The plan's reasoning for keeping "budgeted, will resume" out of `sync_jobs` is sound — it is the *healthy* steady state, and every comparable sweep (`fxStampSweep`, taxonomy, offer-status) returns a plain `outcome: 'ok'` per tick. Recommend accepting the deviation and recording it in the handler header so a later reader does not re-litigate it against the issue text.

---

## Open questions for the implementer

1. **Is the port change needed at all?** #2219's stated defect is an unbounded *read* feeding an unbounded *fan-out*. The fan-out bound is what buys the win; the read could stay whole-partition and be sliced in memory, avoiding C1 entirely. Against that: the read is genuinely unbounded (no `take`) and slicing still needs a deterministic order, so C2 applies either way. **Recommendation: keep the optional-param change** — it is source-compatible, has one production caller, and leaving a known-unbounded read in place while writing a doc that says "bounded" is the kind of half-fix ADR-048 argues against.
2. **C2's (a)-or-(b)** — accept the per-tick sort, or add a partial index + migration.
3. **Does the int-spec (step 8) belong in `apps/worker/test/integration/`** alongside `master-inventory-sync-all-e2e.int-spec.ts`, and does adding a suite there require a `jest-integration.cjs` mapper entry? (Guarded by `check-jest-integration-mappers.mjs`; no new `@openlinker/*` import is planned, so likely no.)

## `check:invariants` exposure

| Rule | Verdict |
|---|---|
| `check-cross-context-imports` | **Safe.** Handlers inject `IdentifierMappingQueryPort` (passes the `/Port$/` allow pattern) and `ISyncCursorsService` (`^I…Service$`). The deny list (`/RepositoryPort$/`) is checked first and short-circuits, and the ALLOW_LIST carries **no** entry for `apps/worker/src/sync/handlers/*` — so the implementation must not reach for `IdentifierMappingRepositoryPort` / `findByEntityTypeAndConnection` from the worker. Pagination must land on the port/service seam. |
| `check-service-interfaces` | Not applicable — no new `libs/core/**/application/services/*.service.ts`. |
| `check-migration-timestamps` | Applicable **only if** C2(b) is chosen; then the synthetic sequential prefix rules apply. |
| `check-workspace-dep-declarations` | Safe — no new `@openlinker/*` import beyond what `apps/worker` already declares. |
| Deep-barrel imports | Safe — all imports are top-level barrels. |
