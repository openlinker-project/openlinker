# Pre-implement gate — implementation-plan-destination-taxonomy-read-model

- **Gated**: 2026-08-13
- **Subject**: [the plan](../implementation-plan-destination-taxonomy-read-model.md), issue #1979, [ADR-037](../../architecture/adrs/037-destination-taxonomy-read-model.md)
- **Supersedes**: [ANALYSIS-adr-037-destination-taxonomy-wave-1.md](./ANALYSIS-adr-037-destination-taxonomy-wave-1.md) (2026-07-30, gated the ADR because no plan existed; its two blocking preconditions are now resolved in #1979's body)

## Verdict: `NEEDS-REVISION` — one Critical, mechanical to fix

Every artifact the plan creates is confirmed absent, and the plan's three design decisions hold up. One design detail breaks the cross-context contract and must move before code is written; the fix is a known precedent, not a redesign.

---

## Critical

### C1 — `ConnectionCursorRepositoryPort` may not be imported from `libs/core/src/listings/**`

The plan has `DestinationTaxonomyService` persist its resumable frontier through `ConnectionCursorRepositoryPort` (`@openlinker/core/sync`). `*RepositoryPort` is an explicit **deny** shape for cross-context imports (`scripts/check-cross-context-imports.mjs:24` — "repository ports are intra-context; cross-context callers go through `I*Service`"), and `listings` holds no allow-list entry for it. This fails `pnpm check:invariants`, i.e. `pnpm lint`, i.e. the pre-commit hook.

Two sanctioned fixes:

- **(a) The worker handler owns the cursor — recommended.** This is verbatim the `ShopProductStatusSyncHandler` shape (`apps/worker/src/sync/handlers/shop-product-status-sync.handler.ts:39-63`): the handler injects the cursor repository, reads the offset, calls the core service with it, and writes back `result.nextOffset`. The core service becomes a pure function of `(connectionId, frontier, pageLimit) → { nextFrontier, runStartedAt, completed }` — which is also *more* testable, since resumability can then be unit-tested with no cursor double.
- **(b) Inject `ISyncCursorsService`** (`SYNC_CURSORS_SERVICE_TOKEN`). It exists precisely for this — its own header states "the service is the seam, not a repository port" (`libs/core/src/sync/application/services/sync-cursors.service.ts:6`). Legal (`listings → sync` is an existing edge) but it puts persistence orchestration inside the read-model service for no gain over (a).

**Take (a).** It also keeps the core service free of any sync-context dependency, so the plan's "zero new cross-context edges" claim stays literally true.

---

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `DestinationCategory` entity / `destination_categories` | **NEW** | No hit anywhere in `libs/`, `apps/` |
| `DestinationCategoryRepositoryPort` | **NEW** | — |
| `IDestinationTaxonomyService` / `DestinationTaxonomyService` | **NEW** | Only `resolveDestinationCategory` (`MappingConfigService`) matches the grep — a mapping *resolution* read, unrelated |
| `TaxonomyScope`, `DestinationCategorySearchHit` | **NEW** | — |
| `TaxonomySourceUnavailableException` | **NEW** | — |
| `DESTINATION_TAXONOMY_SERVICE_TOKEN`, `DESTINATION_CATEGORY_REPOSITORY_TOKEN` | **NEW** → append to existing file | `listings.tokens.ts` (61 tokens); nearest neighbours `CATEGORY_RESOLUTION_SERVICE_TOKEN`, `SHOP_CATEGORY_BROWSE_SERVICE_TOKEN` |
| `destination.taxonomy.sync` job type | **NEW** → extends closed union | `JobTypeValues` (31 entries) |
| `DestinationTaxonomySyncPayloadV1` | **NEW** → standalone file | No payload union to extend; payloads are per-file interfaces re-exported from `sync/index.ts` (`shop-job-payloads.types.ts:110`) |
| Worker handler | **NEW** | No taxonomy handler in `apps/worker/src/sync/handlers/` |
| `TaxonomyOwner` / `TaxonomyOwnerValues` | **EXISTS → reuse unchanged** | `listings/domain/types/taxonomy-owner.types.ts` — plan only adds an evidence comment |
| `isTaxonomyBorrower` / `isCategoryBrowser` / `isShopCategoryBrowser` | **EXISTS → reuse** | `listings/domain/ports/capabilities/` |
| Diacritic-stripping normaliser | **NEW**, with a pattern to mirror | `libs/core/src/shipping/domain/pickup-point-query.ts:29` is the precedent for a pure domain-layer normaliser (zero framework imports) — but its `normalizeField` only lowercases + collapses whitespace, it does **not** strip diacritics, so there is nothing to reuse, only a shape to copy |
| Partial-index upsert | **EXISTS → copy verbatim** | `ProductContentFieldRepository` `MASTER_UPSERT_SQL` / `CHANNEL_UPSERT_SQL` — `ON CONFLICT (…) WHERE <predicate> DO UPDATE`, branched per scope. The plan already names this |

---

## Backward-compatibility findings

No **Critical** contract breaks: nothing is removed or renamed on a `@openlinker/core/<ctx>` barrel, no `*Port` signature changes, no Symbol token is deleted.

| Surface | Severity | Finding |
|---|---|---|
| `JobTypeValues` | **Warning (low)** | Additive to a closed union. Verified safe: there is **no** `Record<JobType, …>` anywhere, so no exhaustiveness site breaks. Both DTO validators (`enqueue-sync-job.dto.ts`, `retry-grouped-sync-jobs.dto.ts`) derive from the array, so the new type becomes API-enqueueable automatically |
| FE job-type list | **Warning (low)** | `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts:59` is an independent hand-maintained subset. Not a break — but the new job will not appear in `TriggerSyncDialog` until a later wave. Acceptable because the API accepts it immediately, so ADR-037's "explicit refresh action" staleness mitigation is reachable by operators via `POST /sync/jobs` from day one, ahead of its UI |
| ORM schema | **Warning** | New table ⇒ migration. Next free synthetic prefix confirmed **`1833000000000`** (tail on `main` is `1832000000008`). Hand-author: neither the two partial unique indexes nor the GIN trigram index is emitted by `migration:generate` |
| `listings` sub-barrel | **Warning** | `listings` still has **no** `orm-entities` sub-barrel. The plan's decision to seed int-tests through the repository is what avoids adding a `libs/core/package.json` export — hold that line |
| `check-service-interfaces` | **Warning** | Satisfied by `implements IDestinationTaxonomyService` + a sibling `*.service.interface.ts` |
| `check-cross-context-imports` | **Critical** | See C1 |
| `scheduler.service.ts` | **Warning** | The plan registers a bespoke task outside the `CORE_CAPABILITY_TASKS` loop. Legal — `this.tasks.push` is how plugin-contributed tasks already arrive — but it is the **first core task not expressible as a descriptor**, so it needs a comment explaining why (async owner resolution vs the sync `idempotencyKey(connectionId, timestamp)` signature) or a later reader will "tidy" it back into the loop and silently restore per-connection duplicate syncs |

---

## Open questions

1. **`unaccent` immutability is reasoned, not measured.** Docker was down during planning, so D2's claim that `unaccent()` cannot be indexed rests on documented Postgres behaviour. The plan's mitigation (an int-spec asserting `EXPLAIN` shows an index scan) is the right shape — but it must be written as a *failing-if-wrong* assertion, not a smoke test. Low risk: the chosen design (app-normalised column) is correct **regardless** of how the `unaccent` question resolves, so this can only cost a simplification, never a rewrite.

2. **D1 contradicts #1979's acceptance criteria in writing.** The plan derives `path`; the issue's AC says "`search` matches on `name` **and** materialised `path`". The plan follows ADR-037, which is the stronger authority and gives reasons that still hold. This is a legitimate resolution — but it must be recorded as an ADR-037 in-body amendment *and* as a comment on #1979, or a reviewer checking the ACs will read it as an unexplained miss. **Not a blocker; a documentation obligation.**

3. **Scheduler election picks one connection per owner — no tie-break test is specified.** "Lowest id" is deterministic, but if the elected Allegro connection is `disabled` mid-tick or its credentials fail, the tree simply doesn't refresh that hour. That is acceptable (next tick re-elects), but it should be asserted, not assumed — otherwise a single broken connection can silently freeze the taxonomy for every borrowing Erli connection.
