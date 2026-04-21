# Implementation Plan: #281 — Reconcile the two `ProductVariant` type definitions

## 1. Task Understanding

**Goal**: Collapse the two `ProductVariant` exports from `@openlinker/core/products` — the port interface (in `domain/ports/product-master.port.ts`) and the domain entity class (in `domain/entities/product-variant.entity.ts`) — into a single interface exported from one place. Repositories build plain objects, callers import one type, adapters produce the same shape as what the repo returns.

**Layer**: CORE (products domain) + integrations/tests that currently straddle both shapes.

**Non-goals**:
- Same duality for `Product` and `Category` — the issue explicitly says to file a separate issue if found. See §7 below: confirmed both have it, will file as a follow-up.
- Fixing the `products.service.ts:62` bug that drops `ean`/`gtin` when rebuilding variants to re-stamp `productId` — incidentally resolved by switching from `new ProductVariant(...)` to object-spread, but not a scope goal.

## 2. Research findings

**Current state:**
- Port interface `ProductVariant` (`product-master.port.ts:36-46`): optional `ean`/`gtin` (`string | undefined`), no `createdAt`/`updatedAt`, has `[key: string]: unknown` escape hatch.
- Entity class `ProductVariant` (`product-variant.entity.ts:10-21`): required `createdAt`/`updatedAt`, nullable `ean`/`gtin` (`string | null`), nullable `sku` and `attributes`.
- Barrel exports: `ProductVariant` (port interface) + alias `ProductVariantEntity` (class).
- Repository `toDomain` returns the **class**, typed as the **interface** (via the port).
- Consumers of `new ProductVariant(...)`: 3 files (`product-variant.repository.ts`, `products.service.ts`, `products.service.spec.ts`).
- Consumers of `new ProductVariantEntity(...)`: 3 test files (API controller spec, offer-mapping-sync spec, order-item-ref-resolver spec).
- **No `as unknown as ProductVariant` casts** in the current codebase — the issue's example was forward-looking. Zero casts to remove.
- PrestaShop adapter returns plain object literals without `createdAt`/`updatedAt` or `attributes` (`prestashop-product-master.adapter.ts:198-206` and `237-259`). These compile today only because the port interface has those fields optional.

**The structural tension:**
Adapters produce variants *before* persistence → no timestamps yet. Repositories produce variants *after* persistence → timestamps always present. Forcing required timestamps means adapters fabricate `new Date()`; leaving them optional means the type allows unsafe states at runtime.

## 3. Solution

**Canonical shape** — single interface, keep it in `domain/entities/product-variant.entity.ts` (the standard location for domain entities). Port re-imports from there, barrel exports it:

```ts
// domain/entities/product-variant.entity.ts
export interface ProductVariant {
  id: string;
  productId: string;
  sku: string | null;
  attributes: Record<string, string> | null;
  ean: string | null;
  gtin: string | null;
  createdAt?: Date;  // populated by repo on load; adapters/drafts omit
  updatedAt?: Date;  // same
  price?: number;    // master-derived, not persisted
  weight?: number;   // same
}
```

Decisions, referenced against the issue and the tech-review of this plan:
- **Optional `createdAt`/`updatedAt`** — **push back on the issue's "required" recommendation**. The real data flow is bidirectional: adapters produce pre-persistence variants (no timestamps exist yet); repositories produce post-persistence variants (timestamps always present). Forcing "required" means adapters fabricate `new Date()` placeholders that TypeORM discards on save — semantic noise that propagates into logs and test assertions. Optional matches reality; the narrow cost is that the type allows a theoretically invalid state ("persisted variant without timestamps") that never actually occurs. Documented in §8.
- **`ean` / `gtin` as `string | null`** — per the issue, aligns with DB nullability. PrestaShop adapter currently emits `string | undefined`; convert with `?? null`. Grep confirmed **zero strict-undefined checks** on these fields — all consumers use truthy checks, so the shift is safe.
- **`sku` as `string | null`** — matches the existing class + DB; PrestaShop adapter emits a fallback string so it's non-null in practice.
- **`attributes` as `Record<string, string> | null`** — matches the existing class + DB. Adapter synthetic-variant case currently omits it; will add `attributes: null`.
- **Optional `price` / `weight`** — per the issue, derived/transient fields not persisted on the variants table.
- **No index signature `[key: string]: unknown`** — per the issue, hides bugs.
- **Interface, not class.** Repositories build plain objects. Interface chosen explicitly per the issue — file header will carry a short note ("shape crosses adapter/repo/ui boundaries; structural typing avoids `instanceof` false negatives across import paths") so future readers don't "correct" it back to a class.

**Port/barrel:**
- `product-master.port.ts`: remove the inline `ProductVariant` interface. Import from `../entities/product-variant.entity`.
- `products/index.ts`: export `ProductVariant` from the entity file. Remove the `ProductVariantEntity` alias (backwards-compat shim with no consumers after step 4).

## 4. Step-by-step

### Step 1 — Rewrite `domain/entities/product-variant.entity.ts`

Replace the class with the canonical interface (shape above). Keep the JSDoc module comment. File header stays.

### Step 2 — Port interface deduplication

**File**: `libs/core/src/products/domain/ports/product-master.port.ts`

- Remove the local `ProductVariant` interface (lines 34-46).
- Import from entity: `import type { ProductVariant } from '../entities/product-variant.entity';`
- **Re-export is required**: `libs/core/src/products/application/services/master-product-sync.service.ts:21` deep-imports `ProductVariant` from this port path. Add `export type { ProductVariant } from '../entities/product-variant.entity';` to preserve that import (and fix the service in Step 5 below to drop the now-redundant alias).
- **Also drop `[key: string]: unknown` from `Category`** (line ~55) — same one-line cleanup while we're already in this file. Consumers use known keys only (would have surfaced as a compile error with strict mode otherwise).

### Step 3 — Barrel cleanup

**File**: `libs/core/src/products/index.ts`

- Replace `export { ProductVariant } from './domain/ports/product-master.port';` with `export { ProductVariant } from './domain/entities/product-variant.entity';`
- Remove `export { ProductVariant as ProductVariantEntity } from './domain/entities/product-variant.entity';` — alias no longer needed once call sites are migrated.

### Step 4 — Repository: switch to object literal

**File**: `libs/core/src/products/infrastructure/persistence/repositories/product-variant.repository.ts`

- `toDomain`: replace `new ProductVariant(entity.id, ...)` with an object literal matching the interface.
- Imports: drop the class import; the repo already imports the type via the port (which re-exports).

### Step 5 — Services: drop constructor calls and type aliases

**File**: `libs/core/src/products/application/services/products.service.ts`

- `upsertVariants` (line ~62): replace the `new ProductVariant(...)` rebuild with object spread `{ ...variant, productId }`. This incidentally fixes the silent `ean`/`gtin` drop bug (not a scope goal, but a free win).

**File**: `libs/core/src/products/application/services/master-product-sync.service.ts`

- Collapse the two aliased imports (`ProductVariantPortInterface` + `ProductVariantDomainEntity`) into one: `import { ProductVariant } from '../../domain/entities/product-variant.entity';` (or via the barrel).
- The private `toDomainVariant` mapper (line ~104-114) becomes a pass-through: port shape == entity shape. Delete the mapper and pass variants through unchanged. (Keep `toDomainProduct` untouched — Product duality is out of scope for this PR.)

### Step 6 — Service spec: drop the constructor call

**File**: `libs/core/src/products/application/services/products.service.spec.ts`

- Replace test `new ProductVariant(...)` factory calls with plain object literals.

### Step 7 — Migrate `ProductVariantEntity` test imports

Three test files currently use `ProductVariantEntity`:
- `apps/api/src/products/http/products.controller.spec.ts`
- `libs/core/src/listings/application/services/__tests__/offer-mapping-sync.service.spec.ts`
- `libs/core/src/orders/application/services/__tests__/order-item-ref-resolver.service.spec.ts`

In each: replace `new ProductVariantEntity(...)` with an object literal matching the new interface. Import `ProductVariant` from `@openlinker/core/products` (same barrel, different name).

### Step 8 — PrestaShop adapter: add `attributes: null`, coerce ean/gtin to null

With optional timestamps, adapters don't need to stamp `new Date()` placeholders. Changes are minimal:

**Files**:
- `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-product-master.adapter.ts`
  - Synthetic-variant literal (line ~198): add `attributes: null`; coerce `ean`/`gtin` to `?? null` instead of `?? undefined`.
  - Normal-variant branch at line ~255: ensure the spread produces `attributes: null` and `ean|gtin: string | null`. The mapper returns `Omit<ProductVariant, 'id'>` so the mapper output drives the shape.
- `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.ts`
  - `mapVariant` return shape: add `attributes: null`, `ean` and `gtin` as `string | null`.

### Step 9 — Worker test helper

**File**: `apps/worker/test/integration/helpers/mock-adapters.helper.ts`

If it constructs variants, update the literal shape. (Noted in the grep; confirm content during implementation.)

### Step 10 — Quality gate

```
pnpm lint && pnpm type-check && pnpm test
```

Expected impact on tests: mock factories change signature (object literal vs class constructor); mocked call-site behaviour identical. No integration DB schema changes.

### Step 11 — Confirm no regression in existing prestashop adapter spec

`prestashop-product-master.adapter.spec.ts` asserts the shape of returned variants — update expected objects if they check `ean: undefined` vs `ean: null`, or if they check `createdAt`/`updatedAt` are omitted (they shouldn't if the current interface's optional fields).

## 5. Validation

- **Architecture**: Domain entity lives in `domain/entities/` (correct per engineering-standards "Files and Folders"). No NestJS/TypeORM imports in that file. ✅
- **Naming**: File stays `product-variant.entity.ts` per domain-entity convention. ✅
- **Union/interface rules**: Interface is PascalCase in its own `*.entity.ts` file. Engineering-standards §"Type Definitions in Separate Files" allows entity types in `*.entity.ts` (not `*.types.ts`) since it's the canonical entity shape.
- **Barrel hygiene**: single export per name, no `As Alias` shim after migration.
- **Tests**: all unit tests must pass; no new tests required (reshape-only).

## 6. Risk

- **Type-error blast radius**: any consumer that relies on `ProductVariant` being a class (e.g. `instanceof ProductVariant`) will break. Grep confirmed zero `instanceof ProductVariant` in the codebase. ✅
- **Silent behaviour changes**: the `ean ?? undefined` → `ean ?? null` shift in the adapter could surface downstream code that does `if (variant.ean)` (truthy check is still correct) vs `if (variant.ean === undefined)` (becomes always-false). Grep for strict-undefined checks on barcode fields before committing.

## 7. Out of scope (new follow-up issues)

Confirmed via grep:
- `Product` has the same duality (port interface at `product-master.port.ts:19` + class entity at `domain/entities/product.entity.ts`, alias `ProductEntity` in the barrel).
- `Category` has a port-interface-only form (no corresponding class entity today) — no duality, but the `[key: string]: unknown` index signature should be dropped in the same spirit.

Will file a follow-up issue after this PR lands so the reviewer can see the shape this PR adopts first.

## 8. Open questions resolved

| Question | Decision |
|---|---|
| Keep class or use interface? | Interface. Issue recommends it; repositories build plain objects. |
| Required or optional timestamps? | **Required.** Adapters stamp `new Date()` placeholders; TypeORM handles persistence timestamps. |
| `ean`/`gtin` null vs undefined? | **`string \| null`.** Aligns with DB columns; consumers do truthy check in practice. |
| Keep the `[key: string]: unknown` index signature? | **No.** Issue explicitly calls it out as a bug-hiding escape hatch. |
| Keep `ProductVariantEntity` alias in the barrel? | **No.** After migrating three test files, it has zero consumers. |
| Address `Product` / `Category` duality? | **Out of scope.** Follow-up issue filed after merge. |
