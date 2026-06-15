# Implementation Plan — Neutralise category-mapping stack + source/dest/provenance scoping (#1036)

**Issue:** #1036 (epic #1005, ADR-023 §2 + §Storage + §Contract surface) · **Layer:** CORE (mappings) + Infra (migration) + Interface (API DTOs) [+ FE] · **Size:** L

## 1. Understand

Generalise the Allegro-named category-mapping vertical so it's source/destination-neutral and multi-store-correct, and add the **taxonomy-provenance** axis (so a borrowed-taxonomy destination like ERLI reuses Allegro mappings). Unblocked by #1034 (source categories now persisted) + #1035 (merged).

**Non-goals:** the placement chain (#1037), attribute projection (#1038), shop capabilities (#1041+). The `EanMatchResult.allegroCategoryId` barcode-capability type is a *separate* Allegro contract — out of scope here.

## 2. Blast radius (Explore audit — 49 files)

- **Core `mappings`** (9): entity, ORM entity, repo port + impl, `IMappingConfigService` (+impl), `mapping.types.ts` (`CategoryMappingInput`), barrel, spec.
- **Core `listings`** (6): `CategoryResolutionResult.allegroCategoryId`, resolution service (+specs), `offer-builder.service.ts` reads `result.allegroCategoryId`.
- **API** (5): `mappings.controller.ts` (routes `categories/:prestashopCategoryId`), `category-mapping-input.dto.ts`, `category-mapping-response.dto.ts`, migration, specs.
- **FE `apps/web`** (10): `features/mappings` types/api/hooks/3 components, `connection-category-mappings-page.tsx`, test-utils.
- **Not in scope** (separate Allegro capability type, leave as-is): `EanMatchResult.allegroCategoryId`, `resolve-categories-for-batch-by-ean.ts`, Allegro offer-manager adapter.

Contract surface: `CategoryMapping`, `CategoryMappingInput`, `IMappingConfigService` exported from `@openlinker/core/mappings`; `CategoryResolutionResult` from `@openlinker/core/listings`. No cross-context ALLOW_LIST entries reference these.

## 3. The two real design decisions

**D1 — How far does the rename go (HTTP + FE) vs. core-only?**
Renaming the HTTP DTO fields/routes forces the whole FE mappings feature to change in lockstep. Two options:
- **A (recommended) — Core + DB neutral; HTTP/FE deferred.** Neutralise the domain/core + DB; keep the HTTP DTO field names + routes on the current wire shape, mapped to neutral core names *inside the DTO/controller* (the DTO is exactly the mapping seam). FE untouched. Follow-up issue neutralises the HTTP contract + FE + threads source-connection as an explicit API input.
- **B — Full neutralisation in one PR** (core + DB + DTO + routes + FE mappings feature). Atomic, matches ADR verbatim, but ~35–40 files and a much larger review touching BE+FE+migration together.

**D2 — Source-connection threading.** `source_connection_id` is meaningful only once create captures it and resolution filters on it. Today `upsertCategoryMapping(destinationConnectionId, sourceCategoryId)` and `resolveCategory(connectionId=destination, sourceCategoryIds)` carry **no source connection**. v1 recommendation: **record** `source_connection_id` (backfilled to the single PS connection; nullable for unknown) but keep resolution keyed on `(destination_connection, source_category)` — full source-scoped create/resolve is a follow-up that needs the source connection plumbed through both paths. Schema is multi-store-ready; behaviour is unchanged for the single-source reality today.

## 4. Recommended scope (Option A + D2-record-only)

### 4.1 Core (neutralise)
- `CategoryMapping` entity: `prestashopCategoryId→sourceCategoryId`, `allegroCategory*→destinationCategory*`; add `sourceConnectionId: string | null`, `destinationConnectionId: string`, `destinationTaxonomyProvenance: string`. (`connectionId` becomes `destinationConnectionId`.)
- `CategoryMappingInput` (`mapping.types.ts`): neutral fields + optional `sourceConnectionId`, `destinationTaxonomyProvenance` (default `'allegro'`).
- `CategoryMappingRepositoryPort`: `findByPrestashopCategoryId → findBySourceCategory(destinationConnectionId, sourceCategoryId)`; `deleteMapping(destinationConnectionId, sourceCategoryId)`; `findByConnectionId → findByDestinationConnection`.
  - **Deterministic lookup (tech-review IMPORTANT #2):** the new schema permits >1 row for `(destination, source_category)` across source stores, so `findBySourceCategory` must order deterministically (`createdAt ASC, id ASC`) and log a `warn` when >1 row matches — never a bare `findOne` that silently picks one.
- `IMappingConfigService`: `resolveAllegroCategory → resolveDestinationCategory(destinationConnectionId, sourceCategoryId)`; neutral param names on get/upsert/delete.
- **NOT renamed (tech-review IMPORTANT #1):** `CategoryResolutionResult.allegroCategoryId` stays as-is — it's HTTP-exposed via `/categories/resolve` and FE-consumed, so renaming it would break Option A's "FE untouched." `category-resolution.service.ts` + `offer-builder.service.ts` stay untouched. Folded into the FE follow-up.

### 4.2 DB (migration + backfill) — the meaty part
- Rename 4 columns + `connection_id → destination_connection_id`.
- Add `source_connection_id uuid NULL`, `destination_taxonomy_provenance varchar(50) NOT NULL DEFAULT 'allegro'`.
- Backfill: `destination_taxonomy_provenance='allegro'` (default); `source_connection_id` ← the lone `connections` row with `platform_type='prestashop'` **iff exactly one exists**, else `NULL`.
- Drop unique `(connection_id, prestashop_category_id)`; add **two partial unique indexes** (Postgres NULL-distinct, per the `product_content_field`/`prompt_templates` precedent): one `WHERE source_connection_id IS NOT NULL` over `(source_connection_id, destination_connection_id, source_category_id)`, one `WHERE source_connection_id IS NULL` over `(destination_connection_id, source_category_id)`.
- Synthetic sequential timestamp = current tail + 1 step; `down()` reverses.

### 4.3 API (compat shim — no FE change)
- DTOs keep wire field names (`prestashopCategoryId`/`allegroCategory*`) + routes (`categories/:prestashopCategoryId`); `fromDomain` reads the neutral entity fields, `upsert` maps wire→neutral `CategoryMappingInput`. Documented as a temporary shim with a `// TODO(#NNNN) neutralise HTTP contract + FE`.

### 4.4 Tests
- Update core specs (mapping-config; the `resolveAllegroCategory` mock rename ripples to category-resolution + order-sync specs) to neutral names. `offer-builder.service.spec` is untouched (result field not renamed).
- Unit coverage for repo `findBySourceCategory` (incl. the >1-row deterministic-order + warn path) and upsert.
- **In scope (tech-review IMPORTANT #3):** a migration/repo int-spec covering the backfill heuristic branches (0 / 1 / >1 PrestaShop connections) and that both partial unique indexes enforce as intended (NULL-distinct). Not a stretch goal.

## 5. Validate
- `pnpm lint` (check:invariants — cross-context, service-interface, migration-timestamps/ordering), `pnpm type-check`, `pnpm test`, `pnpm --filter @openlinker/api migration:show`, `pnpm test:integration` (mappings + offer-creation slices) before PR.
- Architecture: domain stays framework-free; mapping shim lives in the DTO (interface layer); no new cross-context leakage.

## Open question for the user
Scope **A (core+DB, FE deferred)** vs **B (full incl. FE)**; and confirm **D2 record-only** source-connection for v1.
