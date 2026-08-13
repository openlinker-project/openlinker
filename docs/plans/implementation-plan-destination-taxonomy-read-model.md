# Implementation Plan — Destination taxonomy read model (Wave 1)

- **Issue**: #1979 (Wave 1 of epic #1937)
- **ADR**: [ADR-037](../architecture/adrs/037-destination-taxonomy-read-model.md) (merged, `32e20408`)
- **Gate**: [ANALYSIS-adr-037-destination-taxonomy-wave-1.md](./analysis/ANALYSIS-adr-037-destination-taxonomy-wave-1.md) — `READY`
- **Type**: CORE (+ a `sync` contract change and a worker handler)
- **Migration**: yes — `destination_categories`, next free synthetic prefix `1833000000000`

---

## 1. Goal

Replace the four unrelated taxonomy fragments with one **neutral, core-owned, synced projection** of a destination's category tree, exposing `browse` and `search` through a single service. Wave 1 ships the model, the service, and the sync job. It repoints no consumer and deletes nothing.

### Non-goals (explicit)

- Repointing `mapping-options.controller` or any FE reader (Wave 2).
- Deleting `CategoriesCacheService` / `allegro_category_cache` (Wave 3).
- The `browse_categories` / `search_categories` MCP tools (Wave 4).
- Category **parameters** — `CategoryParametersReader` is untouched (ADR-037 § Scope).
- The installation-level catalogue-credentials taxonomy source (blocked on #1943).
- Bootstrap-on-connection-create (ADR-037: first-sync duration is unmeasured, so it must not be promised).
- Semantic matching itself — Wave 1 ships the searchable substrate only.

---

## 2. Decisions this plan makes

Two points where the issue body and ADR-037 do not agree, plus one the ADR left to the implementation.

### D1 — `path` is derived on read, not materialised (follows the ADR)

ADR-037 § Decision rejects materialisation with a reason that still holds: a resumable paged sync inserts children before their ancestors exist, so `path` cannot be computed at insert time; a rename invalidates every descendant's; and a locally-built path can diverge from what `CategoryPathReader` reports live. #1979's body assumes materialisation.

**Plan: derive.** `search` matches `name` via a `pg_trgm` index and derives the breadcrumb for the ≤`limit` matched rows with one recursive CTE. This keeps the ADR's contract, removes the ordering problem entirely, and costs one CTE over at most `limit` (default 20) rows.

**Cost accepted:** the query `"odziez buty"` will not match on the ancestor's name. Deferred as a measured follow-up (materialising later is additive — a column plus a post-sync pass — and needs no data migration).

### D2 — `search` matching: `pg_trgm` over an app-normalised `search_text` column (no `unaccent` extension)

Postgres ships no Polish text-search dictionary before PG 19 and the repo pins `postgres:16-alpine`, so stemmed FTS would push a custom Hunspell dictionary onto every self-hosted deployment for near-zero gain on 1–3-word labels. Trigram similarity handles substring + diacritics + typos with no per-language configuration.

**But the issue's literal "`pg_trgm` + `unaccent`" does not index.** `unaccent(text)` is declared `STABLE`, not `IMMUTABLE` (it depends on a mutable dictionary), so Postgres rejects it in an index expression; a GIN index on raw `name` cannot serve a `unaccent(name) % $1` predicate either, leaving every search a sequential scan with a per-row function call. The documented workaround is an `IMMUTABLE` wrapper function — which lies to the planner and silently corrupts the index if the dictionary is ever changed.

**Plan: normalise in application code into a persisted `search_text` column** — lowercase + NFD diacritic strip (`String.normalize('NFD').replace(/\p{Diacritic}/gu, '')`), written at sync time, with `GIN (search_text gin_trgm_ops)`. The query string is normalised by the same exported pure helper, so the two halves cannot drift.

This is strictly better than the wrapper: no non-`IMMUTABLE` function in an index, one fewer extension to require on a self-hosted Postgres (`pg_trgm` only), identical semantics, and the normaliser is unit-testable without a database. It keeps the AC's intent (diacritic-insensitive trigram search) while dropping a mechanism that would not have worked.

**Revised during implementation — the predicate is `LIKE`, not the `%` similarity operator.** Writing the code surfaced a second, decisive constraint the planning pass missed: the integration harness builds its schema with `synchronize` and runs **no migrations** (`docs/testing-guide.md`), so `pg_trgm` does not exist under test. The `%` operator would therefore *error outright* there rather than merely running slower. `searchText LIKE '%…%'` is accelerated by the same `gin_trgm_ops` index in production and degrades to a sequential scan — not a failure — wherever the extension is absent. Correctness no longer depends on any extension, which also retires the "verify `unaccent` immutability" risk entirely rather than deferring it.

**Also surfaced by a test:** NFD does not decompose `ł` (U+0142 is a distinct letter, not a base plus a combining mark), so the normaliser needs an explicit fold map or `artykuly` never matches `Artykuły` — one of the most common words in a Polish taxonomy.

The cross-language gap (`search('shoes')` vs the node `Buty`) is **not** solved by any lexical method — it is a sync-time concern (`Accept-Language`), filed as **#2059**, not papered over here.

### D3 — Connection→owner resolution is capability-driven, never a `platformType` switch

`TaxonomyBorrower` only tells us about a *borrower* (Erli). Nothing declares that an Allegro connection *owns* `'allegro'`. Resolution order, mirroring the MCP `resolveDestinationContext` precedent (probe `OfferManager`, then `ProductPublisher`):

1. Adapter resolves as `OfferManager` **and** `isTaxonomyBorrower` ⇒ owner-keyed at `getBorrowedTaxonomy()`.
2. Adapter resolves as `OfferManager` **and** `isCategoryBrowser` ⇒ owner-keyed, owner = `connection.platformType` **validated against `TaxonomyOwnerValues`** (a membership check, not a switch — an unlisted platform throws rather than silently writing a bad owner).
3. Adapter resolves as `ProductPublisher` **and** `isShopCategoryBrowser` ⇒ connection-keyed (`taxonomyOwner: null`).
4. Otherwise ⇒ `TaxonomySourceUnavailableException`.

Memoised per connection id from the start (ADR-037 flags this as the obvious memoisation target), with the cache invalidated on nothing in Wave 1 — a connection's kind does not change without a restart-level config change.

### `TaxonomyOwnerValues` stays `['allegro']`

Resolved in #1979 against Allegro's own developer portal: the category tree and parameters are **shared across all Allegro marketplaces** (.pl/.cz/.sk/.hu), published as one tree in multiple languages. The evidence goes in a comment on `taxonomy-owner.types.ts` so the next reader does not re-open it. The ADR's rule — one value per distinct tree — is unchanged and still binds eBay (`'ebay:EBAY_US'`) and Amazon.

---

## 3. Design

### 3.1 Domain (`libs/core/src/listings/domain/`)

**`types/destination-category.types.ts`**

```ts
/** Resolved read scope — exactly one member is non-null (ADR-037 invariant). */
export type TaxonomyScope =
  | { taxonomyOwner: TaxonomyOwner; connectionId: null }
  | { taxonomyOwner: null; connectionId: string };

/** A search hit plus its derived root→leaf breadcrumb (D1). */
export interface DestinationCategorySearchHit {
  category: DestinationCategory;
  path: CategoryPathSegment[];
}

/** Sync-time write shape. `searchText` is NOT here — the repository derives it. */
export interface DestinationCategoryUpsert {
  externalId: string;
  name: string;
  parentId: string | null;
  leaf: boolean | null;
}
```

**One read shape, not two.** There is no parallel `DestinationCategoryNode` interface: the repository port *and* the service both return the `DestinationCategory` **domain entity** (`engineering-standards.md` § ORM ↔ Domain Mapping — application services work with domain entities). `leaf` is `boolean | null` everywhere (that is what the column yields under `strictNullChecks`), never `leaf?: boolean`.

**`entities/destination-category.entity.ts`** — anemic readonly class per ADR-011, fields `{ taxonomyOwner, connectionId, externalId, name, parentId, leaf, syncedAt }`. **`searchText` is deliberately absent** — it is a pure infrastructure derivation for the trigram index, and `toDomain` drops it. Exposing it would leak the normalisation strategy into every consumer, including Wave 4's MCP projection.

**`ports/destination-category-repository.port.ts`**

```ts
export interface DestinationCategoryRepositoryPort {
  browse(scope: TaxonomyScope, parentId: string | null): Promise<DestinationCategory[]>;
  search(scope: TaxonomyScope, query: string, limit: number): Promise<DestinationCategorySearchHit[]>;
  upsertMany(scope: TaxonomyScope, nodes: DestinationCategoryUpsert[], syncedAt: Date): Promise<number>;
  /** Watermark sweep — rows below `syncedAt` are gone upstream (ADR-037). */
  deleteStaleBelow(scope: TaxonomyScope, syncedAt: Date): Promise<number>;
}
```

No `countForScope` — nothing in §4 calls it, and the port carries only what application services need.

**`exceptions/taxonomy-source-unavailable.exception.ts`** — thrown by resolution step 4.

### 3.2 Application

**`interfaces/destination-taxonomy.service.interface.ts`** + **`services/destination-taxonomy.service.ts`**

```ts
export interface IDestinationTaxonomyService {
  browse(connectionId: string, parentId?: string): Promise<DestinationCategory[]>;
  search(connectionId: string, query: string, limit?: number): Promise<DestinationCategorySearchHit[]>;
  /** Refresh path — the ONLY caller of the live capability. Pure w.r.t. persistence of progress. */
  syncTaxonomy(connectionId: string, input: TaxonomySyncInput): Promise<TaxonomySyncResult>;
  resolveScope(connectionId: string): Promise<TaxonomyScope>;
}
```

`browse` / `search` touch the repository only. A spec asserts the integrations service is consulted **for scope resolution alone** and that neither `fetchCategories` nor `browseCategories` is ever called on a read (the issue's "reads never call the destination live" AC).

`search` clamps its `limit` to `SEARCH_LIMIT_MAX` (100, default 20). Wave 4 exposes this as an MCP tool, so `query` and `limit` are untrusted input — an unclamped limit is a trivial memory-pressure vector.

**Paged, resumable sync — the service does not own the cursor.** Per the review's BLOCKING finding, `listings` may not import `ConnectionCursorRepositoryPort` from `@openlinker/core/sync` (`*RepositoryPort` is a cross-context deny shape). The **worker handler** owns cursor I/O, exactly as `ShopProductStatusSyncHandler` does; the core method is a pure function of the frontier handed to it:

```ts
interface TaxonomySyncInput  { frontier: TaxonomyFrontier | null; pageLimit?: number }
interface TaxonomySyncResult { nextFrontier: TaxonomyFrontier | null; upserted: number; removed: number; completed: boolean }
interface TaxonomyFrontier   { runStartedAt: string; pending: (string | null)[] }
```

Breadth-first over unexpanded parents, bounded per run by `pageLimit` (default 500 nodes expanded):

- `frontier === null` ⇒ start a run: `runStartedAt = now`, pending `[null]` (roots).
- `frontier !== null` ⇒ resume, reusing the stored `runStartedAt` as the watermark so a multi-tick run sweeps against one consistent value.
- Pending drained ⇒ `deleteStaleBelow(scope, runStartedAt)`, return `nextFrontier: null` + `completed: true`.

The handler persists `nextFrontier` under cursor key `destination.taxonomy.frontier` (clearing it on `completed`). This also makes resumability unit-testable with no cursor double.

A marketplace node with `leaf: true` is not expanded. Shop nodes carry `leaf: null` and are always expanded (a shop tree is small).

**Observability of non-termination.** `deleteStaleBelow` only fires when the frontier drains, so a tree that grows faster than `pageLimit` would never sweep — precisely the stale-projection failure ADR-037 § Consequences warns about. Each run logs `pending.length` so the condition is visible before it becomes a wrong mapping resolution.

### 3.3 Infrastructure

- `entities/destination-category.orm-entity.ts` — `@Entity('destination_categories')`, both scope columns nullable.
- `repositories/destination-category.repository.ts` — **every** statement binds its inputs as `$n` parameters (no interpolation, per CLAUDE.md § Security baselines), matching `MASTER_UPSERT_SQL`. `upsertMany` uses `INSERT … ON CONFLICT (…) WHERE <index predicate> DO UPDATE`, branched per scope column. This is **exactly** the `ProductContentFieldRepository` pattern (`MASTER_UPSERT_SQL` / `CHANNEL_UPSERT_SQL`): a partial unique index requires its predicate in the conflict target, and the single-round-trip upsert is what makes the sync concurrency-safe by construction rather than racing a find-then-save. `search` runs `search_text % $1` ordered by `similarity` desc, then one recursive CTE over the hit ids to build breadcrumbs; errors converted to domain errors.
- Migration `1833000000000-add-destination-categories-table.ts`, **hand-authored** (the two partial unique indexes are not emitted by `migration:generate`), copying `1789000000000-add-product-content-field-table.ts`. Creates `pg_trgm` via `CREATE EXTENSION IF NOT EXISTS` (the `uuid-ossp` precedent), `GIN (search_text gin_trgm_ops)`, and a `(scope, parent_id)` index per scope column for `browse`.

### 3.4 Sync wiring

| Site | Change |
|---|---|
| `libs/core/src/sync/domain/types/sync-job.types.ts` | `'destination.taxonomy.sync'` added to `JobTypeValues`; `DestinationTaxonomySyncPayloadV1 { schemaVersion: 1; taxonomyOwner: TaxonomyOwner \| null; pageLimit?: number }` |
| `apps/worker/src/sync/handlers/destination-taxonomy-sync.handler.ts` | Thin delegate — modelled on `ShopProductStatusSyncHandler`; returns `{ outcome: 'ok' }`, wraps failures in `SyncJobExecutionError` |
| `apps/worker/src/sync/sync-worker.module.ts` | provider |
| `apps/worker/src/sync/handlers/handler-registration.service.ts` | import + ctor + `handlerRegistry.register(...)` |
| `apps/api/src/sync/application/services/scheduler.service.ts` | new task (see below) |
| `apps/api/.env.example` | `OL_TAXONOMY_SYNC_ENABLED`, `OL_TAXONOMY_SYNC_CRON` |
| `apps/api/test/integration/setup.ts` | `ENABLED: 'false'` |

**Scheduling — one job per owner (the interim scaffold).** The generic `registerCapabilityTask` helper cannot express this: its `idempotencyKey` builder is sync over a `connectionId`, but the dedup subject is the *owner*, which only an async adapter probe can resolve. So this task is registered bespoke, alongside the `CORE_CAPABILITY_TASKS` loop:

- `connectionFilter` lists `OfferManager` + `ProductPublisher` connections (`lazy: true`), resolves each to a scope, **elects one connection per owner** (lowest id — deterministic) and keeps every shop connection.
- `generateIdempotencyKey` / `generatePayload` read the resolved scope for that connection: `taxonomy:owner:${owner}:sync:${ts}` or `taxonomy:connection:${id}:sync:${ts}`.
- `defaultCron: '23 * * * *'` — an unused minute offset (existing: `*/15`, `*/20`, `*/30`, `17`, `0 3`).

**The three callbacks must not communicate through an implicitly-ordered closure.** `connectionFilter`, `generatePayload`, and `generateIdempotencyKey` are invoked separately by `executeTask` → `enqueueJobForConnection`, and `SchedulerTaskConfig` guarantees no ordering between them. A shared mutable `Map` populated by the filter and read by the key builder therefore has a silent failure mode with an outsized blast radius: a miss yields `undefined` inside the key, collapsing **every owner's** job onto one key so all but one sync is dropped as a duplicate. The scope map is instead built inside the filter and read through a lookup that **throws** on a miss, so the failure is loud and local rather than a silently-skipped sync.

Election is what actually prevents an N-connection fan-out; the idempotency key only collapses same-minute duplicates. Both are kept — the key is the ADR's stated invariant, the election is the mechanism.

`connectionId` on the row remains the elected *source* connection — the documented false-provenance cost of the interim, removed by #1943. A code comment at the descriptor names #1943 so it cannot drift.

### 3.5 Barrels & module

- `listings.tokens.ts`: `DESTINATION_TAXONOMY_SERVICE_TOKEN`, `DESTINATION_CATEGORY_REPOSITORY_TOKEN`.
- `listings/index.ts`: entity, types, port, exception (contracts only — the service class stays on `/services`, per #337/#359).
- `listings.module.ts`: `TypeOrmModule.forFeature([DestinationCategoryOrmEntity])` + both providers.
- **No `listings/orm-entities` sub-barrel.** Int-tests seed through the repository, which avoids adding a `libs/core/package.json` export (gate § `listings` sub-barrel).

---

## 4. Steps

1. `taxonomy-owner.types.ts` — add the shared-tree evidence comment. *(AC: value set unchanged, evidence recorded)*
2. Types + domain entity + repository port + exception. The exception is a **domain** exception (`domain/exceptions/`), not `UnprocessableEntityException` — a deliberate divergence from `ShopCategoryBrowseService`, which throws a `@nestjs/common` exception from an application service. The file header says so, so it is not "harmonised" back later.
   Plus the pure normaliser (`domain/destination-category-search.ts`, mirroring `shipping/domain/pickup-point-query.ts`) with its own `*.spec.ts` — it is the one piece both the write and the read path depend on agreeing about.
3. ORM entity + hand-authored migration `1833000000000`; `pnpm --filter @openlinker/api migration:show` clean.
4. Repository + `*.spec.ts` (`upsertMany` conflict targets, `deleteStaleBelow` scope isolation).
5. Service interface + `DestinationTaxonomyService` (`resolveScope` memoised) + `*.spec.ts` covering: borrowing Erli → `'allegro'`; two Allegro connections → one scope; WooCommerce → connection-keyed; unlisted platform → throws; **reads never call the live capability**.
6. Tokens, barrel, module wiring.
7. `JobTypeValues` + payload type.
8. Worker handler + `*.spec.ts`; both registration sites.
9. Scheduler task + `.env.example` + integration-harness disable.
10. Int-spec: seed two Allegro connections, run the sync twice against a fake browser, assert one row set, resumability across a `pageLimit` boundary, watermark deletion of a vanished node, and a root-level `search` returning a deep category (the bug fix).
11. Docs: `architecture-overview.md` § Listings paragraph; ADR-037 in-body amendment recording D1/D2/D3 (ADR-031's amend-in-place convention).
12. File the locale-aware-sync (`Accept-Language`) follow-up issue — filed as **#2059**. *(AC)*
13. Quality gate: `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm test:integration`, `pnpm check:invariants`.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Deviating from a merged ADR on `path` (D1) | Deviation is *toward* the ADR and away from the issue body; recorded as an in-body ADR amendment, and materialisation stays additive |
| `pg_trgm` / `unaccent` unavailable on a self-hosted PG | Both are core contrib modules, present in `postgres:16-alpine`; created with `IF NOT EXISTS` like `uuid-ossp` |
| First Allegro sync is long (thousands of nodes) | Paged + resumable by construction; no bootstrap-on-create is promised |
| Scheduler elects a connection whose credentials later fail | Election is per tick, so the next tick elects a different connection; the failure surfaces as an ordinary dead job |
| Erli's `fetchCategories` is conditionally assigned | Resolution probes the guard at run time and falls through to `TaxonomySourceUnavailableException`, which the sync logs and skips |
