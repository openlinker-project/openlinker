# ADR-037: Destination taxonomy as a synced read model in `listings`

- **Status**: Proposed
- **Date**: 2026-07-30
- **Authors**: @piotrswierzy

## Context

"Read a destination's category taxonomy" serves four consumers — the FE category picker, category-mapping authoring, the bulk-wizard resolve chain, and (new) agent-facing MCP tools. It was never modelled as one concern, and exists as four fragments:

- `allegro_category_cache` (migration `1779000000001`) — a real persisted taxonomy with `parent_id`, `leaf`, 24 h staleness — but **platform-named and in `apps/api`**, so the worker cannot reach it.
- `CategoriesCacheService.getAllegroCategories` / `getPrestashopCategories` — platform-named; **Allegro is DB-cached, PrestaShop is fetched live** and returns `[]` when the adapter lacks the method.
- `CategoryBrowser.fetchCategories(parentId?)` — neutral capability with **no neutral service over it**; there is no marketplace tree-browse route at all.
- `ShopCategoryBrowser` + `ShopCategoryBrowseService` (#1834) — the shop half *did* get a neutral service.

Two constraints make this now urgent. [ADR-033](./033-openlinker-as-mcp-server.md) § Phase 1 amendments established that agent-facing reads come from OL's own store, never a live platform round-trip — and walking a tree is *N* calls, not one. And semantic category matching, the stated value of #1488, is impossible against a taxonomy you must paginate one parent at a time.

## Decision

Model a destination's taxonomy as a **neutral, synced projection owned by the `listings` context** — the same shape as master product/inventory sync.

- Entity `DestinationCategory` — `{ connectionId, externalId, name, parentId, leaf?, path?, syncedAt }`. `leaf` is **optional, not dropped**: [ADR-024](./024-destination-listing-capabilities.md) deliberately gave `ShopCategory` no leaf flag because a shop accepts a product in any node while a marketplace is leaf-gated. In a projection that difference is data, not a type fork. `path` is materialised at sync time.
- One service `ITaxonomyService` with **`browse(connectionId, parentId?)` and `search(connectionId, query, limit?)`**. `search` is the new capability, and the one that makes agent-assisted mapping viable.
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
- `search` becomes possible, unblocking the semantic half of #1488 (delivered as thin `*.tool.ts` files over an existing service).
- Caching stops being a separate concern — the projection *is* the cache, with a sync cursor instead of ad-hoc 24 h staleness.
- The worker gains taxonomy access; a materialised `path` removes `CategoryPathReader` from the common path.

**Cons / trade-offs:**
- **Reads are as fresh as the last sync.** A category added upstream today is invisible until the next tick. Mitigated by an explicit refresh action — the same posture as the products cockpit's "Sync now" — not by shortening the cron.
- **First sync per connection is non-trivial** for a thousands-of-nodes marketplace taxonomy; it must be paged and resumable rather than one long walk.
- Grows `listings`, already the largest context and the one carrying the `/services` sub-barrel carve-out (#337/#359). Offset by absorbing `ShopCategoryBrowseService` and retiring `CategoriesCacheService`: net complexity overall drops.
- A stale projection can make a *previously valid* mapping resolve to a category the destination has since removed — the sync must mark disappearance rather than silently delete, so resolution can fail loudly.

**Migration path:**
- Additive. `allegro_category_cache` is a **cache**, so it is dropped rather than migrated — the new sync repopulates from the adapter.
- Sequence: introduce model + service → repoint `mapping-options.controller` (responses byte-identical) → delete `CategoriesCacheService`, its module/token, the ORM entity and the table once no reader remains.

## References

- Related issues: #1937 (this epic), #1488 (the blocked semantic half), #1834 (the shop-side neutral service), #1036
- Related ADRs: [ADR-023](./023-cross-platform-category-and-attribute-projection.md), [ADR-024](./024-destination-listing-capabilities.md), [ADR-033](./033-openlinker-as-mcp-server.md) (§ Phase 1 amendments — the OL-store-backed principle), [ADR-036](./036-cross-context-read-model-joins.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Listings (Offers)
