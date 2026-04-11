# Implementation Plan: Allegro Category Tree API & Category Mapping CRUD + UI

**Date**: 2026-04-11
**Status**: Draft
**Issues**: #138 (BE), #139 (FE)
**Estimated Effort**: 2–3 days

---

## 1. Task Summary

**Objective**: Enable merchants to map PrestaShop categories to Allegro categories so that offer creation can pre-populate the correct Allegro category.

**Context**: Without category mappings, merchants must manually select an Allegro category for every offer. This is a prerequisite for automated and batch offer creation (future #143).

**Classification**: CORE / Infrastructure / Interface / Frontend

---

## 2. Scope & Non-Goals

### In Scope
- Allegro category tree API endpoint (fetched live, cached in DB)
- PrestaShop category list endpoint (fetched live via webservice)
- Category mapping CRUD (per-connection, PrestaShop → Allegro)
- `resolveAllegroCategory()` method for future offer creation use
- Frontend: two-column category mapping page with tree + search
- Migration for `category_mappings` table
- Unit tests for service, repository, adapter, and FE components

### Out of Scope
- Wiring category resolution into offer creation flow (deferred to #143)
- GTIN-based auto-detection of Allegro categories (#143)
- Bulk import/export of category mappings
- Category tree full-depth pre-loading (lazy-load children only)

### Constraints
- Must follow existing mapping module patterns (`libs/core/src/mappings/`)
- Category mapping is **per-row save** (not bulk replace like status/carrier/payment)
- Allegro category tree is large (~30K nodes) — must use lazy loading with DB cache

---

## 3. Architecture Mapping

**Target Layers**:
- **CORE** (`libs/core/src/mappings/`) — CategoryMapping entity, repository port, service extension
- **Integration** (`libs/integrations/allegro/src/`) — Allegro category tree fetch method on adapter
- **Infrastructure** (`apps/api/`) — Controller endpoints, DB-cached category service, migration
- **Frontend** (`apps/web/src/`) — Category mapping page, tree component, search component

**Capabilities Involved**:
- `MarketplacePort` — extended with optional `fetchCategories?()` method
- `IPrestashopWebserviceClient` — existing `listResources('categories')` for PrestaShop categories
- `IMappingConfigService` — extended with category mapping methods

**Existing Services Reused**:
- `MappingConfigService` — add category mapping methods
- `MappingsModule` — register new entity/repository/token
- `MappingsController` — add category mapping CRUD endpoints
- `MappingOptionsController` — add category tree endpoints
- FE `mappings` feature module — extend API, hooks, components

**New Components Required**:
- `CategoryMapping` domain entity
- `CategoryMappingOrmEntity` + migration
- `CategoryMappingRepositoryPort` + `CategoryMappingRepository`
- `AllegroCategoryCacheOrmEntity` + migration (DB cache table)
- `AllegroCategoryCacheService` (thin cache-aside service in `apps/api/`)
- `MarketplacePort.fetchCategories?()` optional method
- `AllegroMarketplaceAdapter.fetchCategories()` implementation
- FE: `CategoryMappingTree`, `CategoryMappingRow`, `AllegroCategorySearch` components
- FE: `connection-category-mappings.route.tsx` page

---

## 4. External / Domain Research

### Allegro Category API
- **Endpoint**: `GET /sale/categories` — returns top-level categories
- **With parent**: `GET /sale/categories?parent.id={parentId}` — returns children
- **Response shape**: `{ categories: [{ id, name, parent: { id } | null, leaf: boolean }] }`
- **Rate limits**: Standard Allegro rate limits apply (handled by existing HTTP client retry logic)
- **Stability**: Categories change ~monthly; 24h DB cache TTL is safe
- **Size**: ~30K total categories; top-level ~20 nodes; deepest path ~6 levels

### PrestaShop Category API
- **Endpoint**: `GET /api/categories` via `IPrestashopWebserviceClient.listResources('categories')`
- **Response shape**: Each category has `id`, `name` (localized), `id_parent`, `active`, `level_depth`
- **Size**: Typically 10–500 per merchant; safe to fetch all at once

### Existing Patterns
- **Mapping entity**: `StatusMapping` — pure domain class with readonly fields
- **ORM entity**: `StatusMappingOrmEntity` — TypeORM with UUID PK, unique constraint, FK to connections
- **Repository port**: `StatusMappingRepositoryPort` — `findByConnectionId()`, `replaceForConnection()`
- **Repository impl**: Uses `@InjectRepository` + `@InjectDataSource` for transactions
- **Service**: `MappingConfigService` — delegates to repository ports via `@Inject(TOKEN)`
- **Controller**: `MappingsController` — `@Roles('admin')`, `@ApiBearerAuth()`, `@ApiTags('mappings')`
- **FE API**: `createMappingsApi(request)` factory, query key factory, TanStack Query hooks

---

## 5. Questions & Assumptions

### Assumptions
- Category mapping uses **PUT/DELETE per row** (not bulk replace like other mappings) since the tree has many nodes and merchants map one at a time
- Allegro categories are cached in a **DB table** (`allegro_category_cache`) with 24h staleness check — survives restarts, queryable for breadcrumbs
- PrestaShop categories are fetched **live per request** (small dataset, no cache needed for MVP)
- The `MarketplacePort` gets an optional `fetchCategories?()` method following the existing `listOfferEvents?()` pattern
- FE category tree uses **lazy loading** — only fetches children when a node is expanded

### Documentation Gaps
- Allegro `GET /sale/categories` response format assumed from public API docs; adapter test should verify

---

## 6. Proposed Implementation Plan

### Phase 1: Domain & Infrastructure (Category Mapping CRUD)

**Goal**: Add CategoryMapping entity, persistence, and service methods following the existing mapping pattern.

#### Step 1.1: Domain entity
- **File**: `libs/core/src/mappings/domain/entities/category-mapping.entity.ts`
- **Action**: Create `CategoryMapping` domain entity with `id`, `connectionId`, `prestashopCategoryId`, `allegroCategoryId`, `allegroCategoryName` (denormalized for display), `allegroCategoryPath` (breadcrumb string, nullable)
- **Pattern**: Follow `StatusMapping` — pure class, no framework deps

#### Step 1.2: Domain types
- **File**: `libs/core/src/mappings/domain/types/mapping.types.ts`
- **Action**: Add `CategoryMappingInput` interface: `{ prestashopCategoryId: string; allegroCategoryId: string; allegroCategoryName: string; allegroCategoryPath?: string }`

#### Step 1.3: Repository port
- **File**: `libs/core/src/mappings/domain/ports/category-mapping-repository.port.ts`
- **Action**: Define `CategoryMappingRepositoryPort` with:
  - `findByConnectionId(connectionId: string): Promise<CategoryMapping[]>`
  - `upsertMapping(connectionId: string, input: CategoryMappingInput): Promise<CategoryMapping>`
  - `deleteMapping(connectionId: string, prestashopCategoryId: string): Promise<void>`
  - `findByPrestashopCategoryId(connectionId: string, prestashopCategoryId: string): Promise<CategoryMapping | null>`

#### Step 1.4: ORM entity
- **File**: `libs/core/src/mappings/infrastructure/persistence/entities/category-mapping.orm-entity.ts`
- **Action**: Create TypeORM entity for `category_mappings` table:
  - UUID PK, `connection_id` FK (ON DELETE CASCADE), unique constraint on `(connection_id, prestashop_category_id)`
  - Columns: `prestashop_category_id`, `allegro_category_id`, `allegro_category_name`, `allegro_category_path` (nullable), timestamps

#### Step 1.5: Repository implementation
- **File**: `libs/core/src/mappings/infrastructure/persistence/repositories/category-mapping.repository.ts`
- **Action**: Implement `CategoryMappingRepositoryPort`. `upsertMapping` uses TypeORM `upsert` (INSERT ON CONFLICT UPDATE) on the unique constraint.
- **Pattern**: Follow `StatusMappingRepository` structure

#### Step 1.6: Service interface extension
- **File**: `libs/core/src/mappings/application/interfaces/mapping-config.service.interface.ts`
- **Action**: Add to `IMappingConfigService`:
  - `getCategoryMappings(connectionId: string): Promise<CategoryMapping[]>`
  - `upsertCategoryMapping(connectionId: string, input: CategoryMappingInput): Promise<CategoryMapping>`
  - `deleteCategoryMapping(connectionId: string, prestashopCategoryId: string): Promise<void>`
  - `resolveAllegroCategory(connectionId: string, prestashopCategoryId: string): Promise<string | null>`

#### Step 1.7: Service implementation
- **File**: `libs/core/src/mappings/application/services/mapping-config.service.ts`
- **Action**: Add category mapping methods. `resolveAllegroCategory` returns `allegroCategoryId` or `null`.

#### Step 1.8: DI tokens + module wiring
- **File**: `libs/core/src/mappings/mappings.tokens.ts` — add `CATEGORY_MAPPING_REPOSITORY_TOKEN`
- **File**: `libs/core/src/mappings/mappings.module.ts` — register ORM entity, repository, token binding
- **File**: `libs/core/src/mappings/index.ts` — export new types

#### Step 1.9: Migration
- **File**: `apps/api/src/migrations/{timestamp}-add-category-mapping-table.ts`
- **Action**: Create `category_mappings` table with columns, FK, unique constraint, indexes
- **Verify**: `pnpm --filter @openlinker/api migration:show`

#### Step 1.10: Unit tests
- **File**: `libs/core/src/mappings/application/services/__tests__/mapping-config.service.spec.ts`
- **Action**: Add tests for category mapping methods: upsert, delete, resolve (hit + miss)

---

### Phase 2: Allegro Category Tree Fetch + DB Cache

**Goal**: Fetch Allegro categories via the adapter and cache them in DB.

#### Step 2.1: MarketplacePort extension
- **File**: `libs/core/src/integrations/domain/ports/marketplace.port.ts`
- **Action**: Add optional method:
  ```typescript
  fetchCategories?(parentId?: string): Promise<MarketplaceCategory[]>;
  ```
- **File**: `libs/core/src/integrations/domain/types/marketplace.types.ts` (or create)
- **Action**: Define `MarketplaceCategory` type: `{ id: string; name: string; parentId: string | null; leaf: boolean }`

#### Step 2.2: Allegro API types
- **File**: `libs/integrations/allegro/src/domain/types/allegro-api.types.ts`
- **Action**: Add `AllegroCategoriesResponse` and `AllegroCategoryItem` interfaces matching the Allegro `GET /sale/categories` response

#### Step 2.3: Allegro adapter implementation
- **File**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts`
- **Action**: Implement `fetchCategories(parentId?)`:
  - Call `GET /sale/categories` with optional `parent.id` query param
  - Map to `MarketplaceCategory[]`

#### Step 2.4: Allegro adapter unit test
- **File**: `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-marketplace.adapter.spec.ts`
- **Action**: Add test for `fetchCategories` — mock HTTP client, verify mapping

#### Step 2.5: DB cache table — ORM entity
- **File**: `apps/api/src/categories/persistence/allegro-category-cache.orm-entity.ts`
- **Action**: Create ORM entity for `allegro_category_cache`:
  - Columns: `id` (PK, UUID), `connection_id`, `allegro_category_id`, `name`, `parent_id` (nullable), `leaf` (boolean), `fetched_at` (timestamptz)
  - Unique constraint: `(connection_id, allegro_category_id)`

#### Step 2.6: DB cache migration
- **File**: `apps/api/src/migrations/{timestamp}-add-allegro-category-cache-table.ts`
- **Action**: Create `allegro_category_cache` table

#### Step 2.7: Category cache service
- **File**: `apps/api/src/categories/categories-cache.service.ts`
- **Action**: `AllegroCategoryCacheService` with:
  - `getCategories(connectionId, parentId?): Promise<MarketplaceCategory[]>` — check DB cache first; if stale (>24h) or missing, fetch via adapter, store, return
  - `invalidateCache(connectionId): Promise<void>` — delete cached entries
- Injects `IntegrationsService` to resolve marketplace adapter for the connection

#### Step 2.8: Categories API module
- **File**: `apps/api/src/categories/categories.module.ts`
- **Action**: Register ORM entity, cache service, export for use in mappings/controller

---

### Phase 3: Controller Endpoints

**Goal**: Add REST endpoints for category tree browsing and category mapping CRUD.

#### Step 3.1: Allegro category tree endpoint
- **Endpoint**: `GET /connections/:connectionId/categories/allegro?parentId=`
- **File**: `apps/api/src/mappings/http/mapping-options.controller.ts` (extend existing)
- **Action**: Add `getAllegroCategories(connectionId, parentId?)` — delegates to `AllegroCategoryCacheService`
- **Response**: `AllegroCategoryResponseDto[]` — `{ id, name, parentId, leaf }`

#### Step 3.2: PrestaShop category list endpoint
- **Endpoint**: `GET /connections/:connectionId/categories/prestashop`
- **File**: `apps/api/src/mappings/http/mapping-options.controller.ts` (extend existing)
- **Action**: Add `getPrestashopCategories(connectionId)` — resolves PrestaShop adapter, calls `listResources('categories')`, maps to response DTOs
- **Response**: `PrestashopCategoryResponseDto[]` — `{ id, name, parentId, depth, active }`

#### Step 3.3: Category mapping CRUD endpoints
- **Endpoints**:
  - `GET /connections/:connectionId/mappings/categories` → list all
  - `PUT /connections/:connectionId/mappings/categories/:prestashopCategoryId` → upsert one
  - `DELETE /connections/:connectionId/mappings/categories/:prestashopCategoryId` → delete one
- **File**: `apps/api/src/mappings/http/mappings.controller.ts` (extend existing)
- **Action**: Add three methods delegating to `IMappingConfigService`

#### Step 3.4: Request/response DTOs
- **Files**: `apps/api/src/mappings/http/dto/`
  - `allegro-category-response.dto.ts`
  - `prestashop-category-response.dto.ts`
  - `category-mapping-input.dto.ts` — class-validator: `allegroCategoryId` required, `allegroCategoryName` required, `allegroCategoryPath` optional
  - `category-mapping-response.dto.ts`

#### Step 3.5: Module wiring
- **File**: `apps/api/src/mappings/mappings.module.ts` — import `CategoriesModule`
- **File**: `apps/api/src/app.module.ts` — register `CategoriesModule` if needed

---

### Phase 4: Frontend — Category Mapping UI

**Goal**: Build the two-column category mapping page.

#### Step 4.1: API types + client extension
- **File**: `apps/web/src/features/mappings/api/mappings.types.ts` — add `AllegroCategory`, `PrestashopCategory`, `CategoryMapping`, `UpsertCategoryMappingPayload`
- **File**: `apps/web/src/features/mappings/api/mappings.api.ts` — add methods:
  - `getAllegroCategories(connectionId, parentId?)` → `GET .../categories/allegro`
  - `getPrestashopCategories(connectionId)` → `GET .../categories/prestashop`
  - `getCategoryMappings(connectionId)` → `GET .../mappings/categories`
  - `upsertCategoryMapping(connectionId, prestashopCategoryId, payload)` → `PUT .../mappings/categories/:id`
  - `deleteCategoryMapping(connectionId, prestashopCategoryId)` → `DELETE .../mappings/categories/:id`
- **File**: `apps/web/src/features/mappings/api/mappings.query-keys.ts` — add `categories`, `allegroCategories`, `prestashopCategories` keys

#### Step 4.2: Query and mutation hooks
- **File**: `apps/web/src/features/mappings/hooks/use-category-mappings.ts`
  - `useCategoryMappingsQuery(connectionId)`
  - `useUpsertCategoryMapping(connectionId)` — invalidates category mappings on success
  - `useDeleteCategoryMapping(connectionId)` — invalidates category mappings on success
- **File**: `apps/web/src/features/mappings/hooks/use-allegro-category-search.ts`
  - `useAllegroCategoriesQuery(connectionId, parentId)` — lazy load children
- **File**: `apps/web/src/features/mappings/hooks/use-prestashop-categories.ts`
  - `usePrestashopCategoriesQuery(connectionId)` — full tree

#### Step 4.3: PrestaShop category tree component
- **File**: `apps/web/src/features/mappings/components/CategoryMappingTree.tsx`
- **Action**: Expandable/collapsible tree rendering PrestaShop categories. Each row shows:
  - Category name (indented by depth)
  - Mapped badge (Allegro category name) or "— not mapped —"
  - Click to select for mapping
- Props: `categories`, `mappings`, `selectedCategoryId`, `onSelect`

#### Step 4.4: Category mapping row component
- **File**: `apps/web/src/features/mappings/components/CategoryMappingRow.tsx`
- **Action**: Single row in the tree — category name, mapping status indicator, click handler

#### Step 4.5: Allegro category search component
- **File**: `apps/web/src/features/mappings/components/AllegroCategorySearch.tsx`
- **Action**: Searchable panel for browsing/selecting Allegro categories:
  - Lazy-loaded tree (expand to see children)
  - Search input with debounced filtering
  - Shows breadcrumb path for context
  - "Select" button to confirm, "Clear" to remove mapping
- Props: `connectionId`, `onSelect(category)`, `onClear`, `currentMapping`

#### Step 4.6: Category mappings page
- **File**: `apps/web/src/pages/connections/connection-category-mappings-page.tsx`
- **Action**: Two-column layout:
  - Left: `CategoryMappingTree` with PrestaShop categories
  - Right: `AllegroCategorySearch` (shown when a PrestaShop category is selected)
  - Header with summary count: "X of Y categories mapped"
  - Back link to connection detail
- Handles loading/error/empty states

#### Step 4.7: Route registration
- **File**: `apps/web/src/app/routes/connection-category-mappings.route.tsx`
  - Path: `connections/:connectionId/mappings/categories`
  - Element: `<ConnectionCategoryMappingsPage />`
- **File**: `apps/web/src/app/routes/root.route.tsx` — add to children array

#### Step 4.8: Link from connection detail
- **File**: Find connection detail page and add "Category Mappings" link alongside existing "Mapping Configuration" link

#### Step 4.9: FE tests
- **File**: `apps/web/src/pages/connections/connection-category-mappings-page.test.tsx`
- **Tests**: Tree render, search interaction, save success, save error, clear mapping, empty state, loading state

---

## 7. Alternatives Considered

### Alternative 1: Extend existing MappingPanel for categories
- **Description**: Reuse the generic `MappingPanel` component with dropdowns for source/target
- **Why Rejected**: Categories are hierarchical (tree), not flat lists. `MappingPanel` uses flat dropdowns. A tree UI is essential for navigating ~30K Allegro categories and hierarchical PrestaShop categories.

### Alternative 2: Redis-only caching for Allegro categories
- **Description**: Cache categories in Redis with TTL
- **Why Rejected**: Redis is ephemeral — categories would need re-fetching after every restart. DB cache survives restarts, is queryable for breadcrumb construction, and doesn't require Redis availability.

### Alternative 3: Store category mappings in listings module
- **Description**: Create `CategoryMapping` in `libs/core/src/listings/` as the issue suggests
- **Why Rejected**: All other mapping types live in `libs/core/src/mappings/`. Putting categories there maintains consistency and reuses the existing module infrastructure (tokens, module registration, service interface).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Follows hexagonal architecture: domain entity → port → repository → service → controller
- ✅ CORE/Integration boundary respected: adapter fetches, CORE stores mappings
- ✅ Uses existing patterns: extends `IMappingConfigService`, same token/module approach

### Naming Conventions
- ✅ Entity: `category-mapping.entity.ts` → `CategoryMapping`
- ✅ ORM: `category-mapping.orm-entity.ts` → `CategoryMappingOrmEntity`
- ✅ Port: `category-mapping-repository.port.ts` → `CategoryMappingRepositoryPort`
- ✅ Types in `mapping.types.ts`

### Risks
- **Allegro API response format**: Assumed from public docs. Mitigated by adapter unit test with fixture.
- **Large category tree performance**: ~30K nodes. Mitigated by lazy loading (children on expand) + DB cache.
- **PrestaShop category fetch via generic `listResources`**: May need field filtering. Mitigated by testing with real PrestaShop instance.

### Edge Cases
- **Orphan mappings**: If a PrestaShop category is deleted, the mapping persists. Acceptable — merchant can delete manually.
- **Stale Allegro cache**: If Allegro renames a category, the cache shows old data for up to 24h. Acceptable for MVP. Manual cache invalidation endpoint can be added later.
- **Multiple PrestaShop categories mapping to same Allegro category**: Allowed — no unique constraint on `allegro_category_id`.

### Backward Compatibility
- ✅ No breaking changes — all new endpoints and entities; existing mapping CRUD untouched

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `MappingConfigService`: category upsert, delete, resolve (hit/miss)
- `CategoryMappingRepository`: upsert (new + update), delete, findByConnectionId
- `AllegroMarketplaceAdapter.fetchCategories`: HTTP client mock, response mapping
- `AllegroCategoryCacheService`: cache hit, cache miss (fetches + stores), stale cache (re-fetches)
- FE: Tree render, search interaction, save/delete mutations, empty/loading/error states

### Integration Tests
- Category mapping CRUD via HTTP endpoints (if integration test infra supports it)

### Mocking Strategy
- Unit tests mock all ports (repository, HTTP client, adapter)
- FE tests use `createMockApiClient()` with mocked category endpoints

### Acceptance Criteria
- [ ] Allegro category tree is fetchable per connection with DB caching (24h TTL)
- [ ] PrestaShop categories are fetchable per connection
- [ ] Category mappings support create, read, update, delete per connection
- [ ] Unique constraint prevents duplicate mappings for the same PrestaShop category per connection
- [ ] `resolveAllegroCategory` returns the mapped Allegro category ID or null
- [ ] Migration exists for `category_mappings` and `allegro_category_cache`; verified via `migration:show`
- [ ] PrestaShop category tree renders with expand/collapse in FE
- [ ] Each category row shows its mapped Allegro category or an unmapped indicator
- [ ] Allegro category browsing supports lazy-loaded tree navigation
- [ ] Selecting an Allegro category saves immediately and updates the row
- [ ] Clearing a mapping removes it via the delete endpoint
- [ ] Summary count "X of Y categories mapped" is accurate
- [ ] Unit tests cover all service, repository, adapter, and FE component logic
- [ ] Quality gate passes: `pnpm lint && pnpm type-check && pnpm test`

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (extends mappings module, no new abstractions)
- [x] Idempotency considered (upsert with ON CONFLICT)
- [x] Rate limits & retries addressed (existing Allegro HTTP client handles this)
- [x] Error handling comprehensive (adapter exceptions, domain errors)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
