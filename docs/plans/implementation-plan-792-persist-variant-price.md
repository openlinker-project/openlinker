# Implementation Plan — Persist + expose `ProductVariant.price` (#792 PR 1)

**Status:** ready for implementation
**Branch:** `792-persist-variant-price`
**Footer:** `Refs #792` (PR 1 of 3; does not close — see #792 sequencing)

## 1. Goal

Make per-variant master price readable end-to-end: from PrestaShop sync → ORM persistence → repository → application service → controller → HTTP DTO → FE wire type. Unblocks PR 2 (batch inventory) and PR 3 (wizard refactor) which both depend on `variant.price` being on the wire.

**Layer:** Backend (CORE persistence + Integration adapter + Interface DTO) + Frontend transport types. No FE rendering.

**Explicit non-goals:**
- No wizard UI changes (PR 3).
- No inventory endpoint changes (PR 2).
- No `ProductVariantSummaryResponseDto` extension — keep summary projection unchanged.
- No write-side API exposing variant price (read-only this PR).
- No historical backfill — variants get `price` populated on natural sync churn; `null` until then.

## 2. Codebase grounding

| File | Current state | Change |
|---|---|---|
| `libs/core/src/products/infrastructure/persistence/entities/product-variant.orm-entity.ts` | No `price` column. | Add `@Column({ type: 'decimal', precision: 10, scale: 2, nullable: true }) price!: number \| null;` mirroring `ProductOrmEntity.price` precedent. |
| `apps/api/src/migrations/` | Last timestamp `1798000000000`. | Add `1799000000000-add-price-to-product-variants.ts`. |
| `libs/core/src/products/domain/entities/product-variant.entity.ts` | `price?: number` already declared, comment says "master-derived, not persisted". | Update comment — now persisted. Keep optional shape (adapters/drafts can still omit). |
| `libs/core/src/products/infrastructure/persistence/repositories/product-variant.repository.ts` | `toDomain` and `toOrmEntity` skip price. | Round-trip price using `Number(entity.price) when !== null` pattern from `ProductRepository.toDomain` (line 86-98). |
| `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.ts:58` | `mapVariant` already returns `price: this.parseNumber(combination.price)`. | No change — works as-is once the ORM column exists. |
| `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-product-master.adapter.ts:202-230` | Synthetic-variant branch (products without combinations) returns variant without `price`. | Add `price: this.parseNumber(prestashopProduct.price) ?? null` to the synthetic variant — without this, every simple product becomes `no-master-price` blocked in PR 3. |
| `apps/api/src/products/http/dto/product-variant-response.dto.ts` | No price field. | Add `@ApiPropertyOptional({ nullable: true, description: 'Master variant price (nullable when not yet synced)' }) price!: number \| null;`. |
| `apps/api/src/products/http/products.controller.ts:50-61` (shared `variantToDto`) | Doesn't pass through price. | Add `price: variant.price ?? null` to the returned DTO. Two call sites (`ProductsController.toVariantDto`, `VariantsController.toVariantDto`) both delegate to the shared helper — single edit. |
| `apps/web/src/features/products/api/products.types.ts:17-27` | FE `ProductVariant` type has no price. | Add `price: number \| null;` mirroring the DTO. |

**Precedents to follow exactly:**
- Decimal column: `ProductOrmEntity.price` — `decimal(10,2) nullable`.
- ORM → domain price coercion: `ProductRepository.toDomain` uses `entity.price !== null ? Number(entity.price) : null` to preserve `price=0` (TypeORM surfaces decimal as string).
- DTO null-handling: `ProductResponseDto.price` is `number | null` with `@ApiPropertyOptional({ nullable: true })`.

## 3. Changes — step by step

### Step 1 — ORM column

File: `libs/core/src/products/infrastructure/persistence/entities/product-variant.orm-entity.ts`

Add after the `gtin` column:

```ts
@Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
price!: number | null;
```

AC: TypeScript compiles, `pnpm --filter @openlinker/api migration:show` shows a pending migration after Step 2.

### Step 2 — Migration

```bash
pnpm --filter @openlinker/api migration:generate -- src/migrations/AddPriceToProductVariants
```

Expected: generates `apps/api/src/migrations/{timestamp}-AddPriceToProductVariants.ts` with `ALTER TABLE "product_variants" ADD "price" numeric(10,2)`.

**Always hand-rename to the next free 13-digit slot.** Existing migrations are hand-bumped (`1798000000000-…` is the latest), and `migration:generate` produces a current-clock `1779…`-range value that sorts *before* the existing migrations. Rename the file to `1799000000000-add-price-to-product-variants.ts` and update the class suffix (`AddPriceToProductVariants1799000000000`) to match. This is the repo convention — see `docs/migrations.md` § Timestamp uniqueness invariant.

Then add a JSDoc header to the migration file (per `docs/engineering-standards.md` § File Headers) explaining what it does and the #792 context (one short paragraph).

Run `pnpm lint` to verify `scripts/check-migration-timestamps.mjs` passes.

AC:
- [ ] Migration file at `apps/api/src/migrations/1799000000000-add-price-to-product-variants.ts`, class `AddPriceToProductVariants1799000000000`.
- [ ] JSDoc header present on the migration file.
- [ ] `pnpm lint` green (timestamp invariant + filename/class consistency).
- [ ] `pnpm --filter @openlinker/api migration:run` applies cleanly on a fresh DB **and** on an existing dev DB.
- [ ] `pnpm --filter @openlinker/api migration:revert` rolls back cleanly (drops the column).
- [ ] Re-running `migration:run` after revert re-applies idempotently.
- [ ] `pnpm --filter @openlinker/api migration:show` lists the new migration before run, marks it executed after.

### Step 3 — Domain entity comment update

File: `libs/core/src/products/domain/entities/product-variant.entity.ts:28-29`

Update the comment on `price?: number`:

```ts
/**
 * Master price for this variant. Persisted on the variants table.
 * Optional at the domain level so adapter drafts and test factories may
 * omit it; the repository / DTO layer normalises `undefined ↔ null` at
 * the persistence and wire boundaries. Do not assign `null` directly to
 * a domain instance — TypeScript will reject it, and the boundary
 * normalisation is what callers should rely on.
 */
price?: number;
```

AC: comment reads correctly; no behavioural change.

### Step 4 — Repository mapping

File: `libs/core/src/products/infrastructure/persistence/repositories/product-variant.repository.ts:218-247`

**`toDomain`** — add price after `gtin`:

```ts
price: entity.price !== null ? Number(entity.price) : undefined,
```

(Domain `price` is `number | undefined`, not `number | null` — preserve the optional-undefined shape.)

**`toOrmEntity`** — add price after `gtin`:

```ts
entity.price = variant.price ?? null;
```

AC: existing repository unit tests still pass; new spec covers price round-trip.

### Step 5 — PrestaShop synthetic-variant price fallback

File: `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-product-master.adapter.ts:222-230`

In the synthetic-variant branch (`combinations.length === 0`), add price from the parent product:

```ts
return [
  {
    id: internalId,
    productId,
    sku,
    attributes: null,
    ean: productEan ?? null,
    gtin: productGtin ?? null,
    price: this.parseProductPrice(prestashopProduct.price),
  },
];
```

Where `parseProductPrice` is either a small inline helper or — preferred — call `this.productMapper.mapProduct(prestashopProduct, 1).price` and pull `.price` (but that does extra work; an inline `Number(prestashopProduct.price)` with null-fallback is fine here, mirroring the mapper's `parseNumber`).

**Decision**: inline a tiny private helper on the adapter:

```ts
private parseProductPrice(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}
```

(Lives on the adapter, not the mapper, because the adapter is the synthetic-variant branch's owner; reusing the mapper's private `parseNumber` would require widening the mapper interface.)

AC: existing PrestaShop adapter unit tests still pass; new spec covers the synthetic-variant price-fallback case.

### Step 6 — Response DTO

File: `apps/api/src/products/http/dto/product-variant-response.dto.ts`

Add after `gtin`:

```ts
@ApiPropertyOptional({
  nullable: true,
  description: 'Master variant price. Nullable when not yet synced or unavailable from the master source.',
})
price!: number | null;
```

File: `apps/api/src/products/http/products.controller.ts:50-61`

Update the shared `variantToDto`:

```ts
function variantToDto(variant: ProductVariant): ProductVariantResponseDto {
  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    attributes: variant.attributes,
    ean: variant.ean ?? null,
    gtin: variant.gtin ?? null,
    price: variant.price ?? null,
    createdAt: variant.createdAt!.toISOString(),
    updatedAt: variant.updatedAt!.toISOString(),
  };
}
```

AC: `ProductsController.spec.ts` updated to assert price passes through; both `GET /products/:id` (which includes variants) and `GET /products/:productId/variants` carry it.

### Step 7 — FE wire type

File: `apps/web/src/features/products/api/products.types.ts:17-27`

Add `price: number | null;` after `gtin`:

```ts
export interface ProductVariant {
  id: string;
  productId: string;
  sku: string | null;
  attributes: Record<string, string> | null;
  ean: string | null;
  gtin: string | null;
  price: number | null;
  createdAt: string;
  updatedAt: string;
  externalIds?: ExternalIdMapping[];
}
```

AC: FE `pnpm --filter @openlinker/web type-check` green. No FE consumers yet (PR 3 introduces them).

### Step 8 — Tests

| Test | Location | Coverage |
|---|---|---|
| `product-variant.repository.spec.ts` | `libs/core/src/products/infrastructure/persistence/repositories/__tests__/` (if existing) or colocated | Price round-trip via `upsert` → `findById`: null, zero, positive, decimal. |
| `prestashop-product.mapper.spec.ts:580` (existing `mapVariant` block) | Already exists. | Add an assertion that returned variant carries `price` from `combination.price`. |
| `prestashop-product-master.adapter.spec.ts` | Existing adapter spec. | New test: synthetic-variant branch (no combinations) carries `price` from `prestashopProduct.price`; handles missing/non-numeric gracefully (undefined preserved). |
| `products.controller.spec.ts` | `apps/api/src/products/http/` | Assert the DTO carries `price: number \| null` for both null and non-null cases. |
| **Integration spec — `products-read.int-spec.ts`** | `apps/api/test/integration/` (existing) | Extend with: seed a product + variant with non-null `price` via the repository, hit `GET /products/:id`, assert `variants[0].price` is the expected number. Also assert null-price variant serialises as `null`. End-to-end exercise of the ORM column → repository round-trip → DTO serialisation chain in one request. |

AC: `pnpm test` green, `pnpm test:integration` green.

## 4. Quality gate

Run in order (each must be green):

```bash
pnpm lint                                                # invariants + ESLint
pnpm type-check                                          # zero TS errors
pnpm --filter @openlinker/api migration:show             # new migration listed pending
pnpm --filter @openlinker/api migration:run              # applies cleanly
pnpm --filter @openlinker/api migration:show             # marks executed
pnpm --filter @openlinker/api migration:revert           # rolls back cleanly
pnpm --filter @openlinker/api migration:run              # re-applies idempotently
pnpm test                                                # unit tests green
pnpm test:integration                                    # int-specs green (incl. products-read)
```

## 5. Risks & open questions

| Risk | Mitigation |
|---|---|
| Migration timestamp collision (rare branch-merge window). | `pnpm lint` runs `scripts/check-migration-timestamps.mjs` and fails on collision. Manual recipe: bump to next free ms and update class suffix. |
| Synthetic-variant branch silently swallows non-numeric prices. | Inline `parseProductPrice` returns `undefined` (not throw) on non-numeric input; matches `parseNumber` in the mapper. Surfaces as `no-master-price` blocker in PR 3 (correct downstream behaviour). |
| Existing variants in dev/prod DBs get `null` price. | Documented in the issue body's Out of Scope (historical backfill — relies on natural sync churn). FE handles `null` as `no-master-price`. |
| `ProductVariant.price` is optional in the domain entity but `number \| null` in DTO/FE — shape mismatch. | Repository normalises `undefined ↔ null` at the persistence boundary. Domain stays optional for pre-persistence draft compatibility (existing convention). |

**Open questions:** none — all four BLOCKING items from the refinement were resolved when locking the issue body.

## 6. Validation against standards

- ✅ Hexagonal architecture: ORM entity is infrastructure; domain entity stays framework-free; adapter writes domain → repo persists.
- ✅ Naming: `*.orm-entity.ts`, `*.repository.ts`, `*.adapter.ts`, `*-response.dto.ts` — all unchanged file shapes.
- ✅ Repository port: no port change needed (price is just round-tripped through existing `upsert` / `findById` / `findByProductId` / `findBySku` / `findBySkuIn` / `findByEanOrGtinIn` / `findMany`).
- ✅ Types: domain `ProductVariant` already declares price; DTO + FE types mirror.
- ✅ `as const` pattern: not applicable (price is `number | null`, not enumerated).
- ✅ Migration invariant: timestamp + class-name match enforced by `pnpm lint`.
- ✅ Logging: no new log sites needed (sync path logs at the existing `getProductVariants` boundary).
- ✅ Security: no auth-surface change, no credential handling.
- ✅ Performance: one extra column read per variant — negligible.

## 7. Out of scope (deferred to follow-ups)

- Variant-price exposure in `ProductVariantSummaryResponseDto`.
- Backfill job for historical variants.
- Adapter implementations beyond PrestaShop (no other master adapters today).
- Wizard FE consumption (PR 3 of #792).
- Batch inventory endpoint (PR 2 of #792).
