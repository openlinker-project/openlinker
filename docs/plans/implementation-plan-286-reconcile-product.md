# Implementation Plan: #286 — Reconcile the two `Product` type definitions

## 1. Task Understanding

**Goal**: Collapse the two `Product` exports from `@openlinker/core/products` — the port interface (in `domain/ports/product-master.port.ts`) and the domain entity class (in `domain/entities/product.entity.ts`) — into a single interface, mirroring the pattern #281 established for `ProductVariant`. Repositories build plain objects; adapters produce the same shape as what the repo returns; callers import one type.

**Layer**: CORE (products domain) + the API controllers, PrestaShop mapper/adapter, and tests that currently straddle both shapes.

**Non-goals** (explicit):
- Extending the ORM schema to persist `currency`, `weight`, or `categories`. Today these are master-derived, port-only fields; that remains true. They stay on the unified interface as optional fields with a doc-comment noting they are not persisted.
- Touching `Category` further — #281 already dropped its `[key: string]: unknown` escape hatch.
- Fixing the `products.service.ts` bug where rebuilding a variant to pin `productId` drops `ean`/`gtin` — already fixed in #281.

## 2. Research findings

**Current state:**

- **Port interface `Product`** (`product-master.port.ts:23-35`): `sku`/`price` required; `description?`/`images?`/`currency?`/`weight?`/`categories?`/`createdAt?`/`updatedAt?` all `T | undefined`.
- **Entity class `Product`** (`product.entity.ts`): `sku: string | null`, `price: number | null`, `description: string | null`, `images: string[] | null`, **required** `createdAt` / `updatedAt`. Has a **`coverImageUrl` getter** (added in #272) — the Products domain's canonical "first image by convention" rule. No `currency` / `weight` / `categories`.
- **Barrel** (`libs/core/src/products/index.ts`):
  - `Product` → port interface (line 25)
  - `ProductEntity` → alias for the class entity (line 32)
- **DB schema** (`product.orm-entity.ts`): `sku`/`price`/`description`/`images` nullable; `createdAt`/`updatedAt` required.

**Usage of `ProductEntity` (alias) — 4 production/test files:**
1. `apps/api/src/products/http/products.controller.ts` — imports `ProductEntity`, calls `product.createdAt.toISOString()` (assumes class-level guaranteed timestamps), uses the alias only in `toProductDto(product: ProductEntity)`.
2. `apps/api/src/products/http/products.controller.spec.ts` — `new ProductEntity(...)` factory.
3. `apps/api/src/inventory/http/inventory.controller.ts` — `import { ProductEntity as Product }`, uses **`product.coverImageUrl`** (class getter).
4. `apps/api/src/inventory/http/inventory.controller.spec.ts` — `new Product(...)` factory.

**Usage of `Product` class constructor (`new Product(...)`) — 3 files:**
- `libs/core/src/products/infrastructure/persistence/repositories/product.repository.ts` (`toDomain`)
- `libs/core/src/products/application/services/master-product-sync.service.ts` (`toDomainProduct`)
- `libs/core/src/products/application/services/products.service.spec.ts` (test factory)

**Usage of `Product` port interface — read-only consumers:**
- `libs/core/src/listings/application/services/offer-builder.service.ts` (line 83): fetches via `ProductMasterPort.getProduct`, reads `product.name`, `product.description`, `product.images`, `product.price`, `product.currency`. **These fields must remain available on the unified interface.** `overrides.description` / `overrides.imageUrls` are `string | undefined` / `string[] | undefined` downstream — after widening `product.description` from `string | undefined` to `string | null`, the `??` expression's type becomes `string | null | undefined`, which must be coerced with `?? undefined` at the assignment site.
- PrestaShop mapper + adapter return `Omit<Product, 'id'>` objects today via `description: description ?? undefined` and `images: images ?? undefined` — will be shifted to emit `null` directly.

**Key behavioural difference vs. #281:**

`Product` has a getter (`coverImageUrl`) that `ProductVariant` does not. An interface cannot carry methods. This is the one design decision that differs from the #281 pattern: **the `coverImageUrl` rule must survive the class → interface collapse without the call site having to know "first-element-or-null"**. Decision: export `coverImageUrl` as a standalone function alongside the interface and route all call sites through it. See §3.

**Structural tension (unchanged from #281):** adapters produce pre-persistence products without timestamps; repositories produce post-persistence products with timestamps. Forcing required timestamps means adapters fabricate `new Date()` placeholders that TypeORM discards. Solution: keep timestamps **optional** on the interface, matching the #281 decision.

## 3. Solution

**Canonical shape** — single interface in `domain/entities/product.entity.ts`; cover-image rule extracted to a sibling utility in `domain/utils/`:

```ts
// libs/core/src/products/domain/entities/product.entity.ts

/**
 * Product Domain Entity
 *
 * Represents a canonical product in the OpenLinker system. Products are stored
 * with internal IDs only; external identifiers live in IdentifierMapping.
 * This entity is integration-agnostic and represents the single source of truth
 * for product data.
 *
 * Shape note: this is an `interface` (not a `class`) deliberately. Products cross
 * adapter → repository → application → UI boundaries and are constructed in
 * several places (adapter mappers, repo `toDomain`, test factories). Structural
 * typing avoids `instanceof` false negatives across import paths and lets
 * repositories build plain objects without a constructor call. Adapters and
 * drafts may omit `createdAt`/`updatedAt` — the repo fills them on load.
 *
 * @module libs/core/src/products/domain/entities
 */
export interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  description: string | null;
  images: string[] | null;
  /** Populated by the repository on load; adapters/drafts may omit. */
  createdAt?: Date;
  /** Populated by the repository on load; adapters/drafts may omit. */
  updatedAt?: Date;
  /** Master-derived, not persisted on the products table. */
  currency?: string;
  /** Master-derived, not persisted on the products table. */
  weight?: number;
  /** Master-derived (external category IDs), not persisted on the products table. */
  categories?: string[];
}
```

```ts
// libs/core/src/products/domain/utils/product-cover-image.ts

/**
 * Product Cover Image Helper
 *
 * The cover-image rule for the Products bounded context: "the first element
 * of `images`, or null if empty/absent." Extracted as a standalone helper
 * because `Product` is an interface and interfaces cannot carry methods.
 * Consumers (inventory read endpoints, UI thumbnails) should call this rather
 * than replicating `images?.[0] ?? null` themselves.
 *
 * @module libs/core/src/products/domain/utils
 */
import type { Product } from '../entities/product.entity';

export const coverImageUrl = (product: Pick<Product, 'images'>): string | null => {
  return product.images?.[0] ?? null;
};
```

Decisions:

| Question | Decision | Rationale |
|---|---|---|
| Keep class or use interface? | **Interface** | Mirrors #281. Repositories build plain objects. |
| `createdAt`/`updatedAt` required or optional? | **Optional** | Mirrors #281. Adapters omit; repo + TypeORM populate on save/load. |
| `sku` / `price` / `description` / `images` nullability | **`T \| null`** | Matches DB columns. |
| What about `currency` / `weight` / `categories`? | **Keep as optional, port-derived fields** | `offer-builder.service.ts` reads `product.currency`. Dropping them would be a scope-creep schema change. Labelled as "master-derived, not persisted." |
| How to preserve `coverImageUrl`? | **Standalone helper in `domain/utils/product-cover-image.ts`** | Mirrors the existing `domain/utils/barcode-normalization.ts` pattern — entity files stay pure-shape; domain rules live in `utils/`. The rule still belongs to the Products domain (#272's choice); consumers import the helper. |
| Keep `ProductEntity` alias in barrel? | **No** | Migrate four call sites to `Product`; mirrors #281 dropping `ProductVariantEntity`. |

## 4. Step-by-step

### Step 1 — Rewrite `domain/entities/product.entity.ts`

Replace the class with the interface (exact shape in §3). Keep the file header, then append the shape-note paragraph verbatim:

```
 * Shape note: this is an `interface` (not a `class`) deliberately. Products cross
 * adapter → repository → application → UI boundaries and are constructed in
 * several places (adapter mappers, repo `toDomain`, test factories). Structural
 * typing avoids `instanceof` false negatives across import paths and lets
 * repositories build plain objects without a constructor call. Adapters and
 * drafts may omit `createdAt`/`updatedAt` — the repo fills them on load.
```

(copied from the `product-variant.entity.ts` header landed in #281 for consistency).

### Step 2 — Create `domain/utils/product-cover-image.ts`

New file with the exact shape in §3: imports `Product` as a type-only import, exports a single arrow-function `coverImageUrl`. Mirrors `domain/utils/barcode-normalization.ts`.

### Step 3 — Replace the entity spec with a helper spec

**Move**: `libs/core/src/products/domain/entities/product.entity.spec.ts` → `libs/core/src/products/domain/utils/product-cover-image.spec.ts`

The entity-level tests no longer exist (the entity is now a pure interface with no behaviour). The `coverImageUrl` `describe` block is the only behavioural surface; it belongs next to the helper. Rewrite `makeProduct(images)` to return an object literal. Import `{ coverImageUrl } from './product-cover-image'`.

### Step 4 — Port interface deduplication

**File**: `libs/core/src/products/domain/ports/product-master.port.ts`

- Remove the local `Product` interface (lines 19-35).
- Import and re-export from entity: mirrors the `ProductVariant` treatment already in this file.
  ```ts
  import type { Product } from '../entities/product.entity';
  export type { Product } from '../entities/product.entity';
  ```

No other changes in this file — `Category`, `ProductMasterPort`, method signatures all stay.

### Step 5 — Barrel cleanup

**File**: `libs/core/src/products/index.ts`

- Replace `export { ... Product ... } from './domain/ports/product-master.port';` with `export { Product } from './domain/entities/product.entity';` (keep the port-file exports for `ProductMasterPort` and `Category`).
- Drop `export { Product as ProductEntity } from './domain/entities/product.entity';`
- Add `export { coverImageUrl } from './domain/utils/product-cover-image';`

### Step 6 — Repository: object literal + optional timestamp guard

**File**: `libs/core/src/products/infrastructure/persistence/repositories/product.repository.ts`

- `toDomain`: replace `new Product(...)` with an object literal. Shape:
  ```ts
  return {
    id: entity.id,
    name: entity.name,
    sku: entity.sku,
    price: entity.price !== null ? Number(entity.price) : null,
    description: entity.description,
    images: entity.images,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
  ```
  (Preserve the `Number(entity.price)` decimal-string coercion — TypeORM surfaces `decimal` columns as strings; the existing `entity.price ? Number(entity.price) : null` silently maps `"0"` to `null`. Fix to explicit `!== null` to avoid the same footgun #281 noted for falsy-0 elsewhere. **Behavioural note:** previously `price=0` round-tripped as `null` on read; after this fix it round-trips as `0`. Call this out in the PR description so reviewers don't miss it.)
- `toOrmEntity`: guard optional timestamps:
  ```ts
  if (product.createdAt) entity.createdAt = product.createdAt;
  if (product.updatedAt) entity.updatedAt = product.updatedAt;
  ```

### Step 7 — `MasterProductSyncService`: simplify `toDomainProduct`

**File**: `libs/core/src/products/application/services/master-product-sync.service.ts`

- Drop the aliased `ProductPortInterface` and `ProductDomainEntity` imports. Import `Product` once from the entity path.
- `toDomainProduct` collapses to a thin normalization helper (mirrors #281's `toDomainVariant`):
  ```ts
  private toDomainProduct(product: Product): Product {
    return {
      ...product,
      sku: product.sku ?? null,
      price: product.price ?? null,
      description: product.description ?? null,
      images: product.images ?? null,
    };
  }
  ```
  No `new Date()` placeholders — adapters may omit timestamps and `UpdateDateColumn`/`CreateDateColumn` fills them on save. Currency/weight/categories pass through untouched. These three fields reach `productRepository.upsert` but `toOrmEntity` doesn't assign them, so they're silent no-ops on persistence.

### Step 8 — Products service spec: drop the constructor call

**File**: `libs/core/src/products/application/services/products.service.spec.ts`

- Replace the `makeProduct` factory's `new Product(...)` with an object literal. No other changes — the spec treats `Product` as an opaque value.

### Step 9 — Products controller: migrate off `ProductEntity`

**File**: `apps/api/src/products/http/products.controller.ts`

- Import `Product` instead of `ProductEntity`.
- `toProductDto(product: Product)` — update signature.
- Optional-timestamp handling: mirror the #281 variant pattern (non-null assertion + comment). Products surfaced by these endpoints are always repo-sourced, so timestamps are guaranteed. Replace:
  ```ts
  createdAt: product.createdAt.toISOString(),
  updatedAt: product.updatedAt.toISOString(),
  ```
  with:
  ```ts
  // Timestamps are optional on the Product interface because adapters produce
  // pre-persistence products. In this controller the product is always
  // repository-sourced (see ProductRepository#toDomain), so they are
  // guaranteed present — non-null assertion crashes loudly if the invariant
  // ever breaks, which is preferable to silently emitting a 1970 epoch date.
  createdAt: product.createdAt!.toISOString(),
  updatedAt: product.updatedAt!.toISOString(),
  ```

### Step 10 — Products controller spec: drop the `ProductEntity` constructor

**File**: `apps/api/src/products/http/products.controller.spec.ts`

- Import `Product` instead of `ProductEntity`.
- `makeProduct` returns an object literal matching the interface.
- Before wrapping up, grep the spec file for any `instanceof Product`/`instanceof ProductEntity` assertions — the prior class-based shape allowed them. None expected (codebase-wide grep confirmed zero), but verify at the file level.

### Step 11 — Inventory controller: swap getter for function

**File**: `apps/api/src/inventory/http/inventory.controller.ts`

- Replace the `import { ProductEntity as Product, ... }` with `import { Product, coverImageUrl, ... }`.
- Replace `product?.coverImageUrl ?? null` with `product ? coverImageUrl(product) : null`.
- Update the existing comment to point at the function (no longer a getter).

### Step 12 — Inventory controller spec: drop `new Product(...)`

**File**: `apps/api/src/inventory/http/inventory.controller.spec.ts`

- Replace `import { ProductEntity as Product }` with `import { Product }`.
- Replace `new Product(...)` fixtures with object literals.
- Grep for any `instanceof Product` assertions (none expected at codebase level; verify at file level before finishing).

### Step 13 — PrestaShop product mapper: emit `null` directly

**File**: `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.ts`

- `mapProduct` return: shift the three fields that currently do `?? undefined` to emit `null`:
  - `description: description ?? undefined` → `description` (already `string | null` from `getLocalizedField`)
  - `images: images ?? undefined` → `images` (already `string[] | null` from `extractImages`)
  - Verify the `sku` fallback: current is `this.getStringField(prestashopProduct.reference) || ''`. Keep the `|| ''` fallback — the interface accepts `string | null` but adapters have historically emitted `''`; changing that is out of scope.
- Drop `currency`, `weight`, `categories` *only if the mapper output no longer type-checks against `Omit<Product, 'id'>`* — but it will: all three remain optional on the unified interface. Leave them as-is.

### Step 14 — PrestaShop mapper spec: update assertions for null vs undefined

**File**: `libs/integrations/prestashop/src/infrastructure/mappers/__tests__/prestashop-product.mapper.spec.ts`

- Tests asserting `expect(result.description).toBeUndefined()` (line 206) and `expect(result.images).toBeUndefined()` (4 occurrences) → switch to `toBeNull()`.
- Tests asserting `expect(result.images).toEqual([...])` — unchanged.

### Step 15 — PrestaShop adapter: no changes expected

**File**: `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-product-master.adapter.ts`

The adapter already spreads the mapper output and pins `id`. Import already uses `Product` (not `ProductEntity`) via the barrel, which now resolves to the interface. No code change expected; re-run spec.

### Step 16 — Offer-builder: coerce `null → undefined` at the overrides boundary

**File**: `libs/core/src/listings/application/services/offer-builder.service.ts` (line ~101-103)

Before:
```ts
const description = input.overrides?.description ?? product.description;
const imageUrls = input.overrides?.imageUrls ?? product.images;
```
After (product fields are now `string | null` / `string[] | null`; overrides expect `string | undefined` / `string[] | undefined`):
```ts
const description = input.overrides?.description ?? product.description ?? undefined;
const imageUrls = input.overrides?.imageUrls ?? product.images ?? undefined;
```

The `resolvePrice` helper already uses a narrow `{ price?: number; currency?: string }` signature and does not care about the wider `Product` changes.

### Step 17 — Worker test helper: mock product shape

**File**: `apps/worker/test/integration/helpers/mock-adapters.helper.ts` (line 22-31)

The mock already emits an object literal matching the new shape (`id`, `name`, `sku`, `price`, `description`, `images`, `createdAt`, `updatedAt`). It omits `currency` / `weight` / `categories` — now type-compatible because they are optional. **No change required**; verify via `pnpm type-check`.

Also belt-and-braces: grep `apps/worker/test/integration/**/*.int-spec.ts` for `new Product(` and `new ProductEntity(`. Codebase-wide grep shows none today, but this is the class of regression that only surfaces at `pnpm test:integration` time, so verify at the file level before calling the quality gate complete.

### Step 18 — Quality gate

```
pnpm lint && pnpm type-check && pnpm test
```

Then, because this change does not touch ORM schema:
```
pnpm --filter @openlinker/api migration:show   # expect no pending migrations
```

Integration test suite (`pnpm test:integration`) must also pass — there are e2e tests that exercise `product-sync` through the adapter + repo path that would catch any shape mismatch.

## 5. Validation

- **Architecture**: Domain entity + rule-carrying free function live in `domain/entities/` with zero framework dependencies. ✅
- **Naming**: `product.entity.ts` (unchanged); exported symbols are `Product` (interface) + `coverImageUrl` (function). ✅
- **Union/interface rules**: Interface in PascalCase, entity-file placement matches #281 pattern. ✅
- **Barrel hygiene**: single export per name, no `As Alias` shim after migration. `ProductEntity` symbol is gone. ✅
- **Tests**: all existing tests pass (reshape-only). No new behavioural surface added.

## 6. Risk

- **Type-error blast radius**: any consumer that relies on `Product` being a class (e.g., `product instanceof Product`) will break. Grep confirmed zero `instanceof Product` in the codebase. ✅
- **Hidden cover-image call sites**: migrating `product.coverImageUrl` → `coverImageUrl(product)` is a mechanical rename, but future call sites may slip back to `product.images?.[0] ?? null`. Mitigation: the doc-comment on `coverImageUrl` states the rule is centralised here; reviewers should reject inlined copies.
- **offer-builder `?? undefined` coercion**: a subtle shift from `string | undefined` to `string | null` → `string | undefined`. Captures: when `product.description` is missing the final value is `undefined` (was `undefined` before); when the adapter emits `null` (per the new mapper) the final value is `undefined` too. Behaviour is identical. ✅
- **Silent no-op spread of `currency`/`weight`/`categories` in `toDomainProduct`**: the simplified `toDomainProduct` spreads these optional fields into the value handed to `productRepository.upsert`. `toOrmEntity` does not assign them, so they are silently dropped on write. This is identical to today's behaviour (the class constructor also discarded them) and the ORM has no columns for them — but worth calling out so reviewers don't assume the PR is accidentally wiring new persistence. No action required. ✅
- **Behavioural change in `ProductRepository.toDomain`**: fixing the falsy-0 bug means `price=0` now round-trips as `0` instead of `null`. No known caller relies on the old behaviour, but it's a genuine observable change and must be called out in the PR description.

## 7. Out of scope

- Schema persistence of `currency` / `weight` / `categories` — tracked separately if ever required.
- Making `coverImageUrl` a derived prop via `Object.defineProperty` on every literal — unnecessary complexity; the function-call form is fine.
- Any change to `Category` (already handled in #281).
- **Widening `CreateOfferOverrides.description`/`imageUrls` to accept `null`**: cleaner long-term than the `?? undefined` coercion in `offer-builder.service.ts`, but scope-creeps into `libs/core/src/integrations`. File as a follow-up issue after this PR lands.

## 8. Summary of files touched

| File | Change |
|---|---|
| `libs/core/src/products/domain/entities/product.entity.ts` | Class → interface (shape note appended to header) |
| `libs/core/src/products/domain/utils/product-cover-image.ts` | **New** — standalone `coverImageUrl` helper (mirrors `barcode-normalization.ts`) |
| `libs/core/src/products/domain/utils/product-cover-image.spec.ts` | **New** (moved from `domain/entities/product.entity.spec.ts`) — tests the helper against object literals |
| `libs/core/src/products/domain/entities/product.entity.spec.ts` | **Deleted** — entity is now a pure interface; behaviour moved to helper spec |
| `libs/core/src/products/domain/ports/product-master.port.ts` | Remove inline `Product`; re-export from entity file |
| `libs/core/src/products/index.ts` | Drop `ProductEntity` alias; export `coverImageUrl` from utils; `Product` source moves to entity file |
| `libs/core/src/products/infrastructure/persistence/repositories/product.repository.ts` | `toDomain` → object literal (fix falsy-0 bug); guard optional timestamps in `toOrmEntity` |
| `libs/core/src/products/application/services/master-product-sync.service.ts` | Drop aliased imports; simplify `toDomainProduct` to spread+normalize |
| `libs/core/src/products/application/services/products.service.spec.ts` | Factory → object literal |
| `apps/api/src/products/http/products.controller.ts` | `ProductEntity` → `Product`; non-null assertion on timestamps |
| `apps/api/src/products/http/products.controller.spec.ts` | `new ProductEntity(...)` → object literal |
| `apps/api/src/inventory/http/inventory.controller.ts` | `ProductEntity` → `Product`; `product.coverImageUrl` → `coverImageUrl(product)` (imported from utils) |
| `apps/api/src/inventory/http/inventory.controller.spec.ts` | `new Product(...)` → object literal |
| `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.ts` | `?? undefined` → pass through `null` for `description` / `images` |
| `libs/integrations/prestashop/src/infrastructure/mappers/__tests__/prestashop-product.mapper.spec.ts` | `toBeUndefined()` → `toBeNull()` for `description` / `images` expectations |
| `libs/core/src/listings/application/services/offer-builder.service.ts` | Add `?? undefined` coercion for `description` / `imageUrls` at overrides boundary |
