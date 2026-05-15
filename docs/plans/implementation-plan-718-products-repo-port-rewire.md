# Implementation Plan — Rewire products repository-port callers through IProductsService (#718, slice 1 of 4)

**Issue**: [#718 — Rewire cross-context repository-port couplings through service interfaces](https://github.com/SilkSoftwareHouse/openlinker/issues/718)
**Slice**: 4 callers of `products` repository ports → `IProductsService` extensions.
**Branch**: `718-products-repo-port-rewire`
**Drops**: 8 of the 20 `(file, symbol)` entries from `scripts/check-cross-context-imports.mjs`.

---

## 0. Goal

Eliminate four cross-context value-imports of `products`-owned repository ports. After this PR:

- `inventory-query.service.ts` no longer imports `ProductRepositoryPort` — it calls `IProductsService` instead.
- `order-item-ref-resolver.service.ts`, `offer-builder.service.ts`, and `offer-mapping-sync.service.ts` no longer import `ProductVariantRepositoryPort` — same.
- The four production files + their four spec files (8 entries) drop from the cross-context-imports allow-list.
- `pnpm check:invariants` stays green with those 8 entries removed.

**Bonus**: the existing TODO at `inventory-query.service.ts:63` about replacing the N-per-call lookup with a batch method is addressed in the same PR — adding `findProductsByIds` to the products port + service is the minimal-cost shape that fits the rewire.

**Non-goals** (the other three slices of #718, deferred):

- Sync repository-port callers (slice 2 of #718 — `offer-status-poll.service.ts`, `order-ingestion.service.ts`).
- Listings repository-port callers (slice 3 — `content-state-reader.service.ts`, `integrations-content-publisher.service.ts`).
- Integrations credential-repository callers (slice 4 — `ai-provider-key.service.ts`, `credentials-ai-provider.adapter.ts`).

Each slice is independent; this PR closes one source-context bucket.

---

## 1. Architecture mapping

| Layer | What lands here |
|---|---|
| **CORE — Products domain** | New `findByIds(ids)` on `ProductRepositoryPort`. No new variant-port methods needed — the four call shapes are already on `ProductVariantRepositoryPort`. |
| **CORE — Products infrastructure** | `ProductRepository.findByIds` impl (one `IN (...)` query). |
| **CORE — Products application** | Extend `IProductsService` + `ProductsService` with four new methods that proxy to the underlying repositories: `findProductsByIds`, `findVariantsBySkuIn`, `findVariantsByEanOrGtinIn`. (`getVariant`, the fourth shape, already exists.) |
| **CORE — Inventory application** | `inventory-query.service.ts` injects `IProductsService` instead of `ProductRepositoryPort`; `buildProductMap` becomes one `findProductsByIds(ids)` call. |
| **CORE — Orders application** | `order-item-ref-resolver.service.ts` injects `IProductsService` instead of `ProductVariantRepositoryPort`; calls `getVariant(id)` in the four branches. |
| **CORE — Listings application** | `offer-builder.service.ts` calls `getVariant(id)`. `offer-mapping-sync.service.ts` calls `findVariantsBySkuIn` + `findVariantsByEanOrGtinIn`. Both inject `IProductsService`. |
| **Lint** | Drop 8 entries from `ALLOW_LIST` in `scripts/check-cross-context-imports.mjs`. |
| **Module wiring** | Add `IProductsService`'s binding to the `forwardRef` graph wherever the four consumer modules import products (the binding already exists on `ProductsModule`; verify and adjust each consumer module's `imports`). |

Why `IProductsService` (one umbrella) and not a narrower seam per consumer? The four shapes (`findProductsByIds`, `getVariant`, `findVariantsBySkuIn`, `findVariantsByEanOrGtinIn`) are all small reads on the same aggregate root family (Product + ProductVariant) and there's no operational reason to split them into narrower service interfaces. The issue body explicitly nominates `IProductsService` as the seam. Future contention (e.g. write-vs-read split) is a refactor inside the products context that won't break consumers.

---

## 2. Domain layer changes

### 2.1 `ProductRepositoryPort.findByIds(ids: string[]): Promise<Product[]>`

`libs/core/src/products/domain/ports/product-repository.port.ts`

```ts
/**
 * Find products by internal-id list. Returns rows in arbitrary order;
 * caller maps by id. Missing ids are silently dropped (no null fillers)
 * — same shape as `findBySkuIn` / `findByEanOrGtinIn` on the variant port.
 */
findByIds(ids: string[]): Promise<Product[]>;
```

Empty-input contract: `findByIds([])` returns `[]` synchronously (no DB round-trip). Caller doesn't need to guard.

---

## 3. Infrastructure layer changes

### 3.1 `ProductRepository.findByIds`

`libs/core/src/products/infrastructure/persistence/repositories/product.repository.ts`

```ts
async findByIds(ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return [];
  const rows = await this.ormRepository.find({ where: { id: In(ids) } });
  return rows.map((row) => this.toDomain(row));
}
```

`In` already imported from `typeorm` elsewhere in the file. No new dependencies.

---

## 4. Application layer — IProductsService extension

### 4.1 New methods on `IProductsService`

`libs/core/src/products/application/services/products.service.interface.ts`

Names follow the existing `get*` convention on the interface (`getProduct`, `getVariant`) — multi-key reads pluralise the noun. Mirrors the repository-port shape underneath but doesn't bleed the port's `find*` verb across the seam.

```ts
/**
 * Batch product lookup by internal id. Missing ids are silently
 * dropped — caller maps results by `product.id` if presence matters.
 * Empty input returns `[]` without a DB round-trip.
 */
getProductsByIds(ids: string[]): Promise<Product[]>;

/**
 * Variant lookup by SKU list. Empty input returns `[]` without a
 * DB round-trip.
 */
getVariantsBySkus(skus: string[]): Promise<ProductVariant[]>;

/**
 * Variant lookup by EAN or GTIN list, scoped to a master-catalog
 * connection. Empty input returns `[]` without a DB round-trip.
 */
getVariantsByBarcodes(
  connectionId: string,
  values: string[],
  field: 'ean' | 'gtin',
): Promise<ProductVariant[]>;
```

`getVariant(id)` already exists and matches `variantRepository.findById(id)` — no rename needed.

### 4.2 `ProductsService` impls

`libs/core/src/products/application/services/products.service.ts`

Each is a thin pass-through to the repository port the service already holds, **with empty-input short-circuit at the service layer** so consumers drop the `length > 0 ? ... : []` ternary:

```ts
getProductsByIds(ids) {
  if (ids.length === 0) return Promise.resolve([]);
  return this.productRepository.findByIds(ids);
}
getVariantsBySkus(skus) {
  if (skus.length === 0) return Promise.resolve([]);
  return this.variantRepository.findBySkuIn(skus);
}
getVariantsByBarcodes(connId, values, field) {
  if (values.length === 0) return Promise.resolve([]);
  return this.variantRepository.findByEanOrGtinIn(connId, values, field);
}
```

The repository-port `findByIds` (§2.1) also short-circuits internally as a belt-and-braces (we're already crossing the seam there too).

---

## 5. Rewire the four consumers

**Pre-step**: verify `ProductsModule.exports` includes `PRODUCTS_SERVICE_TOKEN` (not just `PRODUCT_REPOSITORY_TOKEN` / `PRODUCT_VARIANT_REPOSITORY_TOKEN`). If missing, add the export — one-line edit, but should be the first change in the implementation diff so the four consumer swaps don't blow up on a DI lookup miss at boot.

For each consumer file:
1. Replace the `ProductRepositoryPort` / `ProductVariantRepositoryPort` import with `IProductsService` + `PRODUCTS_SERVICE_TOKEN`.
2. Swap the constructor injection: drop the repository port + its `@Inject(*_REPOSITORY_TOKEN)`, add `@Inject(PRODUCTS_SERVICE_TOKEN) private readonly productsService: IProductsService`.
3. Update method call sites.
4. **Update the file header `@see` line** — `inventory-query.service.ts:13` and the other three carry `@see {@link ProductRepositoryPort}` / `{@link ProductVariantRepositoryPort}` doc comments that go stale after the rewire. Replace with `@see {@link IProductsService}`.
5. Update the spec to mock `IProductsService` instead of the repository port.
6. Verify the consumer's NestJS module imports `ProductsModule` (most likely already, since they sit downstream of products in the dep graph).

### 5.1 `inventory-query.service.ts`

- `this.productRepository.findById(item.productId)` → `this.productsService.getProduct(item.productId)`.
- `buildProductMap` rewrites to a single `findProductsByIds(uniqueIds)` call. The TODO comment at line 63 is deleted.

Module: `apps/api/src/inventory/inventory.module.ts` — confirm `imports: [ProductsModule, ...]` (or wherever it currently pulls `PRODUCT_REPOSITORY_TOKEN` from).

### 5.2 `order-item-ref-resolver.service.ts`

- All four `this.variantRepository.findById(internalId)` calls → `this.productsService.getVariant(internalId)`.

Module: `apps/api/src/orders/orders.module.ts` (or wherever this service is provided) — confirm `imports: [ProductsModule]`.

### 5.3 `offer-builder.service.ts`

- One `this.variantRepository.findById(input.internalVariantId)` → `this.productsService.getVariant(...)`.

Module: listings → check.

### 5.4 `offer-mapping-sync.service.ts`

- `this.variantRepository.findBySkuIn(skuCandidates)` → `this.productsService.findVariantsBySkuIn(skuCandidates)`.
- Both `this.variantRepository.findByEanOrGtinIn(...)` → `this.productsService.findVariantsByEanOrGtinIn(...)`.

Module: same as 5.3.

---

## 6. Spec rewires

Each spec currently constructs a `jest.Mocked<ProductVariantRepositoryPort>` (or `ProductRepositoryPort`) and provides it under the repository token. The rewire:

1. Replace the mock type with `jest.Mocked<Pick<IProductsService, '...'>>` (use `Pick<>` so we only mock the methods the consumer touches — no need to stub all 9+ methods of `IProductsService`).
2. Replace the `provide: PRODUCT_*_REPOSITORY_TOKEN` binding with `provide: PRODUCTS_SERVICE_TOKEN`.
3. Update assertions: `expect(mockRepo.findById).toHaveBeenCalledWith(...)` → `expect(mockProductsService.getProduct).toHaveBeenCalledWith(...)` etc.

**Per-spec mock surface** (keeps spec scope tight, protects against accidentally stubbing methods the SUT doesn't call):

| Spec | `Pick<IProductsService, …>` |
|---|---|
| `inventory-query.service.spec.ts` | `'getProduct' \| 'getProductsByIds'` |
| `order-item-ref-resolver.service.spec.ts` | `'getVariant'` |
| `offer-builder.service.spec.ts` | `'getVariant'` |
| `offer-mapping-sync.service.spec.ts` | `'getVariantsBySkus' \| 'getVariantsByBarcodes'` |

Existing assertion semantics are preserved — the underlying call shape doesn't change, only the injection seam.

---

## 7. Allow-list cleanup

`scripts/check-cross-context-imports.mjs` — remove the 8 entries grouped under the three rewire comments:

```
// inventory → products.ProductRepositoryPort — rewire via IProductsService
// orders → products.ProductVariantRepositoryPort — rewire via IProductsService
// listings → products.ProductVariantRepositoryPort — rewire via IProductsService
```

(Keep the remaining 12 entries — those are slices 2/3/4 of #718.)

---

## 8. Testing strategy

| Layer | Test | What it asserts |
|---|---|---|
| Products repository | `product.repository.spec.ts` (extend if exists, else add) | `findByIds([])` returns `[]` without hitting DB; `findByIds([a, b])` returns rows; missing ids drop silently. Unit-level with a mocked TypeORM repo. |
| Products service | `products.service.spec.ts` (extend) | Three new methods are pass-through — assert they call the repository with the same args. |
| Inventory consumer | `inventory-query.service.spec.ts` | `getInventoryItem` calls `productsService.getProduct`; `listInventoryItems` calls `productsService.findProductsByIds` exactly once with the de-duped id list. |
| Orders consumer | `order-item-ref-resolver.service.spec.ts` | Each of the four branches (offer/product/variant/sku) calls `productsService.getVariant` (where applicable). |
| Listings consumer | `offer-builder.service.spec.ts` | Calls `productsService.getVariant(input.internalVariantId)`. |
| Listings consumer | `offer-mapping-sync.service.spec.ts` | SKU lookup calls `findVariantsBySkuIn`; barcode lookup calls `findVariantsByEanOrGtinIn` with the `(connectionId, values, field)` args. |
| Lint invariant | `pnpm check:invariants` | Passes with the 8 allow-list entries removed. |

No integration test needed — this is a pure injection-seam refactor, no behaviour change.

---

## 9. Acceptance criteria (from #718, slice 1)

- [ ] `inventory-query.service.ts`, `order-item-ref-resolver.service.ts`, `offer-mapping-sync.service.ts`, `offer-builder.service.ts` no longer import `ProductRepositoryPort` or `ProductVariantRepositoryPort`.
- [ ] Their four spec files mock `IProductsService` instead of the repository ports.
- [ ] Allow-list in `scripts/check-cross-context-imports.mjs` drops 8 entries (the three rewire blocks at the top of the list).
- [ ] `pnpm check:invariants` stays green.
- [ ] `IProductsService` exposes only domain types (`Product`, `ProductVariant`) — no ORM entities or raw enum types leak.
- [ ] Existing TODO comment at `inventory-query.service.ts:63` removed (resolved by `findProductsByIds`).

---

## 10. Risks & open questions

- **NestJS module graph** — each consumer module must import `ProductsModule` (or have it in its forward-ref chain). The current imports use `PRODUCT_REPOSITORY_TOKEN` / `PRODUCT_VARIANT_REPOSITORY_TOKEN` which are exported by `ProductsModule` already, so the import line itself is unchanged. Verify per consumer.
- **Spec mock types**: using `Pick<IProductsService, ...>` keeps the mock scoped, but Nest's `Test.createTestingModule` is type-erased so a structural mock is fine. If a spec uses `jest.Mocked<IProductsService>` directly, all 9 methods need stubs — `Pick<>` is the smaller surface.
- **Circular imports** — `ProductsModule` already exports `PRODUCTS_SERVICE_TOKEN`; no new module imports needed. If a consumer's module currently doesn't import `ProductsModule` (only the bare token via `@nestjs/typeorm` magic), that's a latent bug — fix in the same PR.
- **Future shape changes** to `ProductRepositoryPort` / `ProductVariantRepositoryPort` now stop at the products context. Cross-context callers see only `IProductsService`, which is the explicit goal.

---

## 11. Out-of-scope follow-ups

- Slice 2 (sync repository ports) — `offer-status-poll.service.ts`, `order-ingestion.service.ts`. Tracked by #718.
- Slice 3 (listings.OfferMappingRepositoryPort callers) — `content-state-reader.service.ts`, `integrations-content-publisher.service.ts`. Tracked by #718.
- Slice 4 (integrations credentials) — `ai-provider-key.service.ts`, `credentials-ai-provider.adapter.ts`. Tracked by #718.
- Dropping the barrel exports of `ProductRepositoryPort` / `ProductVariantRepositoryPort` once all cross-context callers are gone. Intra-context callers (the products context itself) still need them, so the exports stay — the lint script is the gate, not the barrel.
