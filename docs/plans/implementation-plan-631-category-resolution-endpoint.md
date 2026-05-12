# Implementation Plan — #631 BE: Category Resolution HTTP endpoint

## 1. Goal

Expose `CategoryResolutionService.resolveCategory` via a new HTTP endpoint so the FE `CreateOfferWizard` can pre-fill the Allegro category from a variant's EAN (and from configured source→marketplace category mappings) before the operator hits the picker.

**Layer:** Interface (HTTP). No CORE, application, or infrastructure changes.

**Endpoint:**
```
POST /listings/connections/:connectionId/categories/resolve
```

**Non-goals:**
- No domain or service changes — `CategoryResolutionService` stays untouched.
- No new resolution algorithm — the existing 3-step fallback (auto-detect → mapping → manual) is exposed as-is.
- No ambiguous-match list (Allegro can return multiple categories for a barcode; the service today returns at most one). If FE later needs the list, that's a follow-up touching the adapter, port, and service — out of scope here.
- No batch endpoint (single resolution per call).

## 2. Research notes

### Service surface (already wired)
`CategoryResolutionService` (`libs/core/src/listings/application/services/category-resolution.service.ts:35`) implements `ICategoryResolutionService.resolveCategory(input): Promise<CategoryResolutionResult>`. Token: `CATEGORY_RESOLUTION_SERVICE_TOKEN`, re-exported from `@openlinker/core/listings` (`libs/core/src/listings/index.ts:27`). Bound in `ListingsModule` and already injectable.

Input shape (`libs/core/src/listings/application/types/category-resolution.types.ts:19`):
```ts
{
  connectionId: string;       // path param, not body
  barcode?: string | null;    // body
  sourceCategoryIds?: string[]; // body, ordered deepest-first
}
```

Result shape:
```ts
{
  allegroCategoryId: string | null;
  method: 'auto_detect' | 'category_mapping' | 'manual'; // CategoryResolutionMethodValues
}
```

### Auth pattern in `ListingsController`
The controller uses `@Roles('admin')` at class level. `JwtAuthGuard` is registered as a global `APP_GUARD` in `auth.module.ts:51`, so class-level `@Roles('admin')` is sufficient — no per-route `@UseGuards(JwtAuthGuard)` needed. The issue's "guard with `@UseGuards(JwtAuthGuard)`" is satisfied by the global JWT guard + the class-level `@Roles('admin')`.

### Connection validation
The existing `categories/:categoryId/parameters` route (lines 351-403) validates the connection by calling `integrationsService.getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager')` — which throws `ConnectionNotFoundException` (404) / `ConnectionDisabledException` (409) / `CapabilityNotSupportedException` (422) through the global filter. I'll do the same in `resolveCategory` BEFORE calling the service, so a missing/disabled/non-OfferManager connection short-circuits with the right HTTP status.

Note that `CategoryResolutionService.tryAutoDetect` already catches adapter-resolve errors and falls through to mapping (line 80-85). If I relied on the service alone, an unknown connection would silently return `{ allegroCategoryId: null, method: 'manual' }` instead of 404 — which contradicts the acceptance criterion. The pre-flight `getCapabilityAdapter` call is the fix.

### DTO conventions
Request DTOs colocated under `apps/api/src/listings/http/dto/` use `class-validator` decorators (`@IsOptional`, `@IsString`, `@IsArray`, `@ArrayMaxSize` where appropriate) and Swagger annotations (`@ApiPropertyOptional`). Response DTOs use `@ApiProperty({ enum: ... })` for enum values. The `auto-match-variants.dto.ts` file is the closest precedent — same file holds the request and response classes.

## 3. Step-by-step implementation

### Step 1 — Create the request + response DTOs

**File:** `apps/api/src/listings/http/dto/resolve-category.dto.ts` (new)

Filename follows the verb-resource form used by `auto-match-variants.dto.ts` and `update-offer-fields.dto.ts` in the same folder. Two classes in one file (same precedent):

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  CategoryResolutionMethodValues,
  type CategoryResolutionMethod,
} from '@openlinker/core/listings';

export class ResolveCategoryRequestDto {
  @ApiPropertyOptional({
    description: 'EAN or GTIN barcode for auto-detect (step 1). Omit to skip auto-detect.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @ApiPropertyOptional({
    description:
      'Source platform category IDs for mapping fallback (step 2), ordered deepest-first. Omit to skip mapping.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @ArrayMaxSize(32)
  sourceCategoryIds?: string[];
}

export class ResolveCategoryResponseDto {
  @ApiProperty({
    description: 'Resolved marketplace category ID, or null if the operator must pick manually.',
    nullable: true,
  })
  allegroCategoryId!: string | null;

  @ApiProperty({
    description: 'Which step of the 3-step fallback produced the result.',
    enum: CategoryResolutionMethodValues,
  })
  method!: CategoryResolutionMethod;
}
```

**Why `MaxLength(64)` / `ArrayMaxSize(32)` / `@IsNotEmpty({ each: true })`:** lightweight bounds — EAN-13 is 13 chars, GTIN-14 is 14; 64 covers any practical barcode plus a margin. Source category paths are deepest-first lists; 32 is generous for any real tree depth and prevents accidental DoS. `@IsNotEmpty({ each: true })` rejects empty-string array elements at the boundary so a bad client doesn't fan out into no-op DB lookups inside `mappingConfig.resolveAllegroCategory`.

(`CategoryResolutionMethodValues` and `CategoryResolutionMethod` are re-exported from `@openlinker/core/listings` at `libs/core/src/listings/index.ts:46-48` — confirmed.)

### Step 2 — Add the controller route

**File:** `apps/api/src/listings/http/listings.controller.ts`

Imports — add to the existing groups:

```ts
// Add to existing @openlinker/core/listings imports:
import { CATEGORY_RESOLUTION_SERVICE_TOKEN } from '@openlinker/core/listings';
import type { ICategoryResolutionService } from '@openlinker/core/listings';

// Add to existing local DTO imports:
import {
  ResolveCategoryRequestDto,
  ResolveCategoryResponseDto,
} from './dto/resolve-category.dto';
```

Inject — add a new constructor param at the end of the existing list:

```ts
@Inject(CATEGORY_RESOLUTION_SERVICE_TOKEN)
private readonly categoryResolution: ICategoryResolutionService,
```

Route — place immediately after the existing `getCategoryParameters` route (line 351 block), keeping the categories-themed endpoints together:

```ts
@Post('connections/:connectionId/categories/resolve')
@HttpCode(HttpStatus.OK)
@ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
@ApiOperation({
  summary: 'Resolve marketplace category (EAN auto-match + mapping fallback) (#631)',
  description:
    'Runs the 3-step category-resolution chain — auto-detect by barcode → configured ' +
    'source→marketplace mapping → manual — and returns the first hit. Mirrors the in-process ' +
    'flow already used by OfferCreationExecutionService. Returns method=manual with ' +
    'allegroCategoryId=null when nothing resolves (200, not 404 — manual is a normal outcome).',
})
@ApiResponse({ status: 200, description: 'Resolution result.', type: ResolveCategoryResponseDto })
@ApiResponse({ status: 404, description: 'Connection not found.' })
@ApiResponse({ status: 409, description: 'Connection disabled.' })
@ApiResponse({
  status: 422,
  description: 'Connection does not support OfferManager.',
})
async resolveCategory(
  @Param('connectionId') connectionId: string,
  @Body() dto: ResolveCategoryRequestDto,
): Promise<ResolveCategoryResponseDto> {
  // Validate the connection is a real, active marketplace before delegating.
  // The `OfferManager` capability is the "is this a marketplace connection"
  // gate — not a hard runtime requirement of the resolution algorithm. Step-2
  // (category mapping) doesn't actually need an adapter (`mappingConfig` is a
  // pure DB lookup); the pre-flight is here so unknown/disabled connections
  // surface as 404/409 instead of silently falling through to `method=manual`
  // inside the service. Matches the `categories/:categoryId/parameters` route.
  // Throws ConnectionNotFoundException (404) / ConnectionDisabledException (409) /
  // CapabilityNotSupportedException (422).
  await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
    connectionId,
    'OfferManager',
  );

  const result = await this.categoryResolution.resolveCategory({
    connectionId,
    barcode: dto.barcode ?? null,
    sourceCategoryIds: dto.sourceCategoryIds,
  });

  return {
    allegroCategoryId: result.allegroCategoryId,
    method: result.method,
  };
}
```

### Step 3 — Controller spec

**File:** `apps/api/src/listings/http/listings.controller.spec.ts`

Add mock at the top alongside the existing service mocks:

```ts
let categoryResolution: jest.Mocked<ICategoryResolutionService>;
```

In `beforeEach`:
```ts
categoryResolution = { resolveCategory: jest.fn() };
// ...
{ provide: CATEGORY_RESOLUTION_SERVICE_TOKEN, useValue: categoryResolution },
```

New `describe('resolveCategory (#631)', …)` block at the end, with 4 cases per the issue acceptance criteria:

1. `'returns method=auto_detect when the barcode resolves'`
   - `integrationsService.getCapabilityAdapter.mockResolvedValue(/* anything */)`
   - `categoryResolution.resolveCategory.mockResolvedValue({ allegroCategoryId: '257933', method: 'auto_detect' })`
   - Call `controller.resolveCategory('conn-1', { barcode: '5901234567890' })`
   - Assert: response shape, service called with `{ connectionId: 'conn-1', barcode: '5901234567890', sourceCategoryIds: undefined }`
   - Assert: `integrationsService.getCapabilityAdapter` called with `('conn-1', 'OfferManager')`

2. `'returns method=category_mapping when sourceCategoryIds resolve'`
   - Service mock returns `{ allegroCategoryId: '12345', method: 'category_mapping' }`
   - Call with `{ sourceCategoryIds: ['ps-cat-99', 'ps-cat-7'] }`
   - Assert response method matches

3. `'returns method=manual with null allegroCategoryId when nothing resolves'`
   - Service mock returns `{ allegroCategoryId: null, method: 'manual' }`
   - Call with `{}`
   - Assert HTTP status is 200 (not 404) by virtue of the returned shape — verify `result.allegroCategoryId === null && result.method === 'manual'`. The `@HttpCode(HttpStatus.OK)` is decorator-level so unit tests can't observe it directly without `@nestjs/testing` HTTP boot; covering the shape is the testable invariant.

4. `'propagates the 404 when the connection is not found (does not call resolveCategory)'`
   - `integrationsService.getCapabilityAdapter.mockRejectedValue(new ConnectionNotFoundException('conn-missing'))`
   - Expect `controller.resolveCategory('conn-missing', { barcode: '5901234567890' })` to reject
   - Assert: `categoryResolution.resolveCategory` was NOT called (this is the value-add of the pre-flight check)

Optional 5th case if it adds clarity: `'maps barcode=null when the body omits it'` — but the controller's `dto.barcode ?? null` is trivial enough that case 3 (empty body) already covers it.

Use the same `OfferManagerPort` mock plumbing as `getCategoryParameters` already does — a stub that satisfies the type but doesn't need to implement any specific capability for `resolveCategory`. The service-resolve path is mocked, so the adapter object the integration service returns is essentially opaque for these tests.

### Step 4 — Quality gate

```bash
pnpm lint        # 0 errors
pnpm type-check  # clean across all packages
pnpm test        # all unit suites pass; +4 new controller tests
```

## 4. Acceptance check vs issue

- [x] `POST /listings/connections/:connectionId/categories/resolve` exists.
- [x] Guarded by `JwtAuthGuard` via global `APP_GUARD` + class-level `@Roles('admin')`.
- [x] Request DTO validates `barcode?: string` and `sourceCategoryIds?: string[]` with `class-validator`.
- [x] Response shape matches `CategoryResolutionResult`.
- [x] Delegates to `ICategoryResolutionService.resolveCategory` via `CATEGORY_RESOLUTION_SERVICE_TOKEN`; no business logic in the controller.
- [x] 404 when connection is missing / disabled (via `getCapabilityAdapter` pre-flight).
- [x] 200 with `method: 'manual'` and `allegroCategoryId: null` when nothing resolves.
- [x] Swagger annotations present (`@ApiOperation`, `@ApiResponse`, `@ApiParam`, `@ApiProperty`).
- [x] Spec covers auto-detect hit, mapping hit, manual outcome, missing connection 404.
- [x] No CORE / application changes.

## 5. Risks / notes

- **Mass-assignment via DTO:** `class-validator` only rejects unknown properties when `ValidationPipe` is configured with `whitelist: true`. The wider API already runs validation pipes (this is consistent with every other DTO here), so extra fields are stripped or rejected per global config — not something this endpoint needs to re-configure.
- **`barcode` length cap (64):** Defensive only. Real Allegro `matchCategoryByBarcode` calls have an upstream cap of their own; this just prevents the FE from sending unbounded strings before the adapter is asked.
- **Manual-outcome HTTP status:** Returning 200 for `method: 'manual'` is explicit in the spec and matches the in-process service behaviour. A 404 here would conflate "connection missing" (a real configuration error) with "EAN not found in Allegro's catalog AND no mapping configured" (a normal flow that triggers the picker on the FE).
