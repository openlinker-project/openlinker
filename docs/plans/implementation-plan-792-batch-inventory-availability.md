# Implementation Plan — Batch inventory-availability endpoint (#792 PR 2)

**Status:** ready for implementation
**Branch:** `792-batch-inventory-availability`
**Footer:** `Refs #792` (PR 2 of 3; does not close — see #792 sequencing)

## 1. Goal

Add `GET /inventory/availability?productVariantIds=v1,v2,…` returning per-variant summed `availableQuantity` across all locations. Unblocks #792 PR 3 (the bulk-wizard master-pull refactor), which calls this once per resolve step to hydrate per-row master stock.

**Layer:** Backend (CORE persistence + application + interface) + Frontend transport types + feature barrel.

**Explicit non-goals:**
- No FE wizard UI changes (PR 3).
- No `variant.price` changes (PR 1 — already in #798).
- No new `Connection` / per-connection routing.
- No reserved-quantity aggregation — only `availableQuantity` (the wizard's relevant signal).
- No historical backfill of any kind.

## 2. Codebase grounding

| File | Current state | Change |
|---|---|---|
| `libs/core/src/inventory/domain/types/inventory.types.ts` | Has `InventoryAdjustment`, `InventoryFilters`, `InventoryPagination`, `PaginatedInventoryItems`. | Add `VariantAvailability` type. |
| `libs/core/src/inventory/domain/ports/inventory-repository.port.ts` | `findByProductAndVariant`, `findById`, `findMany`, `upsert`. | Add `findAvailabilityByVariantIds(variantIds: readonly string[]): Promise<readonly VariantAvailability[]>`. |
| `libs/core/src/inventory/infrastructure/persistence/repositories/inventory.repository.ts` | TypeORM implementation. | Add the new repo method using a single SQL aggregate (GROUP BY `productVariantId`, SUM `availableQuantity`, COUNT DISTINCT `locationId`). Returns rows only for variants with inventory. |
| `libs/core/src/inventory/application/services/inventory-query.service.interface.ts` | `listInventoryItems`, `getInventoryItem`. | Add `getAvailabilityByVariantIds(variantIds: readonly string[]): Promise<readonly VariantAvailability[]>`. |
| `libs/core/src/inventory/application/services/inventory-query.service.ts` | Composes inventory + product. | New method: calls the repo, then **zero-fills** unknown variants so the response always carries an entry per requested ID. |
| `apps/api/src/inventory/http/dto/get-inventory-availability-query.dto.ts` | Does not exist. | New request DTO with `productVariantIds: string` (comma-separated), validated + transformed into `string[]` (max 200, min 1). |
| `apps/api/src/inventory/http/dto/inventory-availability-response.dto.ts` | Does not exist. | New response DTO. |
| `apps/api/src/inventory/http/inventory.controller.ts` | `@Get()` listInventory at line 39, `@Get(':id')` getInventoryItem at line 70. | Add `@Get('availability')` registered **before** `@Get(':id')` (route-order constraint — same precedent as `products.controller.ts:101` for `variants/:variantId`). |
| `apps/web/src/features/inventory/api/inventory.types.ts` | `InventoryItem`, `InventoryFilters`, `InventoryPagination`, `PaginatedInventory`. | Add `InventoryAvailability` + `InventoryAvailabilityResponse`. |
| `apps/web/src/features/inventory/api/inventory.api.ts` | `list`, `getById`. | Add `availability(productVariantIds): Promise<InventoryAvailabilityResponse>`. |
| `apps/web/src/features/inventory/api/inventory.query-keys.ts` | `all`, `list`, `detail`. | Add `availability(variantIds)` — keyed by a sorted, comma-joined deterministic string so distinct call-site orderings hit the same cache entry. |
| `apps/web/src/features/inventory/hooks/use-inventory-availability-batch-query.ts` | Does not exist. | New hook wrapping `useQuery`. `enabled` defaults to `productVariantIds.length > 0` so an empty list never fires the request. |
| `apps/web/src/features/inventory/index.ts` | **Does not exist.** | New public barrel — exports `InventoryAvailability`, `InventoryAvailabilityResponse`, `useInventoryAvailabilityBatchQuery`. Per `docs/frontend-architecture.md` § Feature Public Surface, this is the seam PR 3 will import through. |
| `apps/web/.eslintrc.js` (or root `.eslintrc.js`) | `no-restricted-imports` enumerates `connections`, `customers`, `orders`, `products`, etc. | Add `inventory` to both pattern groups (`features/**` and `plugins/**`) for every canonical subdirectory (`api`, `hooks`, `components`, `lib`, `types`). |

**Precedents to follow:**
- Route-order constraint: `apps/api/src/products/http/products.controller.ts:101` registers `@Get('variants/:variantId')` before `@Get(':id')` with a header comment explaining why. Mirror the comment.
- Query-key deterministic shape for batch-keyed queries: `apps/web/src/features/listings/api/listings.query-keys.ts` (or similar). The sorted-join keeps cache hits stable when callers pass IDs in different orders.
- Single SQL aggregate via TypeORM query builder: `apps/api/src/sync/...` or `inventory.repository.ts:73-100` (the `findMany` `createQueryBuilder` shape).
- Symbol DI token re-export: `inventory.tokens.ts` is already the convention.

## 3. Changes — step by step

### Step 1 — Domain type

File: `libs/core/src/inventory/domain/types/inventory.types.ts`

Add after `PaginatedInventoryItems`:

```ts
/**
 * Per-variant inventory availability summed across all locations.
 * Used by the bulk-wizard master-pull resolver (#792 PR 3).
 */
export interface VariantAvailability {
  productVariantId: string;
  totalAvailable: number;
  locationCount: number;
}
```

AC: TypeScript compiles; new type exported from `@openlinker/core/inventory` via the existing `inventory.types.ts` re-export in the barrel.

### Step 2 — Repository port + implementation

**Port** (`libs/core/src/inventory/domain/ports/inventory-repository.port.ts`):

```ts
findAvailabilityByVariantIds(
  variantIds: readonly string[],
): Promise<readonly VariantAvailability[]>;
```

JSDoc: notes that rows are returned **only for variants with at least one matching inventory row**; zero-filling for unknown variants is the caller's responsibility (lives at the service layer, not the repo).

**Implementation** (`libs/core/src/inventory/infrastructure/persistence/repositories/inventory.repository.ts`):

```ts
async findAvailabilityByVariantIds(
  variantIds: readonly string[],
): Promise<readonly VariantAvailability[]> {
  if (variantIds.length === 0) return [];
  const rows = await this.repository
    .createQueryBuilder('inv')
    .select('inv.productVariantId', 'productVariantId')
    .addSelect('COALESCE(SUM(inv.availableQuantity), 0)', 'totalAvailable')
    .addSelect('COUNT(DISTINCT inv.locationId)', 'locationCount')
    .where('inv.productVariantId IN (:...variantIds)', { variantIds: [...variantIds] })
    .groupBy('inv.productVariantId')
    .getRawMany<{ productVariantId: string; totalAvailable: string; locationCount: string }>();

  return rows.map((row) => ({
    productVariantId: row.productVariantId,
    totalAvailable: Number(row.totalAvailable),
    locationCount: Number(row.locationCount),
  }));
}
```

Notes:
- `SUM(...)` returns `numeric` (string) and `COUNT(DISTINCT ...)` returns `bigint` (string) in pg via TypeORM raw queries — explicit `Number()` cast.
- `COALESCE(SUM, 0)` is defensive — `SUM` over an empty group should never fire since the `WHERE … IN` prunes those rows out, but the COALESCE costs nothing and removes ambiguity.
- `COUNT(DISTINCT locationId)` treats `NULL` as a single distinct value in Postgres; for the wizard's purposes that's fine.

AC: Unit test (mocking the TypeORM repo) is awkward for query-builder shapes — covered by the int-spec instead. The repo-level int-spec asserts: empty input → empty output; single-location variant; multi-location variant (sums); variant with no inventory rows → absent from result.

### Step 3 — Service interface + implementation

**Interface** (`libs/core/src/inventory/application/services/inventory-query.service.interface.ts`):

```ts
getAvailabilityByVariantIds(
  variantIds: readonly string[],
): Promise<readonly VariantAvailability[]>;
```

**Implementation** (`inventory-query.service.ts`):

```ts
async getAvailabilityByVariantIds(
  variantIds: readonly string[],
): Promise<readonly VariantAvailability[]> {
  const rows = await this.inventoryRepository.findAvailabilityByVariantIds(variantIds);
  const byId = new Map(rows.map((r) => [r.productVariantId, r]));
  // Zero-fill unknowns so the caller can build a Record<variantId, …> map directly.
  return variantIds.map((id) => byId.get(id) ?? {
    productVariantId: id,
    totalAvailable: 0,
    locationCount: 0,
  });
}
```

AC: Unit spec mocks `InventoryRepositoryPort.findAvailabilityByVariantIds`, asserts:
- empty input → empty output
- all-found case passes through
- partial-found case zero-fills missing variants
- order matches input order (downstream may depend on this)

### Step 4 — HTTP DTOs

**Request DTO** (`apps/api/src/inventory/http/dto/get-inventory-availability-query.dto.ts`):

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

const MAX_VARIANT_IDS_PER_REQUEST = 200;

export class GetInventoryAvailabilityQueryDto {
  @ApiProperty({
    description:
      'Comma-separated list of internal product-variant IDs (max 200). Returns one row per ID, zero-filled for variants with no inventory.',
    example: 'ol_variant_abc123,ol_variant_def456',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : value,
  )
  @IsArray()
  @ArrayMinSize(1, { message: 'productVariantIds must contain at least one ID' })
  @ArrayMaxSize(MAX_VARIANT_IDS_PER_REQUEST, {
    message: `productVariantIds may contain at most ${MAX_VARIANT_IDS_PER_REQUEST.toString()} IDs per request`,
  })
  @IsString({ each: true })
  productVariantIds!: string[];
}

export const INVENTORY_AVAILABILITY_MAX_VARIANT_IDS = MAX_VARIANT_IDS_PER_REQUEST;
```

The `MAX_VARIANT_IDS_PER_REQUEST` is also re-exported as `INVENTORY_AVAILABILITY_MAX_VARIANT_IDS` so the FE hook can dedupe / chunk if a caller ever passes > 200 (PR 3 already caps at 200 at the wizard level, but the constant gives a single source of truth).

**Response DTO** (`apps/api/src/inventory/http/dto/inventory-availability-response.dto.ts`):

```ts
import { ApiProperty } from '@nestjs/swagger';

export class InventoryAvailabilityItemDto {
  @ApiProperty({ description: 'Internal product-variant ID' })
  productVariantId!: string;

  @ApiProperty({ description: 'Summed availableQuantity across all locations' })
  totalAvailable!: number;

  @ApiProperty({ description: 'Distinct location count contributing to the sum (0 when no inventory rows)' })
  locationCount!: number;
}

export class InventoryAvailabilityResponseDto {
  @ApiProperty({ type: [InventoryAvailabilityItemDto] })
  items!: InventoryAvailabilityItemDto[];
}
```

AC: Both DTOs registered on the controller via `@ApiResponse({ type: ... })`.

### Step 5 — Controller endpoint

File: `apps/api/src/inventory/http/inventory.controller.ts`

Add the new endpoint **before** the existing `@Get(':id')` handler (route-order constraint — `:id` would otherwise match `availability` as a literal ID and call `getInventoryItem('availability')`):

```ts
@Get('availability')
@HttpCode(HttpStatus.OK)
@ApiOperation({
  summary: 'Batch lookup of per-variant inventory availability',
  description:
    'Returns one row per requested productVariantId with availableQuantity summed across all locations. ' +
    'Zero-filled for variants that have no inventory rows. Capped at 200 IDs per request.',
})
@ApiResponse({
  status: 200,
  description: 'Per-variant availability',
  type: InventoryAvailabilityResponseDto,
})
@ApiResponse({ status: 400, description: 'Empty or oversize productVariantIds list' })
@ApiResponse({ status: 403, description: 'Insufficient permissions' })
async getAvailability(
  @Query() query: GetInventoryAvailabilityQueryDto,
): Promise<InventoryAvailabilityResponseDto> {
  const items = await this.queryService.getAvailabilityByVariantIds(query.productVariantIds);
  return { items: items.map((i) => ({ ...i })) };
}
```

Header comment update:

```ts
// Declared before @Get(':id') so /inventory/availability is matched by this
// handler rather than getInventoryItem (which would treat 'availability' as a
// valid id). Same registration-order concern as products.controller.ts:101.
```

AC: Controller spec mocks `IInventoryQueryService.getAvailabilityByVariantIds`, asserts:
- 200 with the items shape on success
- pass-through of the parsed variantIds array
- 400 surface for empty / oversize input (via NestJS ValidationPipe on the DTO)

### Step 6 — FE wire types

File: `apps/web/src/features/inventory/api/inventory.types.ts`

Append:

```ts
export interface InventoryAvailability {
  productVariantId: string;
  totalAvailable: number;
  locationCount: number;
}

export interface InventoryAvailabilityResponse {
  items: InventoryAvailability[];
}
```

### Step 7 — FE API method

File: `apps/web/src/features/inventory/api/inventory.api.ts`

Extend `InventoryApi`:

```ts
export interface InventoryApi {
  list: (filters?: InventoryFilters, pagination?: InventoryPagination) => Promise<PaginatedInventory>;
  getById: (id: string) => Promise<InventoryItem>;
  availability: (productVariantIds: readonly string[]) => Promise<InventoryAvailabilityResponse>;
}
```

Implementation passes the IDs as a comma-separated query param. Caller is responsible for deduping (the hook does this) and chunking if > 200.

### Step 8 — FE query keys

File: `apps/web/src/features/inventory/api/inventory.query-keys.ts`

```ts
availability: (variantIds: readonly string[]) =>
  ['inventory', 'availability', [...variantIds].sort().join(',')] as const,
```

Sorted-join ensures stable cache identity across call-site orderings.

### Step 9 — FE hook

File: `apps/web/src/features/inventory/hooks/use-inventory-availability-batch-query.ts`

```ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { InventoryAvailabilityResponse } from '../api/inventory.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Batch lookup of per-variant inventory availability.
 *
 * Wraps `GET /inventory/availability`. Dedupes input IDs at the hook
 * boundary so callers can pass the raw row list. Disabled automatically
 * when the deduped list is empty.
 *
 * @param productVariantIds raw variant IDs from the caller (may contain duplicates)
 * @returns TanStack Query result for the response envelope
 */
export function useInventoryAvailabilityBatchQuery(
  productVariantIds: readonly string[],
  options?: { enabled?: boolean },
): UseQueryResult<InventoryAvailabilityResponse> {
  const apiClient = useApiClient();
  const deduped = [...new Set(productVariantIds)];
  const enabled = (options?.enabled ?? true) && deduped.length > 0;

  return useQuery({
    queryKey: inventoryQueryKeys.availability(deduped),
    queryFn: () => apiClient.inventory.availability(deduped),
    enabled,
  });
}
```

### Step 10 — FE feature barrel + ESLint pattern

**New file** (`apps/web/src/features/inventory/index.ts`):

```ts
/**
 * Inventory feature public surface.
 *
 * Cross-feature and plugin consumers import only the symbols re-exported
 * here — never deep paths into api/ / hooks/ / components/. See
 * docs/frontend-architecture.md § Feature Public Surface.
 *
 * @module apps/web/src/features/inventory
 */
export type {
  InventoryAvailability,
  InventoryAvailabilityResponse,
  InventoryItem,
  PaginatedInventory,
  InventoryFilters,
  InventoryPagination,
} from './api/inventory.types';

export { useInventoryAvailabilityBatchQuery } from './hooks/use-inventory-availability-batch-query';
```

(Existing item-detail / list hooks are intentionally not re-exported because they have no current cross-feature consumer — keep the public surface narrow per the rule's "start narrow" guidance. They can be added in a single-line edit when a need arises.)

**ESLint update** (`.eslintrc.js` at repo root):

Add `inventory` to both `no-restricted-imports` pattern groups (the `features/**` rule and the `plugins/**` rule) for every canonical subdirectory: `api`, `hooks`, `components`, `lib`, `types`.

Verify with `pnpm lint` — no existing cross-feature inventory imports today (only `app/` and `pages/`, both exempted), so this is a safe add.

### Step 11 — Tests

| Test | Location | Coverage |
|---|---|---|
| `inventory-query.service.spec.ts` (existing) | Extended | new `getAvailabilityByVariantIds` block: empty input, all-found, partial zero-fill, order preservation. Mocks the repo port. |
| `inventory.controller.spec.ts` (existing) | Extended | new `getAvailability` block: 200 happy path; assert pass-through of parsed IDs; assert DTO mapping. Mocks `IInventoryQueryService`. |
| `inventory-availability.int-spec.ts` | New file at `apps/api/test/integration/` | End-to-end: seed two variants with multi-location inventory (one variant: 2 locations summing 8; one variant: 1 location with 5), hit `GET /inventory/availability?productVariantIds=v1,v2,v3`, assert `totalAvailable` sums + `locationCount` distinct counts + zero-fill on the unknown `v3`. Plus negative cases: 400 on empty list, 400 on > 200 IDs. |

The repo's `findAvailabilityByVariantIds` is exercised end-to-end through the int-spec; no separate repo unit spec — mocking the TypeORM query-builder for an aggregate query is more fragile than the integration coverage.

## 4. Quality gate

```bash
pnpm lint                                    # invariants + ESLint (incl. new inventory barrel rule)
pnpm type-check                              # zero TS errors across all packages
pnpm test                                    # unit tests green
pnpm test:integration inventory-availability # new int-spec green
pnpm test:integration                        # full int sweep regression check
```

No migration in this PR — pure code-only change.

## 5. Risks & open questions

| Risk | Mitigation |
|---|---|
| Route-order regression: `@Get('availability')` registered after `@Get(':id')` would silently 404 / 500 on the new endpoint. | Header comment on the new handler explaining the constraint; Nest's pattern-match-on-registration-order is enforced by route position in source. Int-spec hitting `/inventory/availability` is the safety net — if route order breaks, the int-spec gets a 500 trying to load inventory item `availability`. |
| TypeORM `SUM` / `COUNT DISTINCT` returning string-typed values surprises the consumer. | Explicit `Number()` cast in the repo. Int-spec asserts on numeric equality, not string equality, so a regression here surfaces immediately. |
| Adding `inventory` to the FE feature-barrel ESLint rule breaks an existing import. | Grep shows only `app/` and `pages/` consumers today, both exempted. Verified before commit. |
| FE hook deduping at the hook layer vs. caller layer — surprising for callers expecting their raw input order back. | The hook dedupes silently; the response envelope returns the API's items array which preserves the deduped order. PR 3 consumes via a `Map<variantId, …>`, not by index, so order doesn't matter. Documented in the JSDoc. |
| Per-variant `null` `productVariantId` in `inventory_items` (the base inventory case) silently dropped by the `IN` clause. | Intentional — the endpoint is variant-keyed by definition; base-inventory rows have no variant to group by. The wizard never asks about a variant with `productVariantId = null`. |

**Open questions:** none. The endpoint shape is locked in #792 (PR 2 spec).

## 6. Validation against standards

- ✅ Hexagonal: domain type → repo port → repo impl → service → controller. No domain framework deps.
- ✅ Repository port pattern: new method on the existing port; service depends on the port via the existing `INVENTORY_REPOSITORY_TOKEN`.
- ✅ Service interface separation: interface file gets the new method first, implementation follows.
- ✅ DTOs at interface layer with `class-validator` decorators.
- ✅ `@Roles('admin')` + `@ApiBearerAuth()` inherited from the existing controller-level decorators.
- ✅ Naming: file names follow `*-query.dto.ts` / `*-response.dto.ts` patterns. Class name follows `Get*QueryDto` / `*ResponseDto`.
- ✅ Feature-barrel rule satisfied: new `features/inventory/index.ts` + ESLint enumeration update.
- ✅ Query-key shape: deterministic and stable across orderings (sorted-join).
- ✅ Loading/error states deferred to PR 3 (this PR ships the hook only — no UI consumer).
- ✅ No `any`, no `console.log`, no hardcoded secrets, no SQL injection (parameterised `IN` binding).
- ✅ No new auth surface; no credentials touched.

## 7. Out of scope (deferred)

- Reserved-quantity summing — the wizard needs only `availableQuantity` minus reservations is implicit in `availableQuantity` already (the BE updates it on reservation).
- Per-location breakdown — `locationCount` only; if a future caller needs the per-location split, add a separate endpoint.
- Inventory-item POST/PUT writes — pure read in this PR.
- Chunking for > 200 IDs at the hook layer — exposed via `INVENTORY_AVAILABILITY_MAX_VARIANT_IDS`, deferred to PR 3 if needed.
- Migrating the existing `useInventoryQuery` / `useInventoryItemQuery` consumers to the barrel — they're only used from `app/` and `pages/`, both exempted from the rule today.
