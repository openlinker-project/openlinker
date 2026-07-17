# Implementation Plan: Remove inventory list page + products catalog cockpit (#1720)

Issue: https://github.com/openlinker-project/openlinker/issues/1720
Approved mockup: https://claude.ai/code/artifact/b7410ad9-7497-4ff6-bf9e-8085ced7161f

## 1. Goal & Classification

Remove the redundant `/inventory` list page (its only unique capability is cross-catalog stock
browsing) and redesign `/products` into the catalog cockpit that absorbs that capability:
aggregated stock column (server-side sort/filter), per-connection listings coverage,
KPI-tiles-as-filters, expandable per-variant drawer, 3 responsive breakpoints.

- **Layers**: Frontend (pages/features/shared CSS), Interface (products + inventory controllers,
  DTOs), Application (products list read extension, two new cross-context read methods),
  Infrastructure (products repository query).
- **Non-goals**: no schema change / migration; no changes to inventory sync or propagation; no
  removal of `GET /inventory` or `GET /inventory/availability`; no i18n migration; no DataTable
  "sortstack" feature (mockup's stacked per-label sort renders as separate sortable columns —
  documented divergence); no per-variant Allegro attribute emission.

## 2. Key research facts (verified in repo)

- Inventory list page has no unique actions; only sidebar entry links to it
  (`apps/web/src/app/nav-registry.ts:37`). `/inventory/:id` already removed (#1305/#1609).
- `GET /inventory/:id` (`apps/api/src/inventory/http/inventory.controller.ts:113`) and
  `IInventoryQueryService.getInventoryItem` have **no other callers**; FE `getById` in
  `features/inventory/api/inventory.api.ts` is dead.
- Products list flow: `ProductsController.listProducts` → `IProductsService.listProducts(filters,
  pagination)` → `ProductRepository.findMany` (query builder, search-only, hard-coded
  `createdAt DESC`, `getManyAndCount`). No sort/stock params anywhere.
- `inventory_items` (`libs/core/src/inventory/.../inventory-item.orm-entity.ts`): `productId`,
  `productVariantId`, `availableQuantity`, `reservedQuantity`, `updatedAt`.
- Offer mappings = `identifier_mappings` rows with `entityType='Offer'`, `internalId = variantId`,
  plus `connectionId`/`platformType`. Existing seams: `IOfferMappingsService.countForVariants
  (connectionId, variantIds)`; repo `countByConnectionAndVariants`.
- Cross-context contract: products may import `I*Service` + tokens from
  `@openlinker/core/inventory` / `@openlinker/core/listings`; repository ports and ORM entities are
  forbidden. `inventory → products` service dependency already exists (precedent), and
  `listings ↔ inventory` documents that barrel-level cycles are safe (interfaces + Symbol tokens).
- FE: `DataTable` already supports `expandable.renderDetail`, `manualSorting`, `cardView` (mobile
  cards with `select`/`detail`), `hideBelow` — orders-list-page (#929/#1620) is the shipped
  cockpit template, including KPI-as-filter `.orders-segment` buttons and `Chip` filter rows.
- `VariantStockTable` (product detail) already renders per-variant stock + listings counts with an
  expandable listings subtable — direct reuse target for the drawer.
- Offer-creation connection filter precedent (products-list-page:86-96): `status === 'active' &&
  supportedCapabilities.includes('OfferCreator')` (fine-grained, NOT coarse `OfferManager`, so
  quantity-only WooCommerce write-back connections are excluded). The cockpit uses the same set.
- KPI/nav-count precedent: no `/stats` endpoints; counts come from `limit=1` list probes reading
  `.total` (`use-nav-counts.ts`).
- `route-lazy.test.ts:70`: `EXPECTED_LAZY_ROUTE_COUNT = 50` → 49 after removing the inventory index
  route.

## 3. Design

### 3.1 Backend — products list read extension

**Query params** (`ListProductsQueryDto`): add
- `sort?: 'name' | 'sku' | 'price' | 'createdAt' | 'updatedAt' | 'stock'` (default `createdAt`)
- `dir?: 'asc' | 'desc'` (default `desc`)
- `stock?: 'out' | 'low' | 'oversold'`
- `unlistedOn?: string` — CSV of connection ids; matches products having ≥1 variant with no
  `Offer` mapping for **at least one** of the given connections (backs both the per-channel chip
  — single id — and the "Listing gaps" KPI — all active OfferCreator connection ids).
- `connectionId?: string` — source filter: product has a `Product` identifier mapping for this
  connection.

**Stock semantics** (shared constant `LOW_STOCK_THRESHOLD = 5`, mirroring FE
`DEFAULT_LOW_STOCK_THRESHOLD`): `total = COALESCE(SUM(availableQuantity), 0)` across the product's
inventory rows; `out` ⇔ `total = 0` (products with no inventory rows count as out), `low` ⇔
`0 < total ≤ 5`, `oversold` ⇔ `total < 0`.

**Where the SQL lives — the design fork, resolved:**
- Server-side sort/filter by stock across the full result set with offset pagination **must**
  happen inside the products page query. Cross-context *service composition* cannot do that
  (aggregates are per-variant/per-connection and post-hoc), and cross-context *imports* of
  inventory ORM entities/ports into the products repository are forbidden.
- Resolution: `ProductRepository.findMany` gains **table-name-string subqueries** (TypeORM
  `qb.leftJoin((sub) => sub.select(...).from('inventory_items','ii')..., 'stock', ...)` and an
  `EXISTS` subquery on `product_variants` × `identifier_mappings` for `unlistedOn` /
  `connectionId`). No sibling-context imports — the import contract stays intact; this is a
  read-model reporting query, explicitly commented as such. (Alternative — new inventory-side
  "ordered product-id page" service — rejected: cannot combine with name/SKU search + offset
  pagination without id-set intersection across contexts.)
- **Display enrichment stays on sanctioned service seams** (page-scoped, ≤20 ids):
  - NEW `IInventoryQueryService.getProductStockAggregates(productIds)` →
    `{ productId, totalAvailable, totalReserved, stockUpdatedAt }[]` (own-context grouped query in
    `InventoryRepository`).
  - NEW `IOfferMappingsService.countListedVariantsByProducts(productIds)` →
    `{ productId, connectionId, platformType, listedVariants }[]` (own-context grouped query in
    `OfferMappingRepository` joining `product_variants` by table name — same read-model note).
  - Variant counts per product: own-context grouped query in `ProductRepository`
    (`countVariantsByProductIds`).
  - Source external ids: controller `Promise.all(identifierMapping.getExternalIds('Product', id))`
    for the page (20 indexed lookups; existing detail-path precedent).

**Response DTO** (`ProductResponseDto`, list path): add optional
`totalAvailable`, `totalReserved`, `stockUpdatedAt`, `variantCount`,
`listingsCoverage: Array<{ connectionId, platformType, listedVariants }>`, `externalIds`
(now populated on list items too).

**Wiring** (revised per pre-implement gate — see
`docs/plans/analysis/ANALYSIS-implementation-plan-products-cockpit.md`): core `ProductsModule`
gains **no** sibling imports (`InventoryModule` and `ListingsModule` already import
`ProductsModule` — adding the reverse edge would create Nest module cycles; no core module uses
`forwardRef` and we don't introduce the first). Instead:
- Page SQL (stock sort/filter subqueries, `unlistedOn`/`connectionId` EXISTS, variant counts)
  stays inside the products context (`ProductRepository`).
- Display enrichment composes at the **interface layer**: `apps/api/src/products/products.module.ts`
  additionally imports `CoreInventoryModule` + the listings services module
  (`@openlinker/core/listings/services`), and `ProductsController` injects
  `IInventoryQueryService` / `IOfferMappingsService` via their Symbol tokens — mirroring how it
  already injects `IdentifierMappingPort` for the detail path. `ProductsService.listProducts`
  signature only gains the new optional filter/sort fields.
- DB note: columns are camelCase (tables snake_case) — raw subquery fragments must quote
  identifiers (`inventory_items."availableQuantity"`).

### 3.2 Backend — removals

- `GET /inventory/:id` handler + `IInventoryQueryService.getInventoryItem` (interface + impl) +
  its `describe` block in `inventory.controller.spec.ts`. Keep `InventoryRepository.findById` only
  if another caller exists (verify at implementation; remove if orphaned).

### 3.3 Frontend — removals

- Delete `pages/inventory/inventory-list-page.tsx` + `.test.tsx` (directory).
- Delete `app/routes/inventory.route.tsx`; remove import + `coreChildren` entry in
  `root.route.tsx`; `EXPECTED_LAZY_ROUTE_COUNT` 50 → 49 (+ breakdown comment).
- Remove `/inventory` nav item (`nav-registry.ts:37`).
- Remove `inventory` from `use-nav-counts.ts` (field, import, probe, return) + test assertions.
- Remove dead `getById` from `features/inventory/api/inventory.api.ts` (keep everything else in
  `features/inventory` — used by product detail, wizards).

### 3.4 Frontend — products cockpit (template: orders-list-page)

`pages/products/products-list-page.tsx` rebuild:

- **Server state**: extend `ProductFilters` (`search`, `stock`, `unlistedOn`, `connectionId`) +
  `sort`/`dir` in `products.api.ts buildQuery`; switch DataTable to `manualSorting` with
  `sort`/`dir` URL params (orders `SORT_KEY_TO_COLUMN` pattern).
- **KPI tiles as filters** (4): Products (no filter), Out of stock (`stock=out`), Low stock
  (`stock=low`), Listing gaps (`unlistedOn=<all active OfferCreator connection ids>`). Counts via
  `limit=1` probes (nav-counts precedent) with dedicated query keys. Buttons reuse the
  orders-segment mechanic — new `.products-segments`/`.products-segment` CSS mirroring
  `index.css` orders section (kept page-namespaced like orders; generalizing is out of scope).
- **Filter rail**: search (placeholder extended to "name, SKU or EAN" only if BE search covers EAN
  — it does not today; keep "name or SKU" placeholder, note as follow-up), stock `Chip`s
  (out/low/oversold), per-connection "Unlisted on {name}" chips (active OfferCreator connections
  only), source `Select` (connections list). All URL-synced.
- **Columns**: select · Product (thumb + name + SKU sub, sortable `name`) · Source (channel-pill
  from `externalIds[0]` + connection name, `hideBelow: 1024`) · Stock (total available mono +
  `StatusBadge` from `product-stock-status.ts` incl. new oversold handling + reserved sub,
  sortable `stock`) · Listings (coverage pills + `+ Create offers` CTA) · Price (sortable,
  `hideBelow: 480`) · Updated (`TimeDisplay`, sortable `updatedAt`, `hideBelow: 1024`).
- **Coverage pills**: new page-local `ListingsCoveragePills` component: for each active
  OfferCreator connection, `listedVariants/variantCount` pill (`cov--full/partial/none` CSS, new
  bounded section) — strictly connection-driven; labels by connection name when >1 connection of a
  platform. Row CTA `+ Create offers` shown when any active connection has a gap; deep-links via
  existing `goToWizard` (single product preselect).
- **Expandable drawer** (`expandable.renderDetail`): new `ProductRowDetail` (page-local) that
  lazily fetches `useProductQuery(id)` + `useInventoryQuery({ productId })` on mount and renders
  the existing `VariantStockTable` (unchanged reuse — per-variant stock, EAN, listings subtable)
  plus a links strip (Product details → `/products/:id`, Edit content → `?view=content`).
- **Mobile cards**: `cardView` with `select`, badges (stock badge + coverage pills) via `meta`,
  and `detail` reusing `ProductRowDetail`.
- **Oversold**: extend `product-stock-status.ts` with an `oversold` status (total < 0, error tone)
  — additive, product-detail continues to work.
- Bulk select + `BulkActionBar` + `MarketplacePickerModal` carry over unchanged.

### 3.5 Tests

- BE: controller spec (new params pass-through + DTO mapping), products service spec (composition
  incl. empty aggregates), repository — extend existing spec if unit-mockable; the SQL paths get
  one focused integration spec **only if** an existing products repo int-spec harness exists
  (resource-constrained machine — no new heavy suites; otherwise unit-test the query-builder
  branch wiring and rely on CI).
- FE: rewrite `products-list-page.test.tsx` (states, KPI probe wiring, chip → URL params, coverage
  gating incl. "Allegro-only install shows no other channel", CTA deep-link, sort params);
  `use-nav-counts.test.tsx` update; `route-lazy` count bump; new small tests for
  `ListingsCoveragePills` + oversold in `product-stock-status`.

## 4. Step-by-step

1. **BE removals**: drop `GET /inventory/:id` + service method + spec block.
2. **BE cross-context reads**: `getProductStockAggregates` (inventory), 
   `countListedVariantsByProducts` (listings) — interface + impl + repo queries + specs + barrel
   exports (types in `*.types.ts`).
3. **BE products list**: DTO params, repo `findMany` subqueries (sort/filter), variant counts,
   service composition, controller mapping + `externalIds`, response DTO fields, specs.
4. **FE removals** (§3.3) + route/nav-count test updates.
5. **FE api layer**: `ProductFilters`/`buildQuery`/types/query-keys extension.
6. **FE cockpit page** (§3.4) + CSS sections (`.products-segments`, coverage pills) + token check.
7. **FE tests** (§3.5), then quality gate: `pnpm lint`, `pnpm type-check`, scoped `pnpm test`.

## 5. Validation

- Architecture: no cross-context ORM/repository-port imports (table-name-string subqueries keep
  the import contract; commented as read-model reads); new methods ride `I*Service` seams with
  Symbol tokens; `check:invariants` (service-interface + cross-context walkers) must pass.
- Naming: `*.types.ts` for new shapes; `*.dto.ts` for DTO changes; tokens in `<ctx>.tokens.ts`
  (none new needed — existing service tokens reused).
- No migration required (read-only queries; no entity changes).
- Security: all new params validated in DTO (`@IsIn`, `@IsString`, CSV length cap on
  `unlistedOn`); query builder parameters only (no interpolation).
- Risks: (a) reviewer pushback on table-name subqueries — mitigated by comment + this plan;
  (b) `identifier_mappings` grouped query perf — indexed by `(entityType, internalId)` reverse
  index; page-scoped; (c) products page now fires KPI probes (4 extra cheap queries) — matches
  nav-counts precedent.
