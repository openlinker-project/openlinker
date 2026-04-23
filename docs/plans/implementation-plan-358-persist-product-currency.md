# Implementation Plan — #358 Persist `Product.currency`

Follow-up from PR #357. The `currency` field travels from the PrestaShop mapper → adapter → `ProductsService.upsertProduct` → `ProductRepository.upsert`, but dies at the `toOrmEntity` boundary because the ORM entity has no currency column. This plan closes the loop.

---

## 1. Goal

End-to-end: `GET /products` returns `currency` non-null for products synced from a connection whose adapter populates it. Products list in the web UI renders the currency glyph instead of the muted "Currency unknown" fallback.

## 2. Layer classification

- **CORE** — ORM entity + repository mapping (no port or service changes)
- **Infrastructure (persistence)** — schema migration
- **Interface** — DTO docstring cleanup
- **Integration (PrestaShop)** — decision point on the hardcoded `'EUR'`

No domain/application contract changes; the domain `Product.currency` field and the repository port signature already support `string | undefined`.

## 3. Non-goals

- Multi-currency price lists per product (one currency per product is the product-table semantic)
- Currency on `ProductVariant` (variants inherit from the parent product)
- Backfill for pre-migration products — the next sync repopulates currency; until then existing rows keep the muted fallback
- Frontend changes — FE already consumes `currency` from PR #357

## 4. Research notes

- `ProductOrmEntity` (`libs/core/src/products/infrastructure/persistence/entities/product.orm-entity.ts`) — six columns today: `id`, `name`, `sku`, `price`, `description`, `images`, `createdAt`, `updatedAt`. No `currency`.
- `ProductRepository.toDomain` (line 74) reads six fields + timestamps; `toOrmEntity` (line 93) writes the same six. `currency` is never touched.
- Domain `Product.currency?: string` (`product.entity.ts:30`) — already there, commented "Master-derived, not persisted on the products table." Comment becomes stale after this PR.
- `PrestashopProductMapper.mapProduct` (`prestashop-product.mapper.ts:33`) hardcodes `currency: 'EUR'`. The mapper is already constructed per-connection via `PrestashopAdapterFactory` (`libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts:72-74`), so per-connection currency is a viable extension point if we want it later.
- `PrestashopCurrencyResolver` (`libs/integrations/prestashop/src/infrastructure/provisioners/prestashop-currency-resolver.ts`) goes the *wrong direction* — ISO code → PrestaShop currency ID. Not reusable here.
- Migration pattern (e.g., `1783000000000-add-order-record-status.ts`) is plain `ALTER TABLE ... ADD COLUMN`. No index needed — currency is descriptive, not queried.
- `ProductsController` + its unit spec were updated in PR #357 to map and assert `currency`. That coverage stays valid.
- No existing products integration test. Need a new `products-read.int-spec.ts` per the issue AC.

## 5. Design

### 5.1 Schema — add `currency varchar(3) NULL`

- Column type: `varchar(3)` nullable. ISO 4217 is always 3 letters; a `CHAR(3)` would be equivalent but TypeORM defaults to `varchar` for string fields — stay consistent with `sku`.
- No index: currency is a display field, not a query predicate.
- Nullable: existing rows stay null until their next sync.

### 5.2 ORM entity

Add one field:

```typescript
@Column({ type: 'varchar', length: 3, nullable: true })
currency!: string | null;
```

### 5.3 Domain nullability alignment

The existing domain `Product.currency?: string` (optional, `undefined`-shaped) is inconsistent with `sku`, `price`, `description` — all of which use `string | null`. The FE `Product` type and `ProductResponseDto` are both already `currency: string | null`. Align the domain to match before wiring the ORM column, so both mapping methods become straight pass-throughs (no null↔undefined coercion at the repo boundary).

- Change `product.entity.ts:30` from `currency?: string` → `currency: string | null`.
- Fix any adapters that return partial products to include `currency: null` explicitly — this is a `strictNullChecks` enforcement that `pnpm type-check` will flag.

### 5.4 Repository mapping

With the domain aligned, mapping is trivial:

- `toDomain`: `currency: entity.currency` (both `string | null`, direct pass-through).
- `toOrmEntity`: `entity.currency = product.currency` (direct pass-through).

### 5.5 DTO docstring

Remove the "Currently always null pending ..." hedge added in PR #357. Replace with:

```text
ISO 4217 currency code (e.g., PLN, EUR), resolved from the master catalog at sync time. Null when the adapter did not provide a currency.
```

### 5.6 PrestaShop mapper currency source — decision

**Decision: Option D — drop the hardcoded `'EUR'` in `PrestashopProductMapper.mapProduct` and emit `currency: null`. Persist-plumbing only; no wrong-data regression. File a follow-up issue for a real source (Option B or C).**

Why:
- The current hardcode is safe today because persistence drops it. Once we wire the column through, every PS-synced product would persist `currency='EUR'` — **wrong for the primary operator cohort (PL shops on PLN)** and regressing the FE from an honest muted "Currency unknown" fallback to a confident but incorrect "EUR" glyph. Violates "status first, debuggable by design" (`docs/frontend-ui-style-guide.md`).
- Option D keeps the PR minimal (no config field, no webservice endpoint) while not introducing a data-quality regression: `currency` stays `null` in the DB until a proper source lands, FE still renders the muted fallback, and the plumbing is ready for B/C to drop in without another migration.

Alternatives considered:
- **Option A (keep hardcoded `'EUR'`)** — satisfies AC literally but confidently persists wrong currency for PLN shops. Rejected.
- **Option B (connection config)** — add optional `currency` to `PrestashopConnectionConfig`, flow into mapper options, fall back to `null` when unset. Medium scope (validation + factory wiring + eventual wizard input). Tracked as the follow-up direction.
- **Option C (auto-detect)** — fetch `PS_CURRENCY_DEFAULT` via `/configurations` at factory time and cache per connection. Largest scope (new resolver, cache, tests). Best UX long-term; possibly the follow-up's final shape.

## 6. Step-by-step implementation

### Step 1 — Align domain nullability
- `libs/core/src/products/domain/entities/product.entity.ts`:
  - Change `currency?: string` → `currency: string | null`.
  - Rewrite the JSDoc from "Master-derived, not persisted on the products table" to something like "ISO 4217 currency code resolved at sync time; null when the adapter did not provide one."

### Step 2 — Drop PrestaShop mapper hardcode
- `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.ts:33`:
  - Change `currency: 'EUR', // Default, can be configured` → `currency: null,` with a short comment referencing the follow-up issue (Step 10) for the real source.
- Any mapper test / factory that asserts `currency: 'EUR'` gets updated to `currency: null`.
- If `PrestashopProductMapperOptions` currently exposes no currency field, no options change needed; otherwise keep the option optional and plumb it through later.

### Step 3 — ORM entity
- `libs/core/src/products/infrastructure/persistence/entities/product.orm-entity.ts`: add the `currency` column (`varchar(3) NULL`).

### Step 4 — Repository mapping
- `libs/core/src/products/infrastructure/persistence/repositories/product.repository.ts`:
  - `toDomain`: include `currency: entity.currency`.
  - `toOrmEntity`: include `entity.currency = product.currency`.
  - No null↔undefined coercion needed after Step 1.

### Step 5 — DTO docstring
- `apps/api/src/products/http/dto/product-response.dto.ts`: replace the "Currently always null" hedge with the final description (see §5.5).

### Step 6 — Migration
- **Precondition**: `pnpm dev:stack:up` must be running and the DB must be on the last committed migration (`pnpm --filter @openlinker/api migration:show` clean), per `docs/migrations.md#prerequisites`.
- Run `pnpm --filter @openlinker/api migration:generate -- src/migrations/AddCurrencyToProducts`.
- Verify the generated `up()`/`down()` — expect simple `ALTER TABLE "products" ADD COLUMN "currency" varchar(3)` up and `DROP COLUMN "currency"` down. Hand-tune header comment if TypeORM emits something more elaborate.
- Run `pnpm --filter @openlinker/api migration:run`; then `migration:revert` to verify `down()`; then `migration:run` again to leave the dev DB migrated.

### Step 7 — Unit tests
- `ProductRepository` has no dedicated spec today; skip adding one (covered by integration test in Step 8).
- `apps/api/src/products/http/products.controller.spec.ts` — existing PR #357 test (`should surface currency when the domain entity carries one`) stays green.
- Update any existing PrestaShop product mapper spec that asserts `currency: 'EUR'` to assert `currency: null`.

### Step 8 — Integration test
- New file: `apps/api/test/integration/products-read.int-spec.ts`.
- Seed a product with `currency='PLN'` via the repository directly (not via the adapter — the mapper returns `null` now by design), hit `GET /products`, assert `body.items[0].currency === 'PLN'`.
- Also cover the null case: seed a product with `currency: null`, assert the DTO returns `currency: null`.
- Use the existing `getTestHarness()` / `resetTestHarness()` pattern from other int-specs.

### Step 9 — Quality gate
```bash
pnpm lint
pnpm type-check
pnpm test
pnpm --filter @openlinker/api migration:show
pnpm test:integration  # new products-read spec + existing suite, requires Docker
```

### Step 10 — File follow-up issue
Open a new issue: "Resolve PrestaShop product currency from shop config or connection setting". Scope (recommended: Option B):
- Add optional `currency?: string` (ISO 4217) to `PrestashopConnectionConfig` with `class-validator` length/format rules.
- Flow through `PrestashopAdapterFactory` → `PrestashopProductMapperOptions` → `mapProduct`.
- Fall back to `null` when unset (keeps current muted-FE behaviour).
- Optional later: Option C (auto-detect via `/configurations?filter[name]=PS_CURRENCY_DEFAULT`) as a wizard convenience.

### Step 11 — Commit + PR
- Conventional commit: `feat(products): persist Product.currency to the products table`
- PR body: `Closes #358`, reference follow-up issue from Step 10, call out the Option D decision + the domain nullability alignment.

## 7. Architecture compliance check

- Change is confined to ORM entity + repo mapping + migration + DTO docstring. No port or service contract shifts. ✅
- Domain entity's `currency?: string` already existed — no domain-layer change other than a doc-comment cleanup.
- No framework bleed into domain. ✅
- Migration co-located correctly in `apps/api/src/migrations/`. ✅

## 8. Risks and open questions

- **Hardcoded 'EUR' on PS adapter** — documented as a known limitation for this PR. Non-PL/EU shops synced today would persist `currency='EUR'` incorrectly. Realistic impact today is near-zero (all current connections are PL/EU shops), but the comment in the mapper should call this out.
- **Decimal type on `price`** — TypeORM returns strings for `decimal`; the repo already handles this at line 79. No parallel concern for `currency` since `varchar` is returned as a string as expected.
- **`varchar(3)` vs `text`** — `varchar(3)` hard-caps ISO 4217. If the domain ever needed to carry a non-ISO currency code (e.g., a cryptocurrency ticker, 4+ chars), the migration would need to relax. Cost to revisit is low (single migration). Using `text` is also defensible; chose `varchar(3)` to match schema-level validation.

## 9. Test strategy summary

- Unit tests: no new coverage needed (existing PR #357 controller test + pre-existing repo tests are sufficient).
- Integration test: 1 new file covering seed → read → assert currency passthrough.
- No frontend tests — FE already consumes the field, nothing on the UI side has changed.
