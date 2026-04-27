# Implementation Plan — #410 Allegro category-parameters in the create-offer wizard

> Status: design locked after `/grill-me` (Q1–Q8) + 3 review passes (`/tech-review`, `/frontend-design`, `/tech-review` synthesis). Spawned follow-up #412 for richer auto-prefill.

## 1. Goal

Make `marketplace.offer.create` against Allegro succeed past
`ConstraintViolationException.MissingRequiredParameters`. Today the wizard
captures a fixed set of fields (title / category / price / description /
images / 4 policy IDs) but never asks operators for the **category-required
parameters** that Allegro's offer-create endpoint demands (Brand, Model,
EAN, technical specs, etc.). Result: every category with required
parameters fails.

This PR delivers the full vertical slice: shared `CachePort` →
CORE capability → Allegro adapter implementation → API endpoint → FE wizard
step (desktop-only) → wire-shape mapping in `platformParams.parameters`.

## 2. Classification

- **Layer:** Multi-layer — `libs/shared` (CachePort), CORE (port + types + new exception), Integration (Allegro adapter + cache wiring), Interface (API controller), Frontend (new wizard step + virtualized combobox).
- **Effort:** ~3.5 days.
- **No DB / migration impact.**
- **Mobile scope:** desktop-only (≥ 1024 px). Below 1024 px the wizard renders the documented "Open on a desktop screen to edit" affordance — see §7.10.

### Files

**New — shared CachePort:**
- `libs/shared/src/cache/cache.port.ts`
- `libs/shared/src/cache/cache.types.ts`
- `libs/shared/src/cache/redis-cache.adapter.ts`
- `libs/shared/src/cache/cache.module.ts`
- `libs/shared/src/cache/index.ts` — barrel
- `libs/shared/src/cache/__tests__/redis-cache.adapter.spec.ts`

**New — CORE:**
- `libs/core/src/listings/domain/types/category-parameter.types.ts`
- `libs/core/src/listings/domain/ports/capabilities/category-parameters-reader.capability.ts`
- `libs/core/src/listings/domain/ports/capabilities/__tests__/category-parameters-reader.guard.spec.ts`
- `libs/core/src/listings/domain/exceptions/category-not-found.exception.ts`

**New — Allegro adapter:**
- `libs/integrations/allegro/src/infrastructure/adapters/__fixtures__/category-parameters-257933.json` — single fixture covering **both** dependency mechanisms in one capture: parameter `229205` ("Stan opakowania") has parameter-level visibility (`options.dependsOnParameterId: "11323"`) AND its dictionary entries carry `dependsOnValueIds: ["11323_..."]` arrays. A second fixture is therefore not required for #410.
- `libs/integrations/allegro/src/infrastructure/mappers/allegro-category-parameter.mapper.ts`
- `libs/integrations/allegro/src/infrastructure/mappers/__tests__/allegro-category-parameter.mapper.spec.ts`

**New — API:**
- `apps/api/src/listings/http/dto/category-parameter-response.dto.ts`

**New — FE (kebab-case filenames per `frontend-architecture.md` §"Naming conventions"):**
- `apps/web/src/shared/ui/combobox.tsx` + `combobox.test.tsx` — virtualized combobox primitive
- `apps/web/src/features/listings/components/category-parameters-step.tsx` + `category-parameters-step.test.tsx`
- `apps/web/src/features/listings/components/auto-prefill-parameters.ts` + `auto-prefill-parameters.test.ts`
- `apps/web/src/features/listings/components/serialize-allegro-parameters.ts` + `serialize-allegro-parameters.test.ts`
- `apps/web/src/features/listings/components/build-parameters-zod-schema.ts` + `build-parameters-zod-schema.test.ts`
- `apps/web/src/features/listings/hooks/use-category-parameters-query.ts`

**Edited:**
- `libs/shared/src/index.ts` — export cache barrel
- `libs/core/src/listings/index.ts` — export new types + capability + exception
- `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` — expand `AllegroCategoryParametersResponse`
- `libs/integrations/allegro/src/allegro-integration.module.ts` — wire `CachePort` into adapter factory
- `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` — implement capability with `CachePort`, refactor `fetchOfferIdentifiers`
- `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` — new specs
- `apps/api/src/listings/http/listings.controller.ts` — new endpoint (existing prefix `@Controller('listings')` confirmed)
- `apps/api/src/listings/http/__tests__/listings.controller.spec.ts` — new specs
- `apps/web/src/features/listings/api/listings.api.ts` — new method
- `apps/web/src/features/listings/api/listings.types.ts` — new types
- `apps/web/src/features/listings/api/listings.query-keys.ts` — new key
- `apps/web/src/features/listings/components/CreateOfferWizard.tsx` — insert Step 2, dynamic Zod, submit serializer, retry deep-link, sticky footer
- `apps/web/src/features/listings/components/CreateOfferWizard.test.tsx` — extend coverage
- `apps/web/src/features/listings/components/create-offer-fields.schema.ts` — extend with `parameters` field
- `apps/web/src/features/listings/components/create-offer-request-to-form-values.ts` — round-trip retry pre-fill
- `apps/web/src/index.css` — Combobox tokens and category-parameters-step styles

> Existing FE component files (`CreateOfferWizard.tsx`, `CategoryPicker.tsx`, etc.) keep their PascalCase names — the kebab-case rule applies to new files.

## 3. Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (≥ 1024 px)                         │
│  CreateOfferWizard (5 steps)                                              │
│    0. Connection & Variant                                                │
│    1. Offer details (title / category / price / stock)                    │
│    2. Category parameters  ← NEW                                          │
│        ├─ useCategoryParametersQuery(connectionId, categoryId)            │
│        ├─ auto-prefill (EAN + Stan)                                       │
│        ├─ build dynamic Zod schema (parameter-visibility +                │
│        │   dictionary-entry filtering)                                    │
│        ├─ render fields (dispatch on type × restrictions)                 │
│        ├─ visibility filter via parameter.dependsOn                       │
│        └─ option filter via dictionary[i].dependsOnParameterValueIds      │
│    3. Policies                                                            │
│    4. Review                                                              │
│         submit → serialize parameters[] → POST /listings/.../offers       │
│         on validation errors → form.setError + "Edit parameters" deep-link│
│                                                                           │
│  < 1024 px → EmptyState "Open on a desktop screen to edit" + Back link    │
└────────────────────────────────────────┬──────────────────────────────────┘
                                         │ HTTP GET
                                         ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                                API                                        │
│  ListingsController (@Controller('listings'))                             │
│    GET /listings/connections/:connectionId/categories/:categoryId/        │
│      parameters                                                           │
│      ↓                                                                    │
│    IntegrationsService.getCapabilityAdapter('OfferManager')               │
│      ↓ narrow via isCategoryParametersReader(adapter)                     │
│      ↓ if not supported → 501 NotImplementedException                     │
│      ↓                                                                    │
│    adapter.fetchCategoryParameters({ categoryId }) → CategoryParameter[]  │
└────────────────────────────────────────┬──────────────────────────────────┘
                                         │
                                         ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         ALLEGRO ADAPTER                                   │
│  AllegroOfferManagerAdapter implements …, CategoryParametersReader        │
│    fetchCategoryParameters({ categoryId })                                │
│      1. CachePort.get(allegro:cat-params:{categoryId})                    │
│      2. miss → HTTP GET /sale/categories/{id}/parameters                  │
│      3. raw → neutral via allegro-category-parameter.mapper               │
│      4. CachePort.set(...) ttl=24h (env-overridable)                      │
│      5. return CategoryParameter[]                                        │
└──────────────┬────────────────────────────────────────────────────────────┘
               │ uses                                              ▲
               ▼                                                   │
┌───────────────────────────────────────────────────────────────┐  │
│                  libs/shared/src/cache/                        │  │
│  CachePort (interface)                                         │  │
│  RedisCacheAdapter (wraps existing 'REDIS_CLIENT')             │  │
│  CACHE_PORT_TOKEN (Symbol)                                     │  │
└───────────────────────────────────────────────────────────────┘  │
                                                                   │
CORE (libs/core/src/listings/):                                    │
  domain/types/category-parameter.types.ts                         │
  domain/ports/capabilities/category-parameters-reader.capability.ts ─┘
  domain/exceptions/category-not-found.exception.ts
```

## 4. CORE — types, capability, exception

### 4.1 Neutral parameter type — two distinct dependency mechanisms

**Critical correction (post-tech-review):** Allegro models two independent dependency mechanisms; the neutral type must surface both:

1. **Parameter visibility** — a parameter is shown/hidden based on a parent parameter's value. Modeled as `parameter.dependsOn`.
2. **Dictionary-entry filtering** — within a *visible* dictionary parameter, individual entries appear/disappear based on a parent's value. Modeled per-entry as `dictionary[i].dependsOnParameterValueIds`.

Conflating these (as the previous draft did) silently mis-renders both classes of category. Capture a second sandbox fixture before locking the implementation (see §8 step 1b).

```ts
// libs/core/src/listings/domain/types/category-parameter.types.ts

/**
 * Category Parameter Types
 *
 * Marketplace-neutral shape for category parameters. The 4 base types
 * (dictionary | string | integer | float) and the restriction flags
 * generalize across Allegro / eBay / Amazon / Shopify.
 *
 * Allegro distinguishes two dependency mechanisms — both are surfaced:
 *   - parameter-level visibility (`dependsOn`)
 *   - dictionary-entry filtering (`dependsOnParameterValueIds`)
 *
 * @module libs/core/src/listings/domain/types
 */

export const CategoryParameterTypeValues = [
  'dictionary',
  'string',
  'integer',
  'float',
] as const;
export type CategoryParameterType = (typeof CategoryParameterTypeValues)[number];

export interface CategoryParameterDictionaryEntry {
  id: string;
  value: string;
  /**
   * Entry-level dependency. When present, this entry is selectable only when
   * the parent parameter (identified by `parameter.dependsOn?.parameterId`,
   * if any) has one of these value IDs. Independent from parameter-level
   * visibility — a parameter can be visible while only a subset of its
   * dictionary entries is selectable for a given parent value.
   */
  dependsOnParameterValueIds?: string[];
}

export interface CategoryParameterRestrictions {
  /** Dictionary multi-select. */
  multipleChoices?: boolean;
  /** Numeric range — user supplies { from, to } instead of single value. */
  range?: boolean;
  /** Numeric bounds. */
  min?: number;
  max?: number;
  /** String length bounds. */
  minLength?: number;
  maxLength?: number;
  /** Float decimal precision. */
  precision?: number;
  /** SINGLE = max one value, MULTIPLE = many. Allegro-derived but generic. */
  allowedNumberOfValues?: 'SINGLE' | 'MULTIPLE';
  /** Dictionary allows free-text values alongside the dictionary list (combobox). */
  customValuesEnabled?: boolean;
}

/**
 * Parameter-level visibility dependency. The parameter is hidden until
 * the parent has one of these values. Used for true show/hide semantics —
 * NOT for filtering dictionary entries within an already-visible parameter.
 */
export interface CategoryParameterDependsOn {
  parameterId: string;
  valueIds: string[];
}

export interface CategoryParameter {
  id: string;
  name: string;
  type: CategoryParameterType;
  required: boolean;
  /** Optional unit label (e.g. "mm", "kg"). */
  unit?: string;
  /** Present when type === 'dictionary'. Entries may carry their own `dependsOnParameterValueIds`. */
  dictionary?: CategoryParameterDictionaryEntry[];
  restrictions: CategoryParameterRestrictions;
  /** Parameter-level visibility (show/hide). Distinct from per-entry filtering. */
  dependsOn?: CategoryParameterDependsOn;
}
```

**What is deliberately not modeled in CORE for #410:**

- Allegro's `requiredIf` / `displayedIf` (richer JSONPath-ish predicates) — if a category needs them, the worst case is the user submits and Allegro returns a validation error, the same failure mode as today. Add later if real-world data demands it.
- Allegro's `formerData` — adapter-only legacy field.
- Allegro's `options.describesProduct` / `options.saleProperty` — adapter-internal flags.

### 4.2 Capability + guard

```ts
// libs/core/src/listings/domain/ports/capabilities/category-parameters-reader.capability.ts

/**
 * Category Parameters Reader Capability
 *
 * Optional sub-capability of OfferManagerPort. Implemented by adapters that
 * expose marketplace category parameter schemas (e.g. Allegro). Returns the
 * full parameter set — required + optional. UI decides what to surface.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { CategoryParameter } from '../../types/category-parameter.types';

export interface CategoryParametersReader {
  fetchCategoryParameters(input: { categoryId: string }): Promise<CategoryParameter[]>;
}

export function isCategoryParametersReader(
  adapter: unknown,
): adapter is CategoryParametersReader {
  return (
    typeof adapter === 'object' &&
    adapter !== null &&
    typeof (adapter as { fetchCategoryParameters?: unknown }).fetchCategoryParameters === 'function'
  );
}
```

Pattern matches the existing capabilities in
`libs/core/src/listings/domain/ports/capabilities/`. Barrel-export from
`@openlinker/core/listings`.

### 4.3 Domain exception

```ts
// libs/core/src/listings/domain/exceptions/category-not-found.exception.ts

/**
 * Category Not Found Exception
 *
 * Thrown by adapters implementing CategoryParametersReader when the
 * marketplace returns 404 for a categoryId.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class CategoryNotFoundException extends Error {
  constructor(categoryId: string, platform: string) {
    super(`Category not found: ${categoryId} (platform=${platform})`);
    this.name = 'CategoryNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
```

Auth and generic-upstream errors continue to use the existing
`IntegrationError` family in the Allegro adapter.

## 5. Allegro adapter

### 5.1 Expand `AllegroCategoryParametersResponse` to real shape

The captured fixture from sandbox `/sale/categories/257933/parameters`
shows the real shape (visibility-style dependencies). A second fixture
exercising **dictionary-entry filtering** must be captured before
implementation locks (see §8 step 1b).

```ts
// libs/integrations/allegro/src/domain/types/allegro-api.types.ts (replace stub)

export interface AllegroCategoryParameter {
  id: string;
  name: string;
  type: 'dictionary' | 'string' | 'integer' | 'float';
  required: boolean;
  requiredForProduct?: boolean;
  /** JSONPath-ish conditional predicates. Adapter-only — not surfaced to CORE. */
  requiredIf?: unknown;
  displayedIf?: unknown;
  unit?: string;
  options?: {
    ambiguousValueId?: string;
    /** Parent parameter id when this parameter has visibility-level dependency. */
    dependsOnParameterId?: string;
    describesProduct?: boolean;
    customValuesEnabled?: boolean;
  };
  /**
   * Inline dictionary entries; Marka has ~5000 entries.
   * `dependsOnParameterValueIds` on an entry is the entry-level filter
   * (independent from `options.dependsOnParameterId`).
   */
  dictionary?: Array<{
    id: string;
    value: string;
    dependsOnParameterValueIds?: string[];
  }>;
  restrictions?: {
    multipleChoices?: boolean;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    range?: boolean;
    precision?: number;
    allowedNumberOfValues?: 'SINGLE' | 'MULTIPLE';
  };
  /** Legacy migration data — adapter ignores. */
  formerData?: unknown;
}

export interface AllegroCategoryParametersResponse {
  parameters: AllegroCategoryParameter[];
}
```

### 5.2 Raw → neutral mapper (separates the two dependency mechanisms)

```ts
// libs/integrations/allegro/src/infrastructure/mappers/allegro-category-parameter.mapper.ts

/**
 * Allegro Category Parameter Mapper
 *
 * Maps Allegro's raw parameter response shape to the marketplace-neutral
 * CategoryParameter contract. Surfaces both dependency mechanisms:
 *   - parameter-level visibility (options.dependsOnParameterId)
 *   - dictionary-entry filtering (dictionary[i].dependsOnParameterValueIds)
 *
 * @module libs/integrations/allegro/src/infrastructure/mappers
 */
import type {
  CategoryParameter,
  CategoryParameterDictionaryEntry,
} from '@openlinker/core/listings';
import type { AllegroCategoryParameter } from '../../domain/types/allegro-api.types';

export function toNeutralCategoryParameter(
  raw: AllegroCategoryParameter,
): CategoryParameter {
  const dependsOnParameterId = raw.options?.dependsOnParameterId;

  // Parameter-level visibility: the union of every dictionary entry's
  // dependsOnParameterValueIds is the set of parent values for which
  // *any* option of this parameter is selectable. If that union is empty
  // and dependsOnParameterId is also absent, the parameter has no
  // parameter-level dependency.
  const visibilityValueIds = dependsOnParameterId
    ? unionEntryParentValues(raw.dictionary ?? [])
    : [];

  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    required: raw.required,
    unit: raw.unit,
    dictionary: raw.dictionary?.map(toNeutralEntry),
    restrictions: {
      multipleChoices: raw.restrictions?.multipleChoices,
      range: raw.restrictions?.range,
      min: raw.restrictions?.min,
      max: raw.restrictions?.max,
      minLength: raw.restrictions?.minLength,
      maxLength: raw.restrictions?.maxLength,
      precision: raw.restrictions?.precision,
      allowedNumberOfValues: raw.restrictions?.allowedNumberOfValues,
      customValuesEnabled: raw.options?.customValuesEnabled,
    },
    dependsOn:
      dependsOnParameterId && visibilityValueIds.length > 0
        ? { parameterId: dependsOnParameterId, valueIds: visibilityValueIds }
        : undefined,
  };
}

function toNeutralEntry(d: NonNullable<AllegroCategoryParameter['dictionary']>[number]): CategoryParameterDictionaryEntry {
  return {
    id: d.id,
    value: d.value,
    dependsOnParameterValueIds: d.dependsOnParameterValueIds,
  };
}

function unionEntryParentValues(
  dict: Array<{ dependsOnParameterValueIds?: string[] }>,
): string[] {
  const set = new Set<string>();
  for (const entry of dict) {
    for (const id of entry.dependsOnParameterValueIds ?? []) set.add(id);
  }
  return [...set];
}
```

### 5.3 Adapter implementation + `CachePort` wiring

```ts
// libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts

class AllegroOfferManagerAdapter
  implements OfferManagerPort, /* … existing … */, CategoryParametersReader {

  // injected via factory:
  //   private readonly cache: CachePort,

  private readonly catParamsTtlSec: number;

  constructor(/* …, */ private readonly cache: CachePort, configService: ConfigService) {
    this.catParamsTtlSec = Number(configService.get('OL_ALLEGRO_CAT_PARAMS_TTL_SEC') ?? 86400);
    // … existing
  }

  async fetchCategoryParameters(input: { categoryId: string }): Promise<CategoryParameter[]> {
    const cacheKey = `allegro:cat-params:${input.categoryId}`;
    const cached = await this.cache.get<CategoryParameter[]>(cacheKey);
    if (cached) return cached;

    this.logger.debug(
      `Fetching Allegro category parameters: connection=${this.connectionId} categoryId=${input.categoryId}`,
    );

    let response: AxiosResponse<AllegroCategoryParametersResponse>;
    try {
      response = await this.httpClient.get<AllegroCategoryParametersResponse>(
        `/sale/categories/${input.categoryId}/parameters`,
      );
    } catch (err) {
      if (isAllegroNotFound(err)) {
        throw new CategoryNotFoundException(input.categoryId, 'allegro');
      }
      throw err; // existing IntegrationError mapping handles auth / 5xx etc.
    }

    const neutral = (response.data.parameters ?? []).map(toNeutralCategoryParameter);
    await this.cache.set(cacheKey, neutral, this.catParamsTtlSec);
    return neutral;
  }
}
```

**Cache notes:**

- **`CachePort` is introduced in this PR** at `libs/shared/src/cache/` — it does not currently exist (verified during planning). Existing infrastructure exposes only a raw `'REDIS_CLIENT'` string token via `RedisConfigModule`; the new `CachePort` wraps it. See §5a.
- Key is **global** (`allegro:cat-params:{categoryId}`), not connection-scoped — Allegro category schemas are public taxonomy and identical for every seller.
- **TTL: env-overridable** via `OL_ALLEGRO_CAT_PARAMS_TTL_SEC` (default `86400`). Allows quick cache-bust during sandbox debug; keys can also be deleted directly via `redis-cli`.
- Cache stores the *neutral* shape, not the raw Allegro response — cleaner invalidation semantics if mapping is adjusted.

### 5.4 Refactor `fetchOfferIdentifiers`

Currently calls `httpClient.get<AllegroCategoryParametersResponse>` directly.
Refactor to call `this.fetchCategoryParameters({ categoryId })` (cached
+ neutral) and find the EAN parameter by name. Single source of truth for
the endpoint call.

### 5.5 Tests

- **Mapper spec** (`allegro-category-parameter.mapper.spec.ts`): use both fixtures —
  - `category-parameters-257933.json` → assert per-type round-trip, restriction propagation, parameter-level `dependsOn` derivation, `customValuesEnabled` hoist.
  - `category-parameters-cascading-dictionary.json` → assert that dictionary entries with `dependsOnParameterValueIds` carry the field through to the neutral entry, and that parameter-level `dependsOn` is **only** derived when `options.dependsOnParameterId` is set.
- **Adapter spec** (`allegro-offer-manager.adapter.spec.ts`): cache hit (no HTTP call), cache miss (HTTP + cache write), 404 → `CategoryNotFoundException`, env-overridden TTL, `fetchOfferIdentifiers` continues to find EAN after refactor.

## 5a. Shared `CachePort` (new infrastructure)

> Introduced in this PR because no cache abstraction exists today and `engineering-standards.md` discourages coupling adapters to string DI tokens.

```ts
// libs/shared/src/cache/cache.types.ts
export const CACHE_PORT_TOKEN = Symbol('CachePort');
```

```ts
// libs/shared/src/cache/cache.port.ts

/**
 * Cache Port
 *
 * Contract for distributed key-value caching. Wraps the existing global
 * 'REDIS_CLIENT' provider behind a refactor-safe Symbol token.
 *
 * @module libs/shared/src/cache
 */
export interface CachePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;
  delete(key: string): Promise<void>;
}
```

```ts
// libs/shared/src/cache/redis-cache.adapter.ts

/**
 * Redis Cache Adapter
 *
 * Implements CachePort over the existing 'REDIS_CLIENT' provider. Stores
 * values as JSON. Logs warnings on parse failure; returns null on cache miss.
 *
 * @module libs/shared/src/cache
 */
import { Inject, Injectable } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { Logger } from '../logging';
import type { CachePort } from './cache.port';

@Injectable()
export class RedisCacheAdapter implements CachePort {
  private readonly logger = new Logger(RedisCacheAdapter.name);

  constructor(@Inject('REDIS_CLIENT') private readonly client: RedisClientType) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`Failed to parse cache value for key ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), { EX: ttlSec });
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}
```

```ts
// libs/shared/src/cache/cache.module.ts

/**
 * Cache Module
 *
 * Binds CachePort to RedisCacheAdapter. Imports the global RedisConfigModule
 * for the underlying 'REDIS_CLIENT' provider.
 *
 * @module libs/shared/src/cache
 */
import { Global, Module } from '@nestjs/common';
import { RedisConfigModule } from '../redis';
import { RedisCacheAdapter } from './redis-cache.adapter';
import { CACHE_PORT_TOKEN } from './cache.types';

@Global()
@Module({
  imports: [RedisConfigModule],
  providers: [
    RedisCacheAdapter,
    { provide: CACHE_PORT_TOKEN, useExisting: RedisCacheAdapter },
  ],
  exports: [CACHE_PORT_TOKEN],
})
export class CacheModule {}
```

`AllegroIntegrationModule` imports `CacheModule` and the adapter factory
injects `CACHE_PORT_TOKEN`.

**Test:** `redis-cache.adapter.spec.ts` — round-trip get/set, TTL forwarded
to underlying client, JSON parse failure returns null + logs warning,
delete clears.

## 6. API — `GET /listings/connections/:connectionId/categories/:categoryId/parameters`

> The `ListingsController` base path is `@Controller('listings')` (verified during planning).

### 6.1 Controller (no service facade — direct `IIntegrationsService` use)

> The previous draft mentioned a `ListingsCategoryParametersService` facade
> in §3 that contradicted the controller code. **Decision: drop the
> facade** — the controller is a thin read endpoint and routing through
> `IIntegrationsService` directly is consistent with sibling listings
> endpoints. If cross-controller reuse emerges later, introduce the
> service then.

```ts
@Get('connections/:connectionId/categories/:categoryId/parameters')
@UseGuards(JwtAuthGuard)
async getCategoryParameters(
  @Param('connectionId') connectionId: string,
  @Param('categoryId') categoryId: string,
): Promise<{ parameters: CategoryParameterResponseDto[] }> {
  const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
    connectionId,
    'OfferManager',
  );
  if (!isCategoryParametersReader(adapter)) {
    throw new NotImplementedException(
      `Adapter for connection ${connectionId} does not support CategoryParametersReader`,
    );
  }
  const parameters = await adapter.fetchCategoryParameters({ categoryId });
  return { parameters: parameters.map(toCategoryParameterResponseDto) };
}
```

### 6.2 Response DTO

`apps/api/src/listings/http/dto/category-parameter-response.dto.ts` —
class with `class-validator` + `@ApiProperty` decorators, mirroring
`CategoryParameter` 1:1 (including the per-entry `dependsOnParameterValueIds`).

### 6.3 Tests

- happy path: returns `{ parameters: [...] }` with mapped DTOs.
- connection not found → 404 (existing `getCapabilityAdapter` behavior).
- adapter doesn't support capability → 501 NotImplementedException.
- adapter throws `CategoryNotFoundException` → propagates as 404 via existing exception filter (or wrap in a NestJS `NotFoundException` if filter mapping doesn't catch it — verify during implementation).

## 7. FE — wizard integration (desktop ≥ 1024 px)

### 7.1 API client + query hook

```ts
// apps/web/src/features/listings/api/listings.types.ts
export interface CategoryParameterDictionaryEntry {
  id: string;
  value: string;
  dependsOnParameterValueIds?: string[]; // entry-level filter
}

export interface CategoryParameter {
  id: string;
  name: string;
  type: 'dictionary' | 'string' | 'integer' | 'float';
  required: boolean;
  unit?: string;
  dictionary?: CategoryParameterDictionaryEntry[];
  restrictions: {
    multipleChoices?: boolean;
    range?: boolean;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    precision?: number;
    allowedNumberOfValues?: 'SINGLE' | 'MULTIPLE';
    customValuesEnabled?: boolean;
  };
  dependsOn?: { parameterId: string; valueIds: string[] }; // parameter-level visibility
}

// apps/web/src/features/listings/api/listings.query-keys.ts
export const listingsQueryKeys = {
  // …existing keys
  categoryParameters: (connectionId: string, categoryId: string) =>
    ['listings', 'category-parameters', connectionId, categoryId] as const,
};

// apps/web/src/features/listings/hooks/use-category-parameters-query.ts
export function useCategoryParametersQuery(
  connectionId: string | undefined,
  categoryId: string | undefined,
): UseQueryResult<CategoryParameter[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: listingsQueryKeys.categoryParameters(connectionId ?? '', categoryId ?? ''),
    queryFn: () => apiClient.listings.fetchCategoryParameters(connectionId!, categoryId!),
    enabled: Boolean(connectionId && categoryId),
    staleTime: 24 * 60 * 60 * 1000, // matches Redis TTL default
  });
}
```

### 7.2 Virtualized `Combobox` primitive — design spec

`apps/web/src/shared/ui/combobox.tsx` (kebab-case per
`frontend-architecture.md` §"Naming conventions"). Wraps
`shared/ui/popover.tsx` (which itself wraps `@radix-ui/react-popover`)
for portal + positioning + dismissal — inherits focus management for
free.

**Density & tokens** (matches `frontend-ui-style-guide.md` §"Density & Row Heights"):

| Element | Spec |
|---|---|
| Trigger height | `32px` (matches `Input` / `Select`) |
| Trigger radius | `6px` |
| Trigger border (resting) | `--border-default` |
| Trigger border (focus) | `--accent-focus` |
| Listbox panel padding | `4px` |
| Listbox panel radius | `8px` |
| Listbox panel border | `--border-default` |
| Listbox panel shadow | level-1 only (no glow) |
| Option row height | `32px` desktop / `40px` touch (`@media (pointer: coarse)`) |
| Option resting bg | `transparent` |
| Option hover bg | `--bg-surface-hover` |
| Option selected bg | `--bg-surface-muted` + `--text-primary` `font-weight: 600` |
| Option label font | body `13.5/20` |
| Secondary metadata (id) | `12/16` `--text-muted` (mono if id) |

**Variants:**

- `mode="single"` → returns single `id` string.
- `mode="multi"` → returns `id[]`. Selected items render as inline chips inside the trigger (28px height, `--bg-surface-muted` background, ✕ remove). Overflow `+N more`.
- `customValues={true}` → free-text passthrough. Behavior in §7.3.

**Filter-first behavior** (mandatory for dictionaries with `entries.length ≥ 50`):

- On open, autofocus the search input.
- Show **no options** until the user types ≥ 1 character.
- Render counter line: `Showing {visible} of {total} options`.
- Empty-search state: `Type to search {parameterName}…`.

**ARIA combobox pattern:**

- Trigger: `role="combobox"`, `aria-expanded`, `aria-controls={listboxId}`, `aria-autocomplete="list"`.
- Listbox: `role="listbox"`, `aria-multiselectable={multi}`.
- Options: `role="option"`, `aria-selected`.
- Keyboard: `ArrowDown`/`ArrowUp` (with virtualizer scrollIntoView), `Home`/`End`, `Enter` to commit, `Escape` to dismiss, `Backspace` removes last chip in multi-mode when input is empty.

**Virtualization:**

`@tanstack/react-virtual` (verify already a transitive dep via
`@tanstack/react-table`; otherwise add). Active when `entries.length ≥ 200`.

**Test:** `combobox.test.tsx` — single, multi, custom passthrough, filter-first
gating, keyboard nav, virtualization activation threshold.

### 7.3 `category-parameters-step` component

`apps/web/src/features/listings/components/category-parameters-step.tsx`.

**Header:**
- Single line: `Category {categoryId} · {leafName}` — `leafName` from existing category cache. Mono for `categoryId`. Avoids the cost of building a multi-segment breadcrumb endpoint for #410. (Breadcrumb endpoint is a follow-up if operators ask.)

**States:**
- **loading** → `<LoadingState>` skeleton — N=5 skeleton FormField rows at the documented row heights so layout doesn't shift on data arrival.
- **error** → `<Alert tone="error">` with retry button.
- **empty** (`parameters.length === 0`) → `<EmptyState>` `"No additional parameters required for this category."` + **pre-focused Continue button** (operator advances deliberately; no auto-advance).
- **data** → render the fields.

**Layout:**
- **Required-first** section, expanded.
- **Optional** behind a `<details>`-style expander: `Show optional fields ({visibleOptionalCount})`. Count uses `useMemo` keyed on visibility — recomputes on every form change.

**Visibility filter (`dependsOn`):**
- Each parameter checks `dependsOn` against current form values; hidden parameters are skipped.
- On hide, form values are cleared via `form.setValue(p.id, undefined)` in an effect (matches Q3 grilling decision).
- On submit failure where Zod cites a hidden-but-required field: the optional expander auto-opens, the field is scrolled into view, and a transient `<Toast>` reads `"{N} additional fields became required"`.

**Dictionary-entry filtering visual cue:**

When a parent parameter narrows visible dictionary entries for a child parameter (via per-entry `dependsOnParameterValueIds`), the child field renders a `12/16` muted helper line above the input:

```
Filtered by {parentParameter.name}: {parentValue.label}
```

Operator immediately understands why their option list is shorter than the full dictionary. Helper line drops when the parent has no value yet (and the field is therefore filtered to its always-available subset, or empty).

**Renderer dispatch on `(type, restrictions)`:**

| `(type, restrictions)` | Renderer |
|---|---|
| `dictionary`, `entries.length < 50`, single | native `<Select>` |
| `dictionary`, `entries.length ≥ 50` or `customValuesEnabled`, single | `<Combobox mode="single">` |
| `dictionary`, `multipleChoices: true` | `<Combobox mode="multi">` |
| `dictionary`, `customValuesEnabled: true` | `<Combobox customValues>` |
| `string` | `<Input>` text |
| `integer`, no `range` | `<Input type="number">` (integer step) |
| `integer`, `range: true` | `[from] – [to] [unit]` inline (two `<Input type="number">`) |
| `float`, no `range` | `<Input type="number">` (decimal step from `precision`) |
| `float`, `range: true` | `[from] – [to] [unit]` inline |

**`customValuesEnabled` affordance** (UX-visible, not just submit logic):

- Combobox placeholder: `"Pick from list or type a custom value"` when focused.
- Listbox bottom row when typed input doesn't match: `"Use as custom value: «typed»"` — selecting commits as free text.
- Custom-value chip differentiated by `border-left: 2px dotted var(--border-strong)` (shape, not color, per `frontend-ui-style-guide.md` rule "color must never be the only signal").

**Auto-fill hint** (§7.4):

- Subtitle below input: `"Auto-filled from variant data"`, `12/16` `--text-muted`, no icon, no color. Disappears when the field becomes RHF-dirty.

**Typography slot pinning:**

- Step eyebrow ("Category parameters") → `0.6875rem / 600 / 0.09em`.
- Step description ("Required and optional fields for {category}") → `0.875rem` body.
- Parameter label → `0.75rem / 600 / 0.05em` (FormField label slot).
- Parameter description → `0.75rem / 400` muted.
- Required asterisk → `--status-error` text after label, no other color.

Co-located test (`category-parameters-step.test.tsx`): required validation,
type dispatch, parameter-visibility hide-and-clear, dictionary-entry
filtering narrows options, customValues passthrough, prefill apply,
empty state renders pre-focused Continue, auto-expand on hidden-required
error.

### 7.4 Auto-prefill helper

```ts
// apps/web/src/features/listings/components/auto-prefill-parameters.ts

const EAN_NAME_PATTERNS = ['ean (gtin)', 'ean', 'gtin', 'kod ean'];
const CONDITION_NAME_PATTERNS = ['stan'];
const NEW_VALUE_PATTERNS = ['nowy', 'new'];

export function autoPrefillParameters(
  parameters: CategoryParameter[],
  variant: { ean?: string },
): Record<string, FormParameterValue> {
  const out: Record<string, FormParameterValue> = {};
  for (const p of parameters) {
    const nameLower = p.name.toLowerCase();

    if (EAN_NAME_PATTERNS.includes(nameLower) && variant.ean) {
      out[p.id] = variant.ean;
      continue;
    }

    if (CONDITION_NAME_PATTERNS.includes(nameLower) && p.type === 'dictionary') {
      const newOption = p.dictionary?.find((d) =>
        NEW_VALUE_PATTERNS.includes(d.value.toLowerCase()),
      );
      if (newOption) out[p.id] = newOption.id;
    }
  }
  return out;
}
```

Applied via `form.reset({ …current, parameters: { …prefilled, …current.parameters } })`
when parameters first load (via `useEffect` keyed on the parameters reference).
Already-typed values win over prefill (don't clobber on re-fetch). Brand /
producer-code prefill is deferred to **#412**.

### 7.5 Dynamic Zod schema (handles both dependency mechanisms)

```ts
// apps/web/src/features/listings/components/build-parameters-zod-schema.ts
export function buildParametersZodSchema(parameters: CategoryParameter[]): z.ZodTypeAny {
  return z.object(
    Object.fromEntries(parameters.map((p) => [p.id, fieldSchema(p)])),
  ).superRefine((values, ctx) => {
    for (const p of parameters) {
      if (!isParameterVisible(p, values)) continue;          // dependsOn check
      if (!p.required) continue;
      if (isEmpty(values[p.id])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [p.id],
          message: `${p.name} is required`,
        });
      }
      // Reject dictionary value(s) whose entry is filtered out by current parent value
      if (p.type === 'dictionary' && p.dependsOn) {
        const allowedIds = allowedDictionaryEntryIds(p, values);
        const selected = toIdArray(values[p.id]);
        for (const id of selected) {
          if (!allowedIds.has(id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [p.id],
              message: `${p.name}: selected option is not available for current ${p.dependsOn.parameterId}`,
            });
          }
        }
      }
    }
  });
}
```

`isParameterVisible(p, values)` → checks `p.dependsOn` against current parent value.
`allowedDictionaryEntryIds(p, values)` → returns the set of dictionary entry IDs whose `dependsOnParameterValueIds` includes the current parent value (or whose field is empty, meaning "available regardless").

Schema rebuilt + memoized whenever `parameters` reference changes; merged
with the existing wizard schema and plumbed into RHF via
`useForm({ resolver: zodResolver(combinedSchema) })`.

### 7.6 Submit serializer

```ts
// apps/web/src/features/listings/components/serialize-allegro-parameters.ts
export function serializeAllegroParameters(
  values: Record<string, FormParameterValue>,
  meta: CategoryParameter[],
): { submitted: AllegroParameterInput[] } {
  const submitted = meta
    .filter((p) => isParameterVisible(p, values))
    .map((p) => mapOne(p, values[p.id]))
    .filter((x): x is AllegroParameterInput => x !== null);
  return { submitted };
}
```

`mapOne` handles the four cases (single dictionary, multi dictionary,
range, scalar). For `customValuesEnabled`: if user input matches a
dictionary entry (case-insensitive, trimmed) → emit `valuesIds`, else
`values`. Output is appended to `platformParams.parameters`.

The function returns `{ submitted }` (an object, not a bare array) so the
caller can keep the array reference alongside the form-level submission
state and use it for error mapping (§7.7).

### 7.7 Wizard integration in `CreateOfferWizard.tsx`

- Update `STEP_LABELS` to 5 steps:
  ```
  ['Connection & Variant', 'Offer details', 'Category parameters', 'Policies', 'Review']
  ```
- Update `STEP_FIELDS[2]` to validate `parameters` field on advance.
- Pre-fetch `useCategoryParametersQuery` at wizard mount once `categoryId` is set; when the user reaches Step 2 the data is usually already there.
- On `categoryId` change in Step 1, clear `parameters` form values (`form.setValue('parameters', {})`) — schemas differ per category.
- Render `<CategoryParametersStep>` when `stepIndex === 2`.
- Submit serializer (§7.6) called inside the existing `toApiInput` mapper before `useCreateOfferMutation`.
- **Sticky wizard footer on Step 2:** the Back/Continue footer position-sticks at the bottom of the wizard card (`position: sticky; bottom: 0; background: var(--bg-surface); border-top: 1px solid var(--border-subtle); padding: 12px 16px;`). Optional sections can grow long; Continue must remain in reach.

**Error-mapping snapshot (explicit lifetime):**

```
1. serializeAllegroParameters(values, meta) → { submitted }
2. Wizard captures `submittedSnapshot = submitted` in component state at submit time.
3. useCreateOfferMutation runs; on validation error:
4.    for each error in error.validation.errors:
5.        const m = error.path?.match(/^parameters\[(\d+)\]/);
6.        const paramId = m ? submittedSnapshot[Number(m[1])]?.id : null;
7.        if (paramId) form.setError(`parameters.${paramId}`, { message: error.userMessage ?? error.message });
```

The snapshot **must** come from the serializer's submitted array (with hidden parameters filtered out) — `parameters[N]` indexes that array, not the metadata array.

Add a "Edit parameters" button on the Review step that calls `setStepIndex(2)`.

### 7.8 Retry pre-fill

`create-offer-request-to-form-values.ts` — extract the existing
`platformParams.parameters` array on retry; store as raw passthrough
in form state until the parameters query resolves; on parameters load,
hydrate form values against the schema (mismatched parameter IDs are
dropped; mismatched dictionary value-IDs are dropped — schema is the
source of truth).

### 7.9 Tests

- `combobox.test.tsx` — see §7.2.
- `category-parameters-step.test.tsx` — see §7.3.
- `auto-prefill-parameters.test.ts` — EAN, Stan, no-match, missing variant fields.
- `serialize-allegro-parameters.test.ts` — single, multi, range, customValues match-or-passthrough, hidden-skipped, returns `{ submitted }` shape.
- `build-parameters-zod-schema.test.ts` — required + visible blocks submit, hidden required passes, dictionary-entry filter rejects orphan selections, range cross-field.
- `CreateOfferWizard.test.tsx` extension — 5-step layout, params loaded on category change, parameters cleared on category change, retry pre-fill, error-mapping deep-link, sub-1024 viewport renders the desktop-only affordance (see §7.10).

### 7.10 Responsive — desktop-only for #410

Per `frontend-ui-style-guide.md` §Responsive ("Complex editors → read-only +
'open on desktop to edit' below 1024 px"), the create-offer wizard ships
**desktop-only** in this PR:

- **`< 1024 px`** — the wizard route renders `<EmptyState>` with copy
  *"Open on a desktop screen to edit"* + `<BackLink>` to `/listings`.
  Continue / Save are not rendered. The state lives at the wizard root,
  so all steps share the affordance.
- **`≥ 1024 px`** — full wizard as designed in §7.1–§7.9.

Implementation: a single `useMediaQuery('(min-width: 1024px)')` gate at
`CreateOfferWizard.tsx` top-level. Existing `useMediaQuery` hook in
`shared/utils` (verify during implementation; trivial to add otherwise).

This applies to **all** wizard steps, not just the new Step 2 — the
existing Steps 0/1/3/4 also fail the responsive parity rule for "complex
editors". Documenting this here keeps it explicit; mobile/tablet
interactivity is a separate epic.

Test: `CreateOfferWizard.test.tsx` mocks `matchMedia` and asserts the
empty-state affordance renders below 1024 px.

## 8. Step-by-step implementation

| # | Task | Files |
|---|---|---|
| 1 | Capture sandbox fixture for category 257933 via `pnpm --filter @openlinker/api allegro:capture-cat-params <connId> 257933 <path>`. The single capture covers both mechanisms (visibility + entry-filter) — no second fixture required. | `__fixtures__/category-parameters-257933.json` |
| 2 | **Shared CachePort + RedisCacheAdapter + CacheModule + spec** | 5 new files in `libs/shared/src/cache/` + barrel update |
| 3 | CORE — `CategoryParameter` types + capability + guard + `CategoryNotFoundException` + spec | 4 new files in `libs/core/src/listings/domain/` + barrel update |
| 4 | Allegro — expand `AllegroCategoryParametersResponse`; add raw→neutral mapper (parameter-visibility + dictionary-entry-filtering separation) + mapper spec using **both** fixtures | edit `allegro-api.types.ts`; new `allegro-category-parameter.mapper.ts` + spec |
| 5 | Allegro — implement `fetchCategoryParameters` with `CachePort` + env-overridable TTL, declare `CategoryParametersReader` in `implements`, refactor `fetchOfferIdentifiers`, wire `CacheModule` in `AllegroIntegrationModule`, extend adapter spec | edits in `libs/integrations/allegro/src/` |
| 6 | API — controller endpoint + DTO (mirrors per-entry filter) + spec | `apps/api/src/listings/http/` |
| 7 | FE — API client method, types (incl. per-entry `dependsOnParameterValueIds`), query keys, query hook | `apps/web/src/features/listings/api/` + `hooks/` |
| 8 | FE — virtualized `combobox.tsx` primitive in `shared/ui/` (Radix-popover-wrapped, density spec, ARIA, filter-first, customValues affordance) + spec | new `combobox.tsx` + `combobox.test.tsx` |
| 9 | FE — `category-parameters-step.tsx` + `auto-prefill-parameters.ts` + `serialize-allegro-parameters.ts` + `build-parameters-zod-schema.ts` + tests | new in `features/listings/components/` |
| 10 | FE — wizard integration: insert Step 2, dynamic Zod, submit serializer with `{ submitted }` snapshot, error-mapping deep-link, retry pre-fill, sticky footer, sub-1024 desktop-only affordance | edits in `CreateOfferWizard.tsx`, `create-offer-fields.schema.ts`, `create-offer-request-to-form-values.ts` + tests |
| 11 | File-header sweep: every new `.ts`/`.tsx` carries the JSDoc header documented in `engineering-standards.md` §"File Headers" | — |
| 12 | Quality gate: `pnpm lint && pnpm type-check && pnpm test` | — |
| 13 | Manual sandbox verification: pick a category with required params (e.g. 257933), step through wizard, submit, verify offer creates without `MissingRequiredParameters` | — |

## 9. Locked-in design decisions (post-grilling + post-review)

1. **Type taxonomy** — 4 base types (`dictionary | string | integer | float`) + a `restrictions` struct. Cross-marketplace portable.
2. **Two distinct dependency mechanisms** — parameter-level visibility (`parameter.dependsOn`) and dictionary-entry filtering (`dictionary[i].dependsOnValueIds` — Allegro's exact field name) modeled separately throughout. Single fixture (cat 257933) covers both, verified by inspection.
3. **Brand typeahead** — Full dictionary inline; FE renders via virtualized `Combobox` (filter-first when ≥ 50 entries); backend cache via the new `CachePort`, **24h default TTL** (`OL_ALLEGRO_CAT_PARAMS_TTL_SEC`), **global key** (`allegro:cat-params:{categoryId}`).
4. **Cache abstraction** — Introduce `CachePort` in `libs/shared/src/cache/` (no fallback). Wraps the existing `'REDIS_CLIENT'` provider behind a Symbol token.
5. **Cascading dependencies** — Static render + visibility filter (`dependsOn`) + entry-level filter (`dependsOnParameterValueIds`). Hidden parameters' form values are cleared on hide. Skip Allegro's richer `requiredIf` / `displayedIf` for this PR.
6. **Wizard layout** — New dedicated Step 2 between Offer details and Policies. Wizard becomes 5 steps. Parameter values cleared when `categoryId` changes. Sticky Back/Continue footer on Step 2.
7. **Form state shape** — Flat dict `parameters: Record<paramId, FormParameterValue>`. Submit-time serializer returns `{ submitted }` for use as the error-mapping snapshot.
8. **Auto-prefill** — Conservative for #410: EAN (matched by name patterns) + Stan defaulted to "Nowy". Brand / producer-code deferred to **#412**.
9. **Retry pre-fill** — Stay on Review on failure; map Allegro `validation.errors[]` positional paths back to parameter IDs via the *submitted-snapshot* (not the metadata array); surface inline via `form.setError`; "Edit parameters" button deep-links to Step 2.
10. **API + CORE shape** — Capability `CategoryParametersReader` returns full parameter set. Controller talks directly to `IIntegrationsService` (no service facade). Endpoint: `GET /listings/connections/:connectionId/categories/:categoryId/parameters` (verified `@Controller('listings')` prefix).
11. **Service facade** — Not introduced. The §3 architecture diagram and the §6.1 controller code agree.
12. **FE filenames** — kebab-case for new files (`combobox.tsx`, `category-parameters-step.tsx`, etc.). Existing PascalCase siblings keep their names.
13. **Empty Step 2 UX** — `<EmptyState>` + pre-focused Continue button, no auto-advance.
14. **Custom values affordance** — Visible UI cue when `customValuesEnabled` is true; custom-value chip differentiated by dotted left border (shape, not color).
15. **Responsive** — Desktop-only for #410 (≥ 1024 px). Below threshold: documented "Open on a desktop screen to edit" affordance for the entire wizard.

## 10. Validation against engineering standards

- ✅ **Hexagonal:** capability port lives in CORE `domain/ports/capabilities/`; adapter implements; API resolves via `IIntegrationsService` + capability narrowing; FE talks only to the API.
- ✅ **Capability sub-interface pattern:** matches existing `OfferLister` / `OfferCreator` shape — `*.capability.ts` with co-located `is{Capability}` guard.
- ✅ **Types in `*.types.ts`:** all parameter-shape types in dedicated files.
- ✅ **`as const` + union pattern:** used for `CategoryParameterType`, `allowedNumberOfValues`.
- ✅ **No `any`:** discriminated form-value handling, typed wire-shape mapping.
- ✅ **No DB / migration impact.**
- ✅ **Symbol DI tokens:** `CACHE_PORT_TOKEN` is a Symbol (no string DI tokens introduced for our code; underlying `'REDIS_CLIENT'` is existing infrastructure).
- ✅ **Domain exception placement:** `CategoryNotFoundException` in `libs/core/src/listings/domain/exceptions/`.
- ✅ **File headers:** all new `.ts`/`.tsx` files include the JSDoc header documented in `engineering-standards.md` §"File Headers" (sweep step in §8).
- ✅ **Cache port abstraction:** `libs/shared/src/cache/` follows the same shape as existing port + adapter pairs in CORE.
- ✅ **FE rules:**
  - Component primitives reused (`<Input>`, `<Select>`, `FormField`, `EmptyState`, `LoadingState`, `Alert`, `Toast`, `BackLink`); new `<Combobox>` lives in `shared/ui/` (not `features/`) per dependency-direction rule.
  - Combobox wraps `shared/ui/popover.tsx` (Radix) per "headless wrapped by primitive" rule.
  - Query hook follows `use-X-query.ts` pattern; query key in `*.query-keys.ts`.
  - Form state via React Hook Form + Zod; loading/error/empty/data states all handled.
  - No raw API calls from components.
  - Filenames kebab-case for new files.
  - Color is never the sole signal (custom-value chips use shape).
  - Density: 32 px form controls, 32/40 px option rows, 28 px chips.
  - Typography: pinned to canonical scale per `frontend-ui-style-guide.md`.

## 11. Non-goals (explicit)

- **Allegro `product`-typed parameters / catalog binding** — out of scope; if a category surfaces this we render a read-only banner.
- **Allegro `requiredIf` / `displayedIf` rich predicates** — not modeled in CORE; rely on Allegro's response on submit if a category needs them.
- **Brand and producer-code auto-prefill** — deferred to **#412**.
- **Per-shop / per-connection prefill mapping config** — out of scope.
- **Cross-category parameter-value reuse** — schema fetched fresh per category; no client-side merging.
- **Localization toggle for parameter names** — render verbatim what Allegro returns (operator-language, typically Polish).
- **Mobile / tablet interactive editing** — explicitly out of scope. The wizard is desktop-only (≥ 1024 px) and shows the documented "Open on a desktop screen to edit" affordance below the threshold. Mobile-interactive wizards are a separate epic.
- **Multi-segment category breadcrumb endpoint** — not added in this PR. Step 2 header shows `Category {id} · {leafName}` only. Breadcrumb endpoint is a follow-up if operators ask.
- **`ListingsCategoryParametersService` facade** — not introduced. Controller routes through `IIntegrationsService` directly. Add only if cross-controller reuse emerges.
