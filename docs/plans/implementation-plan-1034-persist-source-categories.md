# Implementation Plan — #1034 Phase 0: persist source categories on Product

**Issue:** #1034 · **Epic:** #1005 · **ADR-023 §0** (prerequisite — blocks the epic) · **Branch:** `1034-persist-source-categories-on-product`

---

## Phase 1 — Understand the task

**Goal.** Stop silently dropping `Product.categories` (the source-platform external category ids) on persist, so per-source-category mapping (#1036+) has an input. Persist + round-trip the existing `Product.categories: string[]` field.

**Layer.** **CORE** (products context) — ORM schema + repository mapping + migration. No new ports/services/tokens.

**Precise diagnosis (from research).**
- `Product` (interface) already has `categories?: string[]` — `libs/core/src/products/domain/entities/product.entity.ts:38` (commented *"not persisted on the products table"*).
- `MasterProductSyncService.toDomainProduct` already spreads `categories` through (`...product`) — it does **not** strip; its comment ("silently dropped on persist") points at the repository.
- The drop is in **`ProductRepository`**: `toOrmEntity` / `toDomain` map every field **except** `categories`, and `ProductOrmEntity` has **no `categories` column**.

**Non-goals (Phase 0 is deliberately minimal).** No category-mapping resolution / provenance scoping (that's #1036/#1037). No change to the `categories` *shape* — keep `string[]` (the PS/Woo mappers already produce external id strings); richer `{id,path}` provenance is a later epic phase. **No API/response-DTO surface** — the product GET endpoint will not expose `categories` here; that's #1044's surface work. The entire AC is the persistence round-trip ("persisted but not yet exposed" is intentional, not an omission).

---

## Phase 2 — Research (reuse map)

| Reuse / touch | Path |
|---|---|
| Domain field (exists, unchanged) | `products/domain/entities/product.entity.ts` — `categories?: string[]` |
| ORM entity (add column) | `products/infrastructure/persistence/entities/product.orm-entity.ts` — has `images jsonb`; mirror for `categories` |
| Repository mapping (add round-trip) | `products/infrastructure/persistence/repositories/product.repository.ts` — `toOrmEntity` (l.106) + `toDomain` (l.86) |
| Sync service (doc-only) | `products/application/services/master-product-sync.service.ts` — `toDomainProduct` already passes `categories`; fix the stale comment |
| Migration home | `apps/api/src/migrations/` (core schema) — see `docs/migrations.md` |
| Pattern reference | the existing `images: string[] | null` jsonb column is the exact precedent (column + both mappings) |

---

## Phase 3 — Design

`categories` follows the **`images`** precedent verbatim — a nullable `jsonb` `string[]` column with symmetric repository mapping. No domain/contract change (the interface field already exists); this is purely "make the existing field durable".

- **ORM**: `@Column({ type: 'jsonb', nullable: true }) categories!: string[] | null;` (after `images`).
- **toOrmEntity**: `entity.categories = product.categories ?? null;`
- **toDomain**: `categories: entity.categories ?? undefined,` (interface field is optional; DB `null` → omit, matching how adapters/drafts leave it absent).
- **Migration**: `ALTER TABLE "products" ADD "categories" jsonb` (up) / `DROP COLUMN "categories"` (down).

---

## Phase 4 — Step-by-step plan

1. **ORM column** — add `categories!: string[] | null` (`jsonb`, nullable) to `ProductOrmEntity`, directly after `images`. **AC:** column present; file header unchanged-style.
2. **Repository round-trip** — `toOrmEntity`: write `entity.categories = product.categories ?? null`; `toDomain`: read `categories: entity.categories ?? undefined`. **AC:** a domain `Product` with `categories` upserted then re-read via `findById` returns the same ids.
3. **Migration** `apps/api/src/migrations/{ts}-add-product-categories.ts` — **hand-authored** (NOT `migration:generate`, which would diff all entities against the dev DB and risk pulling unrelated drift into this surgical change). `up`: `ALTER TABLE "products" ADD "categories" jsonb`; `down`: `ALTER TABLE "products" DROP COLUMN "categories"`. 13-digit unique timestamp (greater than the latest existing migration) + matching class suffix (timestamp invariant). **AC:** `migration:run` + `migration:revert` both clean; `migration:show` shows no pending after run.
4. **Sync-service comment** — update `toDomainProduct`'s stale "silently dropped on persist" note: `categories` is now persisted (#1034); **`weight` remains intentionally transient** (no column — still master-derived only). **AC:** comment accurate; no logic change.
5. **Tests**
   - Repository round-trip: unit-test `upsert` → `toDomain` preserves `categories` (mock `Repository<ProductOrmEntity>` echoing the saved entity). **Assert all three cases**: a populated array survives, `[]` survives as `[]` (not coerced away), and `null`/absent returns absent — locking the null↔undefined bridge.
   - **Int-spec (AC)**: in `apps/api/test/integration` — upsert a product carrying `categories` through the real `IProductsService`, reload, assert `categories` survives (persisted round-trip against real Postgres). **First confirm an existing products-persistence int-spec to mirror**; if none, add a thin self-contained one (the unit round-trip + `migration:show` still cover the core).
6. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test`; for the schema change run `pnpm --filter @openlinker/api migration:show` (no pending) + `pnpm test:integration` (the new int-spec + product-sync regression) before PR.

---

## Phase 5 — Validate

- **Architecture:** CORE-only; mapping stays private in the repository (ORM↔domain rule); no port/DTO/token change; domain interface untouched.
- **Naming/standards:** migration timestamp invariant; `as const` n/a; no `any`.
- **Migration:** required (ORM entity schema change) — follow `docs/migrations.md`; both `up`/`down` implemented.
- **Risk:** very low — additive nullable column mirroring `images`; existing rows get `null`; no backfill needed (categories populate on next product sync).

### Open questions
- **Category shape** — Phase 0 persists `string[]` (current field). If ADR-023 later needs structured provenance (`{ id, path, sourcePlatform }`), that's a typed follow-up in a later epic phase, not here. Confirm Phase 0 stays `string[]`.
