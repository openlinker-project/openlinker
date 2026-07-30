# ADR-037: Destination taxonomy as a synced read model in `listings`

- **Status**: Proposed
- **Date**: 2026-07-30
- **Authors**: @piotrswierzy

## Context

"Read a destination's category taxonomy" serves four consumers — the FE category picker, category-mapping authoring, the bulk-wizard resolve chain, and (new) agent-facing MCP tools. It was never modelled as one concern, and exists as four fragments:

- `allegro_category_cache` (migration `1779000000001`) — a real persisted taxonomy, but **platform-named and in `apps/api`**, so the worker cannot reach it.
- `CategoriesCacheService.getAllegroCategories` / `getPrestashopCategories` — platform-named; **Allegro is DB-cached, PrestaShop is fetched live**.
- `CategoryBrowser.fetchCategories(parentId?)` — neutral capability with **no neutral service over it**; no marketplace tree-browse route exists at all.
- `ShopCategoryBrowser` + `ShopCategoryBrowseService` (#1834) — the shop half *did* get a neutral service.

Two constraints make this now urgent. [ADR-033](./033-openlinker-as-mcp-server.md) § Phase 1 amendments established that agent-facing reads come from OL's own store, never a live platform round-trip — and walking a tree is *N* calls, not one. And semantic category matching, the stated value of #1488, is impossible against a taxonomy you must paginate one parent at a time.

### Relationship to ADR-023 (read this before rejecting)

Two things here look like [ADR-023](./023-cross-platform-category-and-attribute-projection.md) decisions and are not:

- **ADR-023 § 0 persists *source* categories** — a `categories` JSONB column on `Product`, so a synced product can supply `sourceCategoryIds` to the resolution chain. This ADR projects the ***destination*** taxonomy: the tree an operator or agent browses to choose a target. Opposite side of the mapping, different storage, no overlap.
- **This is not a canonical/pivot taxonomy.** ADR-023's market scan found that *no* surveyed tool (BaseLinker, ChannelEngine, Linnworks, Sellbrite, M2E Pro, ChannelAdvisor, GoDataFeed) uses one, and rejected it. That decision stands. The projection here is **per connection** — one row set per destination, never a merged cross-platform tree. "Neutral" describes the *row shape* (so one service spans marketplace and shop), not a unified taxonomy. Pairwise source→destination mapping remains the model.

## Decision

Model a destination's taxonomy as a **neutral, synced projection owned by the `listings` context** — the same shape as master product/inventory sync.

- Entity `DestinationCategory` — `{ connectionId, externalId, name, parentId, leaf?, syncedAt }`. `leaf` is **optional, not dropped**: [ADR-024](./024-destination-listing-capabilities.md) deliberately gave `ShopCategory` no leaf flag because a shop accepts a product in any node while a marketplace is leaf-gated. In a projection that difference is data, not a type fork.
  - **`parentId` is authoritative; a breadcrumb path is *derived*.** Materialising `path` is a deferred optimisation, not part of this decision — a resumable paged sync inserts children before their ancestors exist (so it cannot be computed at insert time), renaming one node invalidates every descendant's, and a locally-built path can diverge from what `CategoryPathReader` reports, whose own comment argues a breadcrumb is "a single opaque path, not a tree level". Wave 1 derives it (recursive CTE) and revisits materialisation only if measurement demands it.
- One service `ITaxonomyService` with **`browse(connectionId, parentId?)` and `search(connectionId, query, limit?)`**. `search` is the new capability — it is the **substrate** agent-assisted mapping needs, not the matching strategy itself (see Consequences).
- Populated by a capability-dispatched sync job — `CategoryBrowser` (marketplace) or `ShopCategoryBrowser` (shop) — scheduled per connection like `master.product.syncAll`, plus a bootstrap enqueue on connection create.
- **The live capability becomes the refresh path only, never the read path.**

**Why `listings` owns it**: all seven category capabilities already live in `listings/domain/ports/capabilities/`, so any other owner takes a `listings` dependency for `OfferManagerPort` + the `is*` guards. Every *reader* today is a host-app file (`apps/api`), which may import any core barrel — so this introduces **zero new cross-context edges**. Decisively, `ShopCategoryBrowseService` is already a `listings` service, and this model absorbs it; owning the model elsewhere would mean moving that service out or keeping the duplication.

## Alternatives considered

- **Add a neutral marketplace `CategoryBrowseService` over the live capability**, mirroring the shop one. Rejected: the locally-sensible fix that entrenches the problem — a second neutral service over a live per-parent call, duplicating what should be one projection, and it still cannot offer `search`. It also re-adopts the live-round-trip pattern ADR-033 § Phase 1 amendments rejected.
- **Keep `CategoriesCacheService`; add PrestaShop caching and rename the methods.** Rejected: leaves a taxonomy read model in `apps/api` (worker cannot use it, not a bounded-context concern), and a per-parent lazy cache can never answer a global `search` — it only holds what has already been walked.
- **Own it in `mappings`** (taxonomy is what mappings point at). Rejected: the existing core edge is `listings → mappings`, so this adds the reverse edge and a fourth barrel-level cycle, for no gain — and still needs the `listings` guards.
- **A new `taxonomy` bounded context.** Rejected as disproportionate: one entity, one service, one repository, still dependent on `listings` for the capabilities, and it would strand `ShopCategoryBrowseService` in `listings`.
- **Materialised view / cross-context join.** Not applicable: [ADR-036](./036-cross-context-read-model-joins.md) sanctions read-only joins onto a *sibling context's table*. Here the source of truth is an external API — there is no table to join, so projecting is the only option and the refresh story is inherent rather than self-inflicted.

## Consequences

**Pros:**
- One seam for four consumers; deletes the last platform-named surface in this area, continuing the neutral direction of [ADR-023](./023-cross-platform-category-and-attribute-projection.md)/[ADR-024](./024-destination-listing-capabilities.md).
- `search` becomes **possible at all**, which is the precondition for the semantic half of #1488 (delivered as thin `*.tool.ts` files over an existing service).
- Caching stops being a separate concern — the projection *is* the cache, with a sync cursor instead of ad-hoc 24 h staleness.
- The worker gains taxonomy access. A derived breadcrumb may also let `CategoryPathReader` retire from the common path — but only once the derivation is proven against what the platform reports, so it is an outcome to evaluate, not a claimed benefit.

**Cons / trade-offs:**
- **Reads are as fresh as the last sync.** A category added upstream today is invisible until the next tick. Mitigated by an explicit refresh action — the same posture as the products cockpit's "Sync now" — not by shortening the cron.
- **First sync per connection is non-trivial** for a thousands-of-nodes marketplace taxonomy; it must be paged and resumable rather than one long walk.
- Grows `listings`, already the largest context and the one carrying the `/services` sub-barrel carve-out (#337/#359). Offset by absorbing `ShopCategoryBrowseService` and retiring `CategoriesCacheService`: net complexity overall drops.
- A stale projection can make a *previously valid* mapping resolve to a category the destination has since removed — the sync must mark disappearance rather than silently delete, so resolution can fail loudly.
- **`search` is a substrate, not a solution — its matching strategy is an open Wave-1 decision.** Destination taxonomies are localised: Allegro's is Polish (`Stan`, `Liczba sztuk w ofercie`). An agent reasoning about an English product that calls `search(connectionId, 'shoes')` against a naive `ILIKE` over `name` gets **zero rows**, because the node is `Buty`. Workable answers exist — match on name *and* derived path, `pg_trgm` similarity, full-text, or letting the agent search the source-category name it already holds — but the choice has real consequences and is deliberately not made here. What this ADR settles is that the data is *local and queryable*; without that, no strategy is available at all.

**Migration path:**
- Additive. `allegro_category_cache` is a **cache**, so it is dropped rather than migrated — the new sync repopulates from the adapter.
- Sequence: introduce model + service → repoint `mapping-options.controller` (responses byte-identical) → delete `CategoriesCacheService`, its module/token, the ORM entity and the table once no reader remains.

## References

- Related issues: #1937 (this epic), #1488 (the blocked semantic half), #1834 (the shop-side neutral service), #1036
- Related ADRs: [ADR-023](./023-cross-platform-category-and-attribute-projection.md), [ADR-024](./024-destination-listing-capabilities.md), [ADR-033](./033-openlinker-as-mcp-server.md) (§ Phase 1 amendments — the OL-store-backed principle), [ADR-036](./036-cross-context-read-model-joins.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Listings (Offers)
