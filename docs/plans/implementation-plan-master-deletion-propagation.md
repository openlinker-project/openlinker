# Implementation Plan — Master-side product/variant deletion propagation (#1599)

**Issue:** [#1599](https://github.com/openlinker-project/openlinker/issues/1599) — `[BUG] CORE — master-side product/variant deletion never propagates beyond inventory_items.isStale`
**Branch:** `1599-master-variant-deletion-propagation`
**Date:** 2026-07-15
**Type:** CORE (Domain / Application / Infrastructure + migration) + thin Integration (adapter error translation)

---

## 1. Understand the task

When a product/variant is **deleted at the master** (any `ProductMaster`/`InventoryMaster`), the only signal OpenLinker records today is `inventory_items.isStale` (#1478) — confined to the inventory context. Consequences:

- **Zombie variants** — `product_variants` has no staleness marker; canonical variants of a deleted product live forever as valid rows.
- **Orders fail late & opaquely** — `OrderItemRefResolverService` resolves a deleted variant to a normal order line; it only fails downstream at the destination adapter (e.g. PS `validateOrder`), producing a perpetually-retried job with a misleading error.
- **No signal** — marking stale is a bare `UPDATE` + `logger.debug`; no domain event, nothing an operator can observe.
- **404 dead-end** — a master `getProduct()` 404 is not distinguished from a transient error; the permanent condition is retried forever.

**Goal:** make master-side deletion a first-class, master-agnostic signal in `libs/core` — mark stale in the products context, distinguish 404 from transient failure, guard order resolution early, and emit a domain event.

**Layer classification:** CORE (products + orders + inventory + events) with a **thin, mechanical Integration touch** (two adapters translate their platform 404 exception to one neutral core error at the port boundary — the standard error-conversion pattern, no domain logic).

**Explicit non-goals (per issue):**
- No UI / notification consumers of the new event (follow-ups) — this issue only guarantees the event *exists*.
- No row deletion — staleness is a **soft mark** (consistent with #1478); mappings + historical orders keep resolving.
- The dead-code/retry observation in `prestashop-order-processor-manager.adapter.ts:605-673` is out of scope (separate adapter finding).
- Staleness lives on **variants only** (see §3, Decision D1) — not a new `products.isStale` column.

---

## 2. Research — existing patterns to reuse

| Concern | Reference (reuse verbatim where possible) |
|---|---|
| Stale column + soft-mark | `inventory-item.orm-entity.ts:68` `@Column({ type: 'boolean', default: false }) isStale`; migration `1818000000007-add-inventory-item-is-stale.ts` |
| Bulk "mark stale except keep-set" | `inventory.repository.ts:133 markStaleExceptVariants` — NULL-safe `Brackets`, `.andWhere('isStale = false')` |
| Unconditional prune after sync write | `master-inventory-sync.service.ts:66-81` (collect `currentVariantIds`, prune) |
| Variant repo mappers | `product-variant.repository.ts` `toDomain:223` / `toOrmEntity:240`, `upsert`/`upsertMany` |
| Cross-context variant read | `IProductsService.getVariant` (`products.service.interface.ts:62`), consumed by orders resolver |
| Order resolution seam | `order-item-ref-resolver.service.ts` `tryResolve → {resolved:false, reason}` + `MissingOrderItemMappingError` |
| Status/outcome split (ADR-007) | `SyncJobHandlerResult { outcome: 'ok' \| 'business_failure' }` (`sync-job.types.ts:98-118`); example `invoicing-issue.handler.ts:59-94` |
| Domain event publish | `sync-job-bulk-retry.service.ts:54-68` — `publish(STREAM, {eventId, eventType, payloadJson, metadataJson, occurredAt, publishedAt})`; wire via `EventsModule` + `EVENT_PUBLISHER_TOKEN` (`sync.module.ts:12,59`) |
| Platform 404 exceptions | `PrestashopResourceNotFoundException` (PS `getResource` 404, client:650) / `WooCommerceResourceNotFoundException` (Woo 404, adapter:100) — both extend bare `Error`, no shared base |

**Key deltas from the #1478 template:**
- `product_variants` is an **interface** (structural), not a class — new fields go on the interface + repo mappers, no constructor.
- `staleAt` is **net-new** (inventory has only `isStale`).
- Products/inventory modules do **not** yet import `EventsModule` — event wiring is part of the work.

---

## 3. Design

### Data flow (after the change)

```
marketplace/shop deletes product
   │
   ├─ marketplace.product.sync job ──► MasterProductSyncService.syncFromMasterByExternalId
   │      ProductMaster.getProduct(id)
   │        ├─ 200 + getProductVariants → upsert (clears isStale) + markVariantsStaleExcept(currentIds)
   │        │        └─ if any marked → emit master.variant.stale
   │        └─ 404 → adapter throws neutral MasterProductNotFoundError
   │                 → markVariantsStaleExcept(productId, [])  (mark ALL stale)
   │                 → emit master.product.stale
   │                 → return { masterDeleted:true } → handler outcome:'business_failure' (NOT retried)
   │
   ├─ inventory sync ──► MasterInventorySyncService (unchanged prune) → emit master.variant.stale
   │
   └─ later, order arrives referencing the deleted variant
          OrderItemRefResolverService.resolve → getVariant → variant.isStale === true
             → throw StaleOrderItemError → tryResolve → {resolved:false, reason:"…deleted at master…"}
             (early, actionable — no opaque destination rejection)
```

### Decisions
- **D1 — variants-only staleness.** Every product has ≥1 variant (simple products get a deterministic synthetic variant), so "all variants of product P are stale" *is* the product-deleted signal. Avoids a second table/column. The 404 path marks all variants stale and emits `master.product.stale`.
- **D2 — adapter translates 404 at the port boundary.** Both adapters wrap `getProduct` to catch their own platform not-found and rethrow the neutral core `MasterProductNotFoundError`. Keeps platform strings out of core (ADR-boundary compliant) and the platform exception internal to the adapter. Only `getProduct` is wrapped — other methods and other catchers of the platform exception are untouched.
- **D3 — `getVariant`/`findById` do NOT filter stale.** The resolver must *see* the stale variant to raise the rich reason; filtering would degrade it to the generic `variant-missing`. (Contrast inventory's availability read, which filters — different use case.)
- **D4 — un-stale on reappearance is automatic** via `upsertMany`: `toOrmEntity` writes `isStale = variant.isStale ?? false`, `staleAt = variant.staleAt ?? null`; the sync-built domain variant has neither set → clears the flag.
- **D5 — dedicated `StaleOrderItemError`** (not overloading `MissingOrderItemMappingError`) — distinct name + message-rich; caught alongside the existing error in `tryResolve` so downstream handling is identical.

---

## 4. Step-by-step implementation

### A — Products-context staleness marker

1. **`libs/core/src/products/infrastructure/persistence/entities/product-variant.orm-entity.ts`** — add:
   ```ts
   @Column({ type: 'boolean', default: false })
   isStale!: boolean;

   @Column({ type: 'timestamp', nullable: true })
   staleAt!: Date | null;
   ```
2. **`libs/core/src/products/domain/entities/product-variant.entity.ts`** — add interface fields `isStale?: boolean;` and `staleAt?: Date | null;` (documented as master-deletion soft-mark).
3. **`product-variant.repository.ts`** —
   - `toDomain` (:223): `isStale: entity.isStale, staleAt: entity.staleAt`.
   - `toOrmEntity` (:240): `entity.isStale = variant.isStale ?? false; entity.staleAt = variant.staleAt ?? null;` (D4).
   - New method `markStaleExceptVariants(productId, keepVariantIds): Promise<string[]>`. **Do NOT clone inventory's nullable-`Brackets` query** (review IMPORTANT): `product_variants` is keyed by a non-null `id` PK, so no three-valued NULL handling is needed. Shape: `.update().set({ isStale: true, staleAt: () => 'NOW()' }).where('productId = :pid AND isStale = false')` + **only when `keepVariantIds` is non-empty** append `.andWhere('id NOT IN (:...keep)')` — an empty keep-set (the 404 whole-product path) marks every live row, and `id NOT IN ()` is invalid SQL. Use `.returning('id')` and narrow the raw result explicitly: `(result.raw as { id: string }[]).map((r) => r.id)` — **no `any`** (review IMPORTANT).
4. **`product-variant-repository.port.ts`** — add `markStaleExceptVariants(productId: string, keepVariantIds: readonly string[]): Promise<string[]>` with JSDoc.
5. **`products.service.interface.ts` + `products.service.ts`** — add `markVariantsStaleExcept(productId, keepVariantIds): Promise<string[]>` delegating to the repo.

### B — Neutral not-found + business-failure outcome

6. **New `libs/core/src/products/domain/exceptions/master-product-not-found.error.ts`** — `MasterProductNotFoundError extends Error` with `(productId, connectionId, cause?)`, `name` set, `captureStackTrace`. Export from `libs/core/src/products/index.ts`.
7. **Adapters translate (D2):**
   - `prestashop-product-master.adapter.ts` `getProduct` — wrap body; `catch (e) { if (e instanceof PrestashopResourceNotFoundException) throw new MasterProductNotFoundError(productId, this.connection.id, e); throw e; }`.
   - `woocommerce-product-master.adapter.ts` `getProduct` — same, catching `WooCommerceResourceNotFoundException`.
   - (Import `MasterProductNotFoundError` from `@openlinker/core/products` — integrations already depend on the core barrel.)
8. **`master-product-sync.service.ts` `syncFromMasterByExternalId`** —
   - Collect `currentVariantIds` from the master `variants`, call `productsService.markVariantsStaleExcept(internalProductId, currentVariantIds)` unconditionally after upsert; emit `master.variant.stale` if the returned id list is non-empty (§D).
   - Wrap `getProduct`/`getProductVariants` in try/catch: on `MasterProductNotFoundError`, call `markVariantsStaleExcept(internalProductId, [])`, emit `master.product.stale`, and return `{ internalProductId, variantsUpserted: 0, masterDeleted: true }` (do **not** rethrow). Transient errors rethrow unchanged.
   - Extend `MasterProductSyncResult` with `masterDeleted: boolean` (default `false` on the success path).
9. **`apps/worker/src/sync/handlers/master-product-sync.handler.ts`** — return `{ outcome: result.masterDeleted ? 'business_failure' : 'ok' }`. Transient throws still wrap in `SyncJobExecutionError` (retryable) unchanged.

### C — Order-item resolution guard

10. **New `libs/core/src/orders/domain/exceptions/stale-order-item.error.ts`** — `StaleOrderItemError extends Error(connectionId, productRef, internalVariantId)` with a message naming "variant deleted at the master".
11. **`order-item-ref-resolver.service.ts`** — after each `getVariant` (`offer`, `variant`, `sku` branches), `if (variant.isStale) throw new StaleOrderItemError(...)`. Add `|| error instanceof StaleOrderItemError` to the `tryResolve` catch so it maps to `{ resolved:false, productRef, reason: error.message }`.

### D — Event emission

12. **New `libs/core/src/products/domain/types/master-deletion-events.types.ts`** — `MASTER_DELETION_EVENT_STREAM = 'events.master.deletion'`, `MASTER_VARIANT_STALE_EVENT = 'master.variant.stale'`, `MASTER_PRODUCT_STALE_EVENT = 'master.product.stale'`, and a `MasterDeletionEventPayload { connectionId; internalProductId; variantIds: string[] }` type. Export from products barrel.
13. **`master-product-sync.service.ts`** — inject `EventPublisherPort` (`EVENT_PUBLISHER_TOKEN`); publish on both prune paths (variant prune + 404). Upgrade the prune `logger.debug` → `logger.warn`.
14. **`master-inventory-sync.service.ts`** — extend `InventoryService.pruneStaleVariants` to return `{ markedCount: number; variantIds: string[] }` (change `markStaleExceptVariants` in `inventory.repository.ts` to `.returning('productVariantId')`, narrow `result.raw` explicitly and **filter nulls** — product-level rows carry `productVariantId = NULL`; ripple through `inventory.service(.interface).ts` return type). This is a change to the barrel-exported `IInventoryService` (review IMPORTANT): update all consumers/mocks in the same PR — `master-inventory-sync.service.spec.ts:70` (`mockResolvedValue({ markedCount: 0, variantIds: [] })`), `inventory.service.spec.ts:182`, `inventory-stale-prune.int-spec.ts` (assert on `.markedCount`). Inject the publisher, emit `master.variant.stale` when ids are non-empty; upgrade the prune log `debug → warn`.

    > **Edge (review SUGGESTION):** `getProductVariants` is not translated to `MasterProductNotFoundError` — only `getProduct` is. Since `getProduct` is called first in the sync, a deleted product 404s there; a 404 surfacing only from `getProductVariants` stays a generic retryable error. Acceptable for MVP.
15. **Module wiring** — add `EventsModule` to `imports` and inject `EVENT_PUBLISHER_TOKEN` in `products.module.ts` and `inventory.module.ts` (mirror `sync.module.ts`).

### Migration

16. `pnpm --filter @openlinker/api migration:generate -- src/migrations/AddProductVariantIsStale` (or hand-author a `18180000000NN-...` sequential-prefix migration per `docs/migrations.md`) adding `isStale boolean NOT NULL DEFAULT false` + `staleAt timestamp NULL` to `product_variants`. Verify `migration:show` reports no pending drift.

### Cross-cutting (review IMPORTANT)

- **File headers** — every new `.ts` (both exception classes, `master-deletion-events.types.ts`) gets the JSDoc header block per engineering-standards §File Headers.

### Tests (unit — colocated `*.spec.ts`)

- `product-variant.repository.spec` — `markStaleExceptVariants` marks the absent set, keeps the keep-set, returns ids; **empty keep-set marks every live row** (the 404 whole-product branch); `toDomain`/`toOrmEntity` round-trip isStale/staleAt.
- **Products prune int-spec (review SUGGESTION)** — add `apps/api/test/integration/product-variant-stale-prune.int-spec.ts` mirroring `inventory-stale-prune.int-spec.ts` (real-Postgres `UPDATE ... RETURNING`, empty-keep branch).
- `master-product-sync.service.spec` — (a) prune marks absent variants + un-stales on reappearance; (b) 404 → all-stale + `masterDeleted:true` + `master.product.stale` published; (c) `master.variant.stale` published on partial prune.
- `master-product-sync.handler.spec` — `masterDeleted → business_failure`; transient error → throws (retryable).
- `order-item-ref-resolver.service.spec` — stale variant → `{resolved:false, reason}` for `offer`, `variant`, `sku` branches.
- `master-inventory-sync.service.spec` — event published when rows marked stale.
- Adapter specs (PS + Woo) — `getProduct` 404 → `MasterProductNotFoundError`.

---

## 5. Validate

- **Architecture:** all domain logic in `libs/core`; adapters only translate their own exception (no domain logic, no platform string in core). Cross-context reads (orders→products, inventory→products events) via barrels — `pnpm check:invariants` must pass. Event types live in the products context (owner of variant staleness); inventory already depends on products.
- **Naming:** `*.error.ts` exceptions, `*.types.ts` for event constants, `markVariantsStaleExcept` mirrors `pruneStaleVariants`.
- **Security:** no new external input surface; event payloads carry only internal ids.
- **Migration:** required (schema change), `migration:show` clean gate.
- **Testing:** unit-first; the concurrency/real-DB angle of the stale marking is covered by the existing #1478 inventory pattern — no new integration test strictly required, but a products int-spec may be added if time permits.

## Risks / open questions

- **PR size.** Touches 4 core contexts + 2 adapters + worker + migration. Recommendation: **one cohesive PR** (A+B+C+D) — shipping A+B alone leaves the headline symptom (orders resolving deleted variants) unfixed. Fallback split available per the issue if review prefers.
- **Double-emission** — product sync and inventory sync each emit on their own prune for the same deletion. Accepted: distinct context signals; consumers dedupe. Documented in the event type JSDoc.
- **Inventory return-shape change** — `pruneStaleVariants` gains a variant-id list; single caller, low blast radius.
