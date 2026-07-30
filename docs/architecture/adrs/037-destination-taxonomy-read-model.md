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
- **This is not a canonical/pivot taxonomy.** ADR-023's market scan found that *no* surveyed tool (BaseLinker, ChannelEngine, Linnworks, Sellbrite, M2E Pro, ChannelAdvisor, GoDataFeed) uses one, and rejected it. That decision stands. The projection here is **per taxonomy owner** — one row set per owning taxonomy (Allegro's tree stored once, whatever borrows it), never a merged cross-platform tree. "Neutral" describes the *row shape* (so one service spans marketplace and shop), not a unified taxonomy. Pairwise source→destination mapping remains the model.

## Decision

Model a destination's taxonomy as a **neutral, synced projection owned by the `listings` context** — the same shape as master product/inventory sync.

- Entity `DestinationCategory` — `{ taxonomyOwner: TaxonomyOwner | null, connectionId: string | null, externalId, name, parentId, leaf?, syncedAt }`. `leaf` is **optional, not dropped**: [ADR-024](./024-destination-listing-capabilities.md) deliberately gave `ShopCategory` no leaf flag because a shop accepts a product in any node while a marketplace is leaf-gated. In a projection that difference is data, not a type fork.
  - **`taxonomyOwner` is the primary key axis, not `connectionId`** — see § Borrowed taxonomies below. Keying on the connection alone is a correctness defect, not a style choice.
  - **Invariant: exactly one of `taxonomyOwner` / `connectionId` is non-null.** The discriminator is **"is this tree identical for every connection to that platform?"**:
    - **Marketplace ⇒ owner-keyed.** Allegro, Amazon, eBay and Kaufland each publish one tree that every seller shares, so two connections to the same marketplace must never duplicate it. Borrowing (Erli reading Allegro's tree) is a *second* reason to own-key, not the only one — an owner with zero borrowers is still owner-keyed.
    - **Shop ⇒ connection-keyed.** A WooCommerce store authors its own categories; two shop connections legitimately hold different trees, so the tree belongs to the connection.

    This maps onto the marketplace/shop split [ADR-024](./024-destination-listing-capabilities.md) already draws, and it is why the `leaf` flag is optional on the same entity. Both columns are therefore nullable, and uniqueness needs **two partial unique indexes** — `(taxonomyOwner, externalId) WHERE taxonomy_owner IS NOT NULL` and `(connectionId, externalId) WHERE connection_id IS NOT NULL` — the same NULL-distinct pattern `product_content_field` already uses for its master-vs-channel split.
  - `taxonomyOwner` is typed by the existing closed union `TaxonomyOwner` (`libs/core/src/listings/domain/types/taxonomy-owner.types.ts`), today `['allegro']`. A second *shared* taxonomy adds a value there; a connection-owned taxonomy needs no new value, which is precisely why the owned case keys on `connectionId` instead. Onboarding a new marketplace therefore costs one union value and a sync source — no new table, service, or code path. That is the concrete payoff over the platform-named surface this replaces, where `getAllegroCategories` would have become `getAmazonCategories` and a fifth fragment.

  - **Open (Wave 1): an owner value identifies a *tree*, which may be neither a platform nor a connection.** A single platform can publish several trees, and the granularity must be fixed before rows exist, because widening the value later is a data migration rather than a type change. The evidence differs per platform:
    - **eBay** — ~20 marketplaces, each with its own differently-structured default tree. Decisively, eBay gives the tree **its own identity**: `getDefaultCategoryTreeId(marketplace_id)` returns a `categoryTreeId` that is *not* the marketplace id, and several marketplaces may share one tree. That is precisely this ADR's `taxonomyOwner` — external confirmation that a tree is an entity distinct from both the seller account and the storefront.
    - **Amazon** — browse nodes are grouped by `marketplaceId`, and browse-tree reports take a `MarketplaceId`; trees differ per marketplace.
    - **Kaufland** — one account spans five storefronts (DE/CZ/SK/PL/AT) with a `storefront` query parameter; category ids appear to be shared across them, so storefront reads as a localisation axis rather than a distinct tree.
    - **Allegro** — operates `.pl/.cz/.sk/.hu`; whether the tree differs per country is **not established** and must be checked against the API before a second Allegro region is onboarded.

    So `taxonomyOwner: 'ebay'` would be wrong on its face, and `'allegro'` is only safe while OL targets one Allegro region. The rule to adopt: **the owner value is whatever the platform uses to identify the tree** — coarser than a connection, often finer than a platform. Since `TaxonomyOwner` is a closed union, this is a value-space decision, and the existing `'allegro'` value is the one to re-examine first.
  - **Disappearance is recorded by the `syncedAt` watermark, not by deletion.** Each sync stamps every row it observes; rows left below the run's watermark are treated as gone, so a mapping pointing at a removed category fails loudly instead of resolving to a stale node. This mirrors `IProductsService.markVariantsStaleExcept`, the established keep-set staleness sweep in `products`.
  - **`parentId` is authoritative; a breadcrumb path is *derived*.** Materialising `path` is a deferred optimisation, not part of this decision — a resumable paged sync inserts children before their ancestors exist (so it cannot be computed at insert time), renaming one node invalidates every descendant's, and a locally-built path can diverge from what `CategoryPathReader` reports live. (`CategoriesCacheService` deliberately does not DB-cache the breadcrumb — "the adapter owns caching… since a breadcrumb is a single opaque path, not a tree level" — but that reasons about *where a cache lives*, not about deriving a path from a tree we already hold, so it neither supports nor blocks this.) Wave 1 derives it (recursive CTE) and revisits materialisation only if measurement demands it. The catalogue-only source reinforces this: `AllegroCategoryCatalogClient` cannot read a category path at all, so under that source a breadcrumb **must** be built from the tree we hold — there is no live fallback.
- One service `IDestinationTaxonomyService` with **`browse(connectionId, parentId?)` and `search(connectionId, query, limit?)`**. Callers pass the *connection* they are working with — the service resolves it to a `taxonomyOwner` (via `TaxonomyBorrower` where present) and reads that owner's rows, so a borrowing destination needs no special handling at the call site. Note this makes the read path *not purely local*: `TaxonomyBorrower` lives on the adapter, so resolving connection→owner touches the integrations registry on every read. It is lazy and makes no HTTP call, but it is the obvious memoisation target and should be treated as one from the start. `search` is the new capability — the **substrate** agent-assisted mapping needs, not the matching strategy itself (see Consequences).
- Populated by a sync job whose **subject is a taxonomy owner, not a connection** — one run per owner, writing one row set that every borrowing connection reads. Reads through `CategoryBrowser` (marketplace) or `ShopCategoryBrowser` (shop); scheduled like `master.product.syncAll`. Concretely this is a new `destination.taxonomy.sync` job type — which means extending the **closed `JobTypeValues` union** in `libs/core/src/sync/domain/types/sync-job.types.ts` (a contract change to the `sync` context) and adding its handler under `apps/worker/src/sync/handlers/`. That handler is the worker's first taxonomy touch, and it is the concrete reason the read model cannot stay in `apps/api`.

  - **`SyncJob` cannot currently express an owner-scoped job.** `SyncJob.connectionId` is non-nullable (`sync-job.entity.ts`) and all ~28 existing job types are connection-scoped without exception — there is no installation-scoped job anywhere in `JobTypeValues`. This is the same defect class as `connectionId`-keying the *entity*, carried into the *job*, and it must be settled rather than discovered:
    **Target shape: `SyncJob.connectionId` becomes nullable.** This is the correct model, not a concession, and it is stated as a direction so the interim below is not mistaken for a design position:

    - A job whose subject is not a connection makes `connectionId: string` a **false statement about the row**. Typing it nullable is honesty, not a weakened invariant.
    - The catalogue-credentials source has no connection at all, so the interim cannot express it. The change is not avoided by deferring — it is paid for twice, the second time including a migration of rows already written under the old shape.
    - Encoding the subject in the payload puts a *wrong* value in the column, and it lands where it hurts most: the repository port exposes `findRecentByConnectionId`, aggregation by `(connectionId, jobType)`, and `requeueDeadJobs(connectionId, jobType)` — the operator dead-job cockpit. A taxonomy sync would be filed under whichever seller connection sourced it, group with that connection's jobs, and be swept by a bulk requeue aimed at something else.
    - A sentinel id is rejected outright: same corruption, with the lie made deliberate.

    **Sequencing.** Nullability touches ~44 lines of connection-keyed repository code plus the cockpit's grouping and requeue paths, each of which gains a null branch and a "no connection" bucket. That deserves its own issue in the `sync` context, reviewed on its own merits, **sequenced before the catalogue-source wave** — not smuggled in as an incidental detail of a taxonomy wave.

    **Interim (Wave 1, seller-connection source only).** The job stays connection-scoped with `taxonomyOwner` in the payload; the *rows* it writes are owner-keyed regardless, so nothing about the read model depends on this. "Per owner" is then a scheduling invariant — at most one in-flight run per owner, enforced by the idempotency key. This is **a scaffold with a scheduled removal**, and the false-provenance cost above is live for as long as it stands.

    Not chosen: giving `SyncJob` a polymorphic subject (`subjectType` + `subjectId`). Strictly more correct and it would cover future installation-scoped jobs cleanly, but it is a far larger refactor of the same surfaces and nothing today needs the generality. Revisit if a second installation-scoped job appears.
- **The live capability becomes the refresh path only, never the read path.**
- **A taxonomy source is an installation-level setting**, not a property of a connection — see § Borrowed taxonomies.

### Borrowed taxonomies — why `connectionId` alone is wrong

Erli has no taxonomy of its own: it accepts Allegro category ids verbatim and declares this via `TaxonomyBorrower.getBorrowedTaxonomy() → 'allegro'`. Keying the projection on `connectionId` breaks it two ways, and **both failure modes are silent**:

- **Manifest-gated sync** — Erli's manifest declares neither browse capability, so it syncs nothing and every borrowing connection reads an empty tree. [ADR-031](./031-erli-allegro-category-catalog-via-client-credentials.md) states this outright: `supportedCapabilities` "is populated from the static, per-`adapterKey` `AdapterMetadata`… It therefore cannot differ between two Erli connections."
- **Runtime-guard sync** — `isCategoryBrowser` is structural (`typeof adapter.fetchCategories === 'function'`) and `ErliOfferManagerAdapter` assigns those methods *conditionally in its constructor*, so a credentialed Erli connection passes the guard and **duplicates the entire Allegro tree once per Erli connection**.

Keying on `taxonomyOwner` resolves both: a borrowing connection reads the owner's rows, and the tree is stored once. This is the same principle #1045 already established for *mapping* resolution, where a borrowed-taxonomy destination resolves against mapping rows whose `destinationTaxonomyProvenance` column matches the owner (`AttributeMappingRepository.findByProvenance`) rather than the destination connection. `connectionId` stays, nullable, for destinations that own their taxonomy outright.

**Consequence: the taxonomy source cannot live on a connection.** An operator selling only on Erli has no Allegro connection and no reason to create one, yet still needs the Allegro tree. So the source of a taxonomy is an **installation-level setting** keyed by owner, fed either from an existing seller connection *or* from Allegro app credentials supplied purely to read the catalogue — a path that already works, because `AllegroCategoryCatalogClient` uses `client_credentials` and carries no seller context. The precedent to copy is the active-AI-provider setting (`ai_provider_active_setting` + credentials at `ref = ai-provider:{provider}`), which ships the full stack: entity, repository port, ORM entity, service, tokens, admin controller, migration, FE screen, integration test.

A "catalogue-only Allegro *connection*" was considered and is not viable: the Allegro factory rejects a connection without an access token, the adapterKey is hardcoded through the creation flow and six side-registrations, and — decisively — browse is a **sub-capability of the offer port**, so such an adapter would have to declare `OfferManager` it cannot deliver, violating the manifest contract that a plugin declares only what its factory can build.

**Why `listings` owns it**: all seven category capabilities — plus `TaxonomyBorrower`, the one this decision leans on hardest — already live in `listings/domain/ports/capabilities/`, so any other owner takes a `listings` dependency for `OfferManagerPort` + the `is*` guards. Every *reader* today is a host-app file (`apps/api`), which may import any core barrel — so this introduces **zero new cross-context edges**. Decisively, `ShopCategoryBrowseService` is already a `listings` service, and this model absorbs it; owning the model elsewhere would mean moving that service out or keeping the duplication.

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
- **First sync per taxonomy owner is non-trivial** for a thousands-of-nodes marketplace taxonomy read one parent at a time; it must be paged and resumable rather than one long walk. Its actual duration is unmeasured, so a bootstrap-on-create should not be promised until it is.
- Grows `listings`, already the largest context and the one carrying the `/services` sub-barrel carve-out (#337/#359). Offset by absorbing `ShopCategoryBrowseService` and retiring `CategoriesCacheService`: net complexity overall drops.
- A stale projection can make a *previously valid* mapping resolve to a category the destination has since removed — the sync must mark disappearance rather than silently delete, so resolution can fail loudly.
- **Search today is broken, not absent — this is a bug fix, not a new feature.** The bulk-wizard category modals already render a search field, but it filters only the *currently loaded* level, so an operator searching from the root gets nothing and concludes the category does not exist; `AllegroCategorySearch` is named for a search it does not implement. Framing `search` as a nice-to-have risks it being descoped, leaving the lie in place.
- **`search` is a substrate, not a solution — its matching strategy is an open Wave-1 decision.** Destination taxonomies are localised: Allegro's is Polish (`Stan`, `Liczba sztuk w ofercie`). An agent reasoning about an English product that calls `search(connectionId, 'shoes')` against a naive `ILIKE` over `name` gets **zero rows**, because the node is `Buty`. Workable answers exist — match on name *and* derived path, `pg_trgm` similarity, full-text, or letting the agent search the source-category name it already holds — but the choice has real consequences and is deliberately not made here. What this ADR settles is that the data is *local and queryable*; without that, no strategy is available at all. Note some platforms expose category search natively (Kaufland's `/categories/?q=`) and some do not — another reason the substrate belongs in the projection, where every owner answers the same way, rather than behind a capability only some adapters could implement.

**Migration path:**
- Additive. `allegro_category_cache` is a **cache**, so it is dropped rather than migrated — the new sync repopulates from the adapter.
- Sequence: introduce model + service → repoint every reader → delete `CategoriesCacheService`, its module/token, the ORM entity and the table.
- **"Once no reader remains" is the expensive step, and the readers are mostly frontend.** Enumerated rather than discovered:
  - `apps/api/src/mappings/http/mapping-options.controller.ts` — responses must stay byte-identical.
  - `apps/web/src/shared/ui/category-tree-browser.tsx` — the shared tree primitive, whose header names two consumers (`CategoryPicker`, `AllegroCategorySearch`).
  - `AllegroCategorySearch.tsx` — drives `useAllegroCategoriesQuery(connectionId, parentId)`; despite the name it implements **no** search, only a parent drill-down.
  - `bulk-category-choose-modal.tsx` and `shop-category-picker-modal.tsx` — each bypasses the shared primitive and holds its own level-scoped filter.
  - The `useAllegroCategoriesQuery` / path-query hooks behind all of the above.
- **Non-regression: manual category-id entry must survive.** `bulk-edit-modal.tsx` renders a manual category-id input instead of the tree picker when the destination cannot browse (covered by an existing test). This ADR *changes when that branch fires* — a borrowing Erli connection gains a browsable tree, which is the point — but the escape hatch must remain for any destination with no configured taxonomy source. Narrowing the trigger is intended; removing the fallback is a regression.

**Blocking prerequisite — [ADR-031](./031-erli-allegro-category-catalog-via-client-credentials.md) must be amended first:**

- ADR-031's Decision **names `CategoriesCacheService.getAllegroCategories` as the read path** for Erli's category browsing. Deleting that service is therefore not a local cleanup — it changes a mechanism another ADR depends on, and doing it silently would break Erli's browsing.
- The catalogue variant relocates `AllegroCategoryCatalogClient` out of `libs/integrations/erli/src/infrastructure/http/`, where ADR-031 deliberately placed it to keep Erli from importing the Allegro plugin. This looks like a dilemma and is not: under this ADR an Erli connection stops fetching a taxonomy altogether — the owner-keyed sync job populates the projection and Erli reads it — so Erli needs nothing from the client and **plugin independence is strengthened**. The duplicated OAuth/fetch logic ADR-031 lists under Cons also stops being duplicated.
- It does, however, revive an alternative ADR-031 **explicitly rejected**: a single installation-wide Allegro app credential. That rejection was scoped "for v1" and left open as a future evolution, and the reason to revisit is structural rather than deployment-driven — a tree is one object, so per-connection credentials mean N syncs and N copies of it. ADR-031's objections (per-app rate limits concentrate; rotation gains a single owner) stand and are accepted as costs.
- ADR-031's status is **Proposed** and it already carries two in-body corrections, so it is amended in place following its own convention rather than superseded. **The amendment is written** — see ADR-031 § "Third amendment".

**The two must be accepted together**, since two of this ADR's decisions (owner-keyed projection, catalogue-only source) depend on the amendment, and the amendment has no purpose without them. Both remain `Proposed`; reviewing either alone will read as under-justified.

## References

- Related issues: #1937 (this epic), #1488 (the blocked semantic half), #1834 (the shop-side neutral service), #1036
- Related ADRs: [ADR-023](./023-cross-platform-category-and-attribute-projection.md), [ADR-024](./024-destination-listing-capabilities.md), [ADR-031](./031-erli-allegro-category-catalog-via-client-credentials.md) (**blocking prerequisite** — amendment required), [ADR-033](./033-openlinker-as-mcp-server.md) (§ Phase 1 amendments — the OL-store-backed principle), [ADR-036](./036-cross-context-read-model-joins.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Listings (Offers)
