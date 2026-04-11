# Implementation Plan: Products & Variants Read API (#82 + #83)

**Date**: 2026-04-10  
**Status**: Ready for Review  
**Estimated Effort**: 4–6 hours  
**Branch**: `82-83-products-variants-read-api`

---

## 1. Task Summary

**Objective**: Expose canonical product and product variant data to the frontend via REST API endpoints.

**Context**: The products domain already has full persistence (entities, ORM entities, repositories, services) but no HTTP interface. The frontend needs read access to products, variants, and their external identifier mappings for the products explorer (#88) and offer mapping workbench (#92).

**Classification**: Interface (controllers, DTOs) + CORE extension (repository pagination)

**Issues**: [#82](https://github.com/SilkSoftwareHouse/openlinker/issues/82), [#83](https://github.com/SilkSoftwareHouse/openlinker/issues/83)

---

## 2. Scope & Non-Goals

### In Scope
- `GET /products` — paginated product list with filters (name, SKU search)
- `GET /products/:id` — single product detail with its variants
- `GET /products/:productId/variants` — paginated variants for a product
- `GET /variants/search` — search variants by SKU, EAN, or GTIN across all products
- External identifier mappings included in detail responses
- Unit tests for controller and service read methods

### Out of Scope
- Product write operations (create, update, delete) — existing service handles upsert via sync
- Integration tests — deferred to #80
- Frontend pages — deferred to #88
- Inventory data in product responses — deferred to #84
- Product images serving/CDN — not needed for read API

### Constraints
- Follow sync jobs read API pattern exactly (offset pagination, DTO shape, Swagger decorators)
- No database migration needed (read-only against existing tables)
- External IDs lookup uses existing `IdentifierMappingPort.getExternalIds()`

---

## 3. Architecture Mapping

**Target Layers**:
- **CORE domain** — extend `ProductRepositoryPort` and `ProductVariantRepositoryPort` with `findMany` pagination methods
- **CORE application** — extend `IProductsService` with read methods
- **App interface** — new `apps/api/src/products/` HTTP module (controller + DTOs)

**Capabilities Involved**: 
- `ProductRepositoryPort` (existing, extend)
- `ProductVariantRepositoryPort` (existing, extend)
- `IdentifierMappingPort` (existing, read-only usage)

**Existing Services Reused**:
- `ProductsService` / `IProductsService` — extend with read methods
- `IdentifierMappingPort.getExternalIds()` — for external ID enrichment
- `ProductsModule` — already exports all needed tokens

**New Components Required**:
- `apps/api/src/products/` — HTTP module, controller, DTOs
- `libs/core/src/products/domain/types/product.types.ts` — add pagination/filter types
- Extensions to existing ports, repository implementations, and service

**Core vs Integration Justification**: This is purely an interface + CORE persistence extension. No integration boundary is crossed — we read from the internal product store, not from external platforms.

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure)

---

## 4. Internal Patterns

### Reference Implementation: Sync Jobs Read API
The sync jobs read API (`apps/api/src/sync/`) is the exact pattern to follow:

| Sync Jobs Pattern | Products Equivalent |
|---|---|
| `SyncJobFilters` in `sync-job.types.ts` | `ProductListFilters` in `product.types.ts` |
| `SyncJobPagination` in `sync-job.types.ts` | `Pagination` in `product.types.ts` |
| `PaginatedSyncJobs` in `sync-job.types.ts` | `PaginatedProducts`, `PaginatedProductVariants` |
| `SyncJobRepositoryPort.findMany()` | `ProductRepositoryPort.findMany()` |
| `SyncController.listJobs()` | `ProductsController.listProducts()` |
| `ListSyncJobsQueryDto` | `ListProductsQueryDto` |
| `PaginatedSyncJobsResponseDto` | `PaginatedProductsResponseDto` |
| `SyncJobResponseDto` | `ProductResponseDto`, `ProductVariantResponseDto` |

### Key Pattern Details (from `apps/api/src/sync/http/sync.controller.ts`)
- Controller injects repository ports directly via Symbol tokens
- Query DTO uses `class-validator` + `class-transformer` with `@Type(() => Number)` for pagination
- Response DTO is a plain class with `@ApiProperty` decorators and `!` assertions
- Domain-to-DTO mapping is a private `toDto()` method on the controller
- Pagination response shape: `{ items, total, limit, offset }`
- Class-level decorators: `@Roles('admin')` + `@ApiBearerAuth()` + `@ApiTags()`

---

## 5. Questions & Assumptions

### Assumptions
1. **No auth changes needed** — reuse existing `@Roles('admin')` guard (same as sync controller)
2. **External IDs are optional enrichment** — product detail includes external IDs; list does not (to avoid N+1 queries)
3. **Variant search is cross-product** — `GET /variants/search?search=X` searches all variants, not scoped to one product
4. **Product detail includes variants inline** — `GET /products/:id` returns product + its variants array (no separate call needed for detail view)
5. **Pagination defaults** — limit=20, max=100, offset=0 (matching sync jobs pattern)
6. **Text search is ILIKE** — name/SKU search uses case-insensitive LIKE, not full-text search (MVP)
7. **No database migration** — all tables already exist; we only add read queries
8. **Product IDs are TEXT** — internal IDs use `ol_product_*` format (not UUID), so no `ParseUUIDPipe` on product/variant params

### Documentation Gaps
- None identified — pattern is well-established in sync jobs.

---

## 6. Proposed Implementation Plan

### Phase 1: CORE Domain — Types and Port Extensions

**Goal**: Add pagination types and extend repository ports with `findMany` methods.

#### Step 1.1: Add product pagination types
- **File**: `libs/core/src/products/domain/types/product.types.ts`
- **Action**: Add `ProductListFilters`, `ProductVariantListFilters`, `Pagination`, `PaginatedProducts`, `PaginatedProductVariants` types following `SyncJobFilters`/`SyncJobPagination`/`PaginatedSyncJobs` pattern
- **Acceptance**: Types compile, no lint errors

```typescript
// Add to existing product.types.ts
import { Product } from '../entities/product.entity';
import { ProductVariant } from '../entities/product-variant.entity';

export interface ProductListFilters {
  search?: string;         // ILIKE on name or SKU
}

export interface ProductVariantListFilters {
  productId?: string;      // Scope to one product
  search?: string;         // ILIKE on SKU, EAN, or GTIN
}

export interface Pagination {
  limit: number;           // 1–100
  offset: number;          // >= 0
}

export interface PaginatedProducts {
  items: Product[];
  total: number;
}

export interface PaginatedProductVariants {
  items: ProductVariant[];
  total: number;
}
```

#### Step 1.2: Extend ProductRepositoryPort
- **File**: `libs/core/src/products/domain/ports/product-repository.port.ts`
- **Action**: Add `findMany(filters: ProductListFilters, pagination: Pagination): Promise<PaginatedProducts>` method
- **Acceptance**: Port interface compiles
- **Dependencies**: Step 1.1

#### Step 1.3: Extend ProductVariantRepositoryPort
- **File**: `libs/core/src/products/domain/ports/product-variant-repository.port.ts`
- **Action**: Add `findMany(filters: ProductVariantListFilters, pagination: Pagination): Promise<PaginatedProductVariants>` method
- **Acceptance**: Port interface compiles
- **Dependencies**: Step 1.1

### Phase 2: CORE Infrastructure — Repository Implementations

**Goal**: Implement `findMany` in both repositories.

#### Step 2.1: Implement ProductRepository.findMany
- **File**: `libs/core/src/products/infrastructure/persistence/repositories/product.repository.ts`
- **Action**: Add `findMany` using TypeORM QueryBuilder with optional ILIKE search on `name` and `sku`, ordered by `createdAt DESC`, with `skip(offset)`/`take(limit)` + `getManyAndCount()`
- **Acceptance**: Compiles, unit test passes
- **Dependencies**: Step 1.2

```typescript
async findMany(filters: ProductListFilters, pagination: Pagination): Promise<PaginatedProducts> {
  const qb = this.repository.createQueryBuilder('product');

  if (filters.search) {
    qb.where(
      '(product.name ILIKE :search OR product.sku ILIKE :search)',
      { search: `%${filters.search}%` },
    );
  }

  qb.orderBy('product.createdAt', 'DESC')
    .skip(pagination.offset)
    .take(pagination.limit);

  const [entities, total] = await qb.getManyAndCount();
  return { items: entities.map((e) => this.toDomain(e)), total };
}
```

#### Step 2.2: Implement ProductVariantRepository.findMany
- **File**: `libs/core/src/products/infrastructure/persistence/repositories/product-variant.repository.ts`
- **Action**: Add `findMany` with optional `productId` filter, ILIKE search on `sku`/`ean`/`gtin`, ordered by `createdAt DESC`, with `skip`/`take` + `getManyAndCount()`
- **Acceptance**: Compiles, unit test passes
- **Dependencies**: Step 1.3

```typescript
async findMany(
  filters: ProductVariantListFilters,
  pagination: Pagination,
): Promise<PaginatedProductVariants> {
  const qb = this.repository.createQueryBuilder('variant');

  if (filters.productId) {
    qb.andWhere('variant.productId = :productId', { productId: filters.productId });
  }

  if (filters.search) {
    qb.andWhere(
      '(variant.sku ILIKE :search OR variant.ean ILIKE :search OR variant.gtin ILIKE :search)',
      { search: `%${filters.search}%` },
    );
  }

  qb.orderBy('variant.createdAt', 'DESC')
    .skip(pagination.offset)
    .take(pagination.limit);

  const [entities, total] = await qb.getManyAndCount();
  return { items: entities.map((e) => this.toDomain(e)), total };
}
```

### Phase 3: CORE Application — Service Read Methods

**Goal**: Add read methods to IProductsService / ProductsService.

#### Step 3.1: Extend IProductsService interface
- **File**: `libs/core/src/products/application/services/products.service.interface.ts`
- **Action**: Add methods:
  - `getProduct(id: string): Promise<Product | null>`
  - `listProducts(filters: ProductListFilters, pagination: Pagination): Promise<PaginatedProducts>`
  - `getVariant(id: string): Promise<ProductVariant | null>`
  - `listVariants(filters: ProductVariantListFilters, pagination: Pagination): Promise<PaginatedProductVariants>`
- **Acceptance**: Interface compiles
- **Dependencies**: Step 1.1

#### Step 3.2: Implement read methods in ProductsService
- **File**: `libs/core/src/products/application/services/products.service.ts`
- **Action**: Implement the new interface methods by delegating to repository ports
- **Acceptance**: Compiles, unit test passes
- **Dependencies**: Steps 2.1, 2.2, 3.1

#### Step 3.3: Export new types from products index
- **File**: `libs/core/src/products/index.ts`
- **Action**: Export `ProductListFilters`, `ProductVariantListFilters`, `Pagination`, `PaginatedProducts`, `PaginatedProductVariants`
- **Acceptance**: Types importable from `@openlinker/core/products`

### Phase 4: App Interface — HTTP Module

**Goal**: Create the products API module with controller and DTOs.

#### Step 4.1: Create query DTOs

**File**: `apps/api/src/products/http/dto/list-products-query.dto.ts`
- Create `ListProductsQueryDto` with optional `search` (string), `limit` (1-100, default 20), `offset` (min 0, default 0)
- Follow `ListSyncJobsQueryDto` pattern exactly

**File**: `apps/api/src/products/http/dto/list-product-variants-query.dto.ts`
- Create `ListProductVariantsQueryDto` with optional `search`, `limit`, `offset` — same pattern

#### Step 4.2: Create response DTOs

**File**: `apps/api/src/products/http/dto/external-id-mapping.dto.ts`
- Create `ExternalIdMappingDto` with `externalId`, `platformType`, `connectionId`
- Maps from `ExternalIdMapping` domain type

**File**: `apps/api/src/products/http/dto/product-variant-response.dto.ts`
- Create `ProductVariantResponseDto` with all ProductVariant fields (dates as ISO strings)
- Optional `externalIds?: ExternalIdMappingDto[]` (populated only in enriched responses)

**File**: `apps/api/src/products/http/dto/product-response.dto.ts`
- Create `ProductResponseDto` with all Product fields (dates as ISO strings)
- Optional `variants?: ProductVariantResponseDto[]` (populated in detail endpoint)
- Optional `externalIds?: ExternalIdMappingDto[]` (populated in detail endpoint)

**File**: `apps/api/src/products/http/dto/paginated-products-response.dto.ts`
- Create `PaginatedProductsResponseDto` — `{ items: ProductResponseDto[], total, limit, offset }`

**File**: `apps/api/src/products/http/dto/paginated-product-variants-response.dto.ts`
- Create `PaginatedProductVariantsResponseDto` — same pattern with `ProductVariantResponseDto`

#### Step 4.3: Create products controller
- **File**: `apps/api/src/products/http/products.controller.ts`
- **Action**: Create `ProductsController` with:

| Method | Endpoint | Response | External IDs |
|---|---|---|---|
| `listProducts` | `GET /products` | `PaginatedProductsResponseDto` | No |
| `getProduct` | `GET /products/:id` | `ProductResponseDto` (with variants) | Yes |
| `listVariantsByProduct` | `GET /products/:productId/variants` | `PaginatedProductVariantsResponseDto` | No |
| `searchVariants` | `GET /variants/search` | `PaginatedProductVariantsResponseDto` | No |

- **Decorators**: `@Roles('admin')`, `@ApiBearerAuth()`, `@ApiTags('products')`
- **DI**: Inject `PRODUCTS_SERVICE_TOKEN` (as `IProductsService`) and `IDENTIFIER_MAPPING_TOKEN` (as `IdentifierMappingPort`)
- **Note**: Product/variant IDs are TEXT format (`ol_product_*`), not UUID — use plain `@Param('id')` without `ParseUUIDPipe`
- **Acceptance**: Endpoints respond correctly, Swagger docs generated

#### Step 4.4: Create products API module
- **File**: `apps/api/src/products/products.module.ts`
- **Action**: Create module importing `ProductsModule` (from `@openlinker/core/products`) and `IdentifierMappingModule`, registering `ProductsController`
- **Acceptance**: Module compiles

#### Step 4.5: Register in AppModule
- **File**: `apps/api/src/app.module.ts`
- **Action**: Import `ProductsApiModule`
- **Acceptance**: App boots, endpoints accessible

### Phase 5: Testing

**Goal**: Unit tests for new read methods and controller.

#### Step 5.1: Unit tests for ProductsService read methods
- **File**: `libs/core/src/products/application/services/products.service.spec.ts`
- **Action**: Test `getProduct`, `listProducts`, `getVariant`, `listVariants` with mocked repository ports
- **Test cases**:
  - `should return product when found`
  - `should return null when product not found`
  - `should return paginated products`
  - `should return paginated products with search filter`
  - `should return paginated variants for a product`
  - `should return paginated variants with search filter`
- **Acceptance**: All tests pass

#### Step 5.2: Unit tests for ProductsController
- **File**: `apps/api/src/products/http/products.controller.spec.ts`
- **Action**: Test all 4 endpoints with mocked service and identifier mapping port
- **Test cases**:
  - `should return paginated product list`
  - `should return product detail with variants and external IDs`
  - `should throw NotFoundException when product not found`
  - `should return paginated variants for a product`
  - `should search variants across all products`
- **Acceptance**: All tests pass

#### Step 5.3: Quality gate
- **Action**: Run `pnpm lint && pnpm type-check && pnpm test`
- **Acceptance**: Zero errors

---

## 7. Alternatives Considered

### Alternative 1: Separate ProductReadService
- **Description**: Create a dedicated `ProductReadService` for read operations instead of extending `IProductsService`
- **Why Rejected**: Adds unnecessary abstraction. The existing service is small (2 methods). Adding 4 read methods keeps it cohesive. CQRS split can happen later if needed.
- **Trade-offs**: Simpler now, may need splitting later

### Alternative 2: External IDs in list responses
- **Description**: Include external ID mappings in paginated list responses (not just detail)
- **Why Rejected**: Would require N+1 queries or a batch lookup per page. For a list view, internal ID and name/SKU are sufficient. External IDs are useful in detail/debugging views only.
- **Trade-offs**: Simpler list queries, one extra click to see external IDs

### Alternative 3: Cursor-based pagination
- **Description**: Use cursor-based pagination instead of offset
- **Why Rejected**: Offset pagination is the established pattern (sync jobs). Consistency over theoretical performance for admin API with modest data volumes.
- **Trade-offs**: Offset can be slower at deep pages, acceptable for admin use

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Follows hexagonal architecture — ports extended in domain, implementations in infrastructure, controller in interface
- ✅ Dependency direction correct — controller → service (via token) → repository port (via token)
- ✅ DI via Symbol tokens (existing `PRODUCT_REPOSITORY_TOKEN`, `PRODUCT_VARIANT_REPOSITORY_TOKEN`, `PRODUCTS_SERVICE_TOKEN`)
- **Reference**: [Architecture Overview](../architecture-overview.md)

### Naming Conventions
- ✅ Files: `*.port.ts`, `*.service.ts`, `*.service.interface.ts`, `*.dto.ts`, `*.controller.ts`, `*.types.ts`
- ✅ Classes: `ProductsController`, `ListProductsQueryDto`, `ProductResponseDto`, `PaginatedProductsResponseDto`
- **Reference**: [Engineering Standards - Naming Conventions](../engineering-standards.md#naming-conventions)

### Existing Patterns
- ✅ Mirrors sync jobs read API exactly (pagination, DTO structure, controller structure, module wiring)

### Risks
- **N+1 for external IDs in product detail**: `GET /products/:id` loads product + variants + external IDs for each. Mitigation: variants per product are typically <50; external IDs are 1-3 per entity. Acceptable for admin API.
- **ILIKE performance on large datasets**: Mitigation: products table bounded by merchant catalog size (typically <100K). Add DB index later if needed.

### Edge Cases
- **Product with no variants**: Returns product with empty `variants: []`
- **Variant search with no results**: Returns `{ items: [], total: 0, limit, offset }`
- **Product not found on detail**: Returns `404 NotFoundException`
- **Product IDs are TEXT not UUID**: Use plain string param, no `ParseUUIDPipe`

### Backward Compatibility
- ✅ No breaking changes — new endpoints only, existing interfaces extended (not modified)

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `ProductsService`: test `getProduct`, `listProducts`, `getVariant`, `listVariants` with mocked repository ports
- `ProductsController`: test all 4 endpoints with mocked service and identifier mapping port
- **Files**: `libs/core/src/products/application/services/products.service.spec.ts`, `apps/api/src/products/http/products.controller.spec.ts`

### Mocking Strategy
- Mock `ProductRepositoryPort` and `ProductVariantRepositoryPort` for service tests
- Mock `IProductsService` and `IdentifierMappingPort` for controller tests
- **Reference**: [Testing Guide - Mocking Ports](../testing-guide.md)

### Acceptance Criteria
- [ ] `GET /products` returns paginated product list with correct total count
- [ ] `GET /products?search=shirt` filters by name or SKU (case-insensitive)
- [ ] `GET /products/:id` returns product with variants array and external IDs
- [ ] `GET /products/:id` returns 404 for non-existent product
- [ ] `GET /products/:productId/variants` returns paginated variants for a product
- [ ] `GET /variants/search?search=ABC123` searches variants by SKU/EAN/GTIN
- [ ] All endpoints require `admin` role
- [ ] Swagger documentation generated for all endpoints
- [ ] `pnpm lint && pnpm type-check && pnpm test` passes with zero errors
- [ ] Unit tests cover happy path and not-found cases

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (sync jobs read API)
- [x] Idempotency considered (N/A — read-only)
- [x] Event-driven patterns used where applicable (N/A — read-only)
- [x] Rate limits & retries addressed (N/A — internal read API)
- [x] Error handling comprehensive (404, validation)
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
