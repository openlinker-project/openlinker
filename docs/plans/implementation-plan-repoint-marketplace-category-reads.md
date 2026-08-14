# Implementation Plan — repoint the marketplace category reads (#2074)

- **Issue**: #2074 (Wave 2a of epic #1937)
- **ADR**: [ADR-037](../architecture/adrs/037-destination-taxonomy-read-model.md)
- **Type**: Interface (+ one CORE addition)
- **Migration**: **no**

---

## 1. Goal

`IDestinationTaxonomyService` ships `browse` + `search` over `destination_categories`,
but **nothing reads it**. Point the marketplace category reads at it, and add the
neutral marketplace routes that do not exist.

### Non-goals

- `GET destination/categories` — see § 3.1. Stays on `CategoriesCacheService`.
- Deleting `CategoriesCacheService` / `allegro_category_cache` (Wave 3).
- FE work — #2075, blocked on the routes this issue adds.
- Locale-aware sync (#2059).

---

## 2. What the three routes actually do

Verified, not assumed — the epic's one-line bullet hides a fork.

| Route | Service call | Capability | Live? |
|---|---|---|---|
| `source/categories` | `getAllegroCategories` | `CategoryBrowser` (via `OfferManager`) | DB-cached, 24 h TTL |
| `source/categories/:id/path` | `getAllegroCategoryPath` | `CategoryPathReader` | **live** (adapter-cached) |
| `destination/categories` | `getPrestashopCategories` | **`ProductMaster`** | **live**, uncached |

Note the vocabulary trap: in this controller **`source` is the marketplace** and
**`destination` is the master shop** — the opposite of ADR-023's mapping
direction. The routes are keyed on the marketplace connection (#1784), so the
repoint must not "helpfully" swap them.

---

## 3. Design

### 3.1 `destination/categories` is out of scope, and that is a finding not a punt

It resolves **`ProductMaster`**, but `DestinationTaxonomyService.resolveDestination`
probes `OfferManager` → `ProductPublisher` only. A master-catalog tree is a
**third** taxonomy kind the projection does not model. Its DTO also carries
`depth` and `active`, which `DestinationCategory` has no column for — so the
epic's "byte-identical responses" AC is **unachievable** for this route without
extending the model.

Taking **option (A)** from the issue: leave it. The consequence must be recorded
rather than discovered later — **Wave 3 cannot delete `CategoriesCacheService`**,
because this route still reads it.

### 3.2 `source/categories` → `browse`

`IDestinationTaxonomyService.browse(connectionId, parentId?)` already resolves
scope (owner-keyed marketplace, borrower-aware for Erli). The controller stops
knowing about platforms.

**One type mismatch to decide, not paper over.** `AllegroCategoryResponseDto.leaf`
is `boolean`; `DestinationCategory.leaf` is `boolean | null` (null is the *shop*
case — ADR-024). On a marketplace scope the sync always writes a boolean, so
`null` is unreachable here. Map it as `leaf: category.leaf ?? false` **with a
comment saying why the fallback is unreachable**, rather than silently coercing.

### 3.3 `source/categories/:id/path` → a new `path()` on the service

This route is a **read that hits the platform live**. ADR-037's defining property
is that reads do not. So repointing it is in scope, not scope creep.

The repository already derives breadcrumbs for search hits with a recursive CTE
(`BREADCRUMB_SQL`). Add:

```ts
// IDestinationTaxonomyService
path(connectionId: string, externalId: string): Promise<CategoryPathSegment[]>
```

backed by a repository `findPath(scope, externalId)` reusing that CTE. Returns
`[]` for an unknown id — the same "not synced yet" posture `browse` has.

**This does not retire `CategoryPathReader`.** That capability still serves the
offer-build path, and Wave 3 owns the retirement question. This narrows it to one
route.

### 3.4 New neutral marketplace routes

Mirror the shop sibling (`GET /listings/connections/:id/shop-publish/categories`,
`shop-publish.controller.ts:105`) — same shape, same error vocabulary
(404 / 409 / 422):

- `GET /listings/connections/:connectionId/taxonomy/categories?parentId=`
- `GET /listings/connections/:connectionId/taxonomy/categories/search?q=&limit=`

**Not** under `shop-publish` (these serve marketplaces too) and **not** reusing
the `source`/`destination` words, which are pairing-specific and do not
generalise. `taxonomy` matches the service and the table.

### 3.5 `ShopCategoryBrowseService` delegation is DEFERRED — it would regress a shipped picker

The issue asks for it and the epic lists it. **Verification says not yet.**

`ShopCategoryBrowseService` does a *live* `browseCategories`, so the shop publish
category picker (#1830, shipped) is always instantly populated. Delegating it to
the projection makes it return **empty until the taxonomy has synced** — and
there is **no bootstrap-on-connection-create**: the only enqueue point is the
hourly `destination-taxonomy-sync` scheduler task (`scheduler.service.ts:521`).
Wave 1's epic AC listed a bootstrap enqueue; it never shipped.

So a newly created WooCommerce connection would show an empty picker for up to an
hour, where today it works immediately. That trades a working operator surface
for a cleaner internal shape — the wrong direction.

**Deferred**, with two follow-ups filed rather than silently dropped:

1. bootstrap-on-connection-create for `destination.taxonomy.sync` (the missing
   Wave 1 AC — it is what makes any projection-backed read safe on a fresh
   connection);
2. the delegation itself, gated on (1).

The AC on #2074 is amended to match. Note the marketplace routes this issue *does*
repoint are not exposed to the same regression: their only consumer today is the
mappings page, and the FE search work (#2075) is not yet wired — so the staleness
window is visible to nobody until #2075 lands, by which time (1) can be in.

### 3.6 `TaxonomySourceUnavailableException` must map to 422 — required by the new routes

It extends bare `Error` and has **no HTTP mapping anywhere in `apps/api`**, so a
connection with no taxonomy source currently surfaces as a **500**. The shop
sibling returns **422** for the analogous "adapter cannot browse" case
(`shop-publish.controller.ts:120`), and the new routes must match it.

Map it at the controller boundary — catch and rethrow as
`UnprocessableEntityException` — rather than adding a global exception filter:
one route family needs it, and core must not import `@nestjs/common` to throw
HTTP types (a rule `ShopCategoryBrowseService` already bends, which is not a
precedent worth extending).

### 3.7 The search route needs a validated query DTO

Two concrete bugs follow from skipping it, beyond the standards requirement
(`engineering-standards.md § Validation`):

- `limit` arrives from the query string as a **string**;
- an **empty `q` becomes `LIKE '%%'`**, matching every row in the scope and
  returning an arbitrary `limit`-sized slice — a "search" that silently means
  "give me anything".

`TaxonomySearchQueryDto`: `q` required with a minimum length, `limit` optional
`@Type(() => Number) @IsInt() @Min(1)`. The service still clamps at 100; the DTO
is the boundary, not a replacement for it.

---

## 4. Steps

1. **CORE** — `path()` on `IDestinationTaxonomyService` + `findPath` on the
   repository port + impl (reuse `BREADCRUMB_SQL`).
2. **API** — new `taxonomy.controller.ts` under `apps/api/src/listings/http/`
   with the browse + search routes, their response DTOs, and
   `TaxonomySearchQueryDto` (§ 3.7). Map `TaxonomySourceUnavailableException`
   to 422 (§ 3.6).
3. **API** — register the controller in `listings.module.ts` (an unregistered
   Nest controller 404s at runtime while compiling clean) and add it to
   `write-guard-coverage.spec.ts`'s `CONTROLLERS` — read-only today, but that
   spec exists to fail a *future* write handler added without `@Roles`.
4. **API** — repoint `source/categories` and `source/categories/:id/path` in
   `mapping-options.controller.ts`; drop the now-unused `CategoriesCacheService`
   injection **only if** `destination/categories` no longer needs it (it does, so
   the injection stays — narrowed to one method).
5. **Specs** — controller unit specs for the new routes; service spec for `path`;
   a spec asserting the repointed reads never invoke `fetchCategories` /
   `fetchCategoryPath`.
6. **Int-spec** — extend `destination-taxonomy.int-spec.ts` with `findPath`
   against real Postgres (root, mid-tree, unknown id).
7. **Docs** — `architecture-overview.md` § Listings: Wave 2a landed, and the
   `destination/categories` residual recorded on #1937.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| A never-synced connection now returns `[]` where the old cache lazily filled from the platform | **Behaviour change, and the significant one.** The old path fetched on demand; the new one shows only what the sync has walked. Call it out in the PR; #2075 renders the distinct empty state. A connection created before the sync existed has no rows until the hourly tick. |
| `leaf ?? false` hides a real null | Unreachable on a marketplace scope (§ 3.2); commented, and the DTO keeps `boolean` so FE contracts do not move. |
| Response drift on repointed routes | Int-spec asserts shape equality against the current DTOs. |
| `search` route is agent-reachable in Wave 4 | `limit` is already clamped at 100 in the service; the route must not widen it, and the DTO (§ 3.7) rejects an empty `q` that would otherwise match everything. |
| Deferring § 3.5 leaves `ShopCategoryBrowseService` on a live read | Deliberate, and the follow-ups are filed. A working picker beats an architecturally tidier empty one. |

---

## 6. Review outcome

The § 6 question (add `path()` now vs defer) was answered **add it** — and the
gate then found it is cheaper than costed: `loadBreadcrumbs(scope, hitIds[])`
already exists privately in the repository, so `findPath` is a thin public
wrapper with **no new SQL**.

The deep review changed two things: § 3.5 is deferred (it would regress a shipped
picker), and § 3.6 / § 3.7 were added (the new routes are unusable without the
422 mapping, and unvalidated without the query DTO).
