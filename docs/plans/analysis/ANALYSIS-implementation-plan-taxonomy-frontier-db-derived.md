# Pre-implement gate — DB-derived taxonomy frontier (#2061)

- **Gated**: 2026-08-13
- **Subject**: [the plan](../implementation-plan-taxonomy-frontier-db-derived.md), issue #2061, [ADR-037](../../architecture/adrs/037-destination-taxonomy-read-model.md)
- **Base**: `8c64e325` (#2065, merged today)

## Verdict: `READY`

No reuse collisions. No Critical break that isn't compile-loud and in-repo. One
**design correction** to the plan (§ Reuse, row 5) and one risk **downgraded to
none** by a live check.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `expandedAt` column/field | **NEW** | Zero hits across `libs/` + `apps/` |
| `findExpandable` / `markExpanded` | **NEW** | Zero hits |
| `taxonomy-sync-lock.ts` + key builder | **NEW** | Zero hits; two precedents to mirror (`order-create-lock.ts`, `shipment-dispatch-lock.ts`) |
| `SyncLockPort` | **EXISTS → reuse** | `sync/application/ports/sync-lock.port.ts` — `acquire(key, ttlMs)` / `release(key, token)`; `orders` is the reference consumer |
| `expandedAt` on the **domain entity** | **PLAN CORRECTION** | Step 2 adds it to `DestinationCategory` + `DestinationCategoryLike`. It should not: `findExpandable` needs only `externalId`, and the file's own `searchText` precedent keeps index/bookkeeping fields off the domain shape ("an index-serving derivation, not domain data"). Keep `expandedAt` **ORM-only**. |
| Migration slot `1833000000001` | **FREE** | `origin/main` tail is `1833000000000`; strictly greater, satisfies the ordering invariant |

## Backward-compatibility findings

| Surface | Severity | Finding |
|---|---|---|
| `TaxonomyFrontier` — **removed** from the `listings` barrel | **Warning** | Removing an exported type is Critical by the letter of the checklist, but every consumer is in-repo (barrel, service, types, worker handler — 4 files, all edited here) and it shipped one day ago in #2062. Unlike #2063's arity reduction, deletion is **compile-loud**: a missed consumer fails the build rather than silently misbehaving. That makes this the safer of the two shapes. |
| `TaxonomySyncInput` / `TaxonomySyncResult` — reshaped | **Warning** | 5 consumers, all in-repo (adds the service interface + the handler spec). Also compile-loud. |
| `DestinationCategoryRepositoryPort` — 2 methods added | **Warning (low)** | Additive; one implementation. The int-spec binds through a structural `TaxonomyRepositoryHandle` (narrower than the port), so it is unaffected by additions — the #2062 workaround for the cross-context repository-port ban pays off again here. |
| ORM schema | **Warning** | New column ⇒ migration required. Planned, with `down()`. |
| `ListingsModule` ← `SYNC_LOCK_TOKEN` | **None** *(was the main integration risk)* | `listings.module.ts:17,186` **already imports `SyncModule`**, which exports `SYNC_LOCK_TOKEN` (`sync.module.ts:48`). The lock needs **zero module wiring** — inject and go. |
| Cross-context import of `SyncLockPort` | **None** | Single-`Port` suffix is an allowed cross-context shape, and `orders` already imports it from `@openlinker/core/sync`. `check-cross-context-imports` will pass. |
| FE / DTO mirrors | **None** | `apps/web` hits for `taxonomyOwner` are all in the *mappings* provenance context (#1045), untouched here. No FE reference to `destination_categories`. |

## Open questions

1. **`syncedAt = runStartedAt` exact equality is the linchpin of the whole
   derivation.** Both sides originate from one JS `Date` bound as a parameter, so
   it should hold — but the plan is right to pin it in the int-spec rather than
   in a unit test with a mocked repository, because a mock cannot falsify a
   round-trip precision assumption.

2. **The lock TTL is single-shot with no heartbeat** (the `order-create-lock`
   precedent is explicit about this). A page of `pageLimit` browses is many
   seconds of HTTP; if the TTL expires mid-run, a second run starts and the
   behaviour degrades to exactly today's overlap — which stamp-after-browse
   already tolerates. Pick the TTL with that headroom in mind and say so in the
   file header, as the precedent does.

3. **The empty-root-response hazard is pre-existing and stays out of scope**, but
   this refactor moves the code that contains it. State in the PR that it was
   seen and deliberately not fixed, so the next reader does not read silence as
   "nobody noticed".

## Suggested ordering

1. Migration + ORM entity (ORM-only `expandedAt`, per the correction above).
2. Types reshape — take the compile errors as the to-do list.
3. Repository port + impl (`findExpandable` / `markExpanded`).
4. Service loop, then worker handler.
5. Lock (last — it wraps a loop that should already be correct without it).
6. Specs, int-spec, then docs.
