# Implementation Plan — ERLI provenance reuse (#1045)

> Allegro-provenance category/attribute mappings resolve for an ERLI destination
> with **zero re-authoring**. Part of epic #1005 · ADR-023 (borrows provenance).

## 1. Understand the task

**Goal.** A destination that *borrows* its taxonomy (ERLI — ships no
`CategoryBrowser`/`CategoryParametersReader`, consumes Allegro category/parameter
ids verbatim via `source:"allegro"`) must resolve **existing** PrestaShop→Allegro
category **and** attribute mappings, without the operator re-authoring rows keyed
to the ERLI connection.

**Layer.** CORE (listings resolution chain + mappings context) + a thin
Integration declaration (ERLI). No interface/FE work.

**Acceptance (from #1045).**
- An ERLI offer reuses an Allegro category mapping and emits `source:"allegro"`
  category/parameter ids correctly.
- No duplicate mapping rows required for ERLI.

**Explicit non-goals.**
- Source-connection-scoped lookup (multi-source-store disambiguation) — already a
  documented follow-up in `findBySourceCategory`; keep the existing oldest-wins+warn
  posture.
- FE mapping-editor changes.
- Provisioning / shop (`open`) provenance (that's #1041).
- Changing the ERLI wire emission (already correct).

## 2. Research — current state (verified in code)

The publish path for an ERLI offer:
`OfferBuilderService.buildCreateOfferCommand`
→ `CategoryResolutionService.resolveCategory` (cat)
→ `AttributeProjectionService.project` (params)
→ `ErliOfferManagerAdapter.createOffer` (emit `source:"allegro"`).

What **already works**:
- `CategoryResolutionService.deriveProvenance` derives `owns|borrows` from adapter
  *capabilities*, never `platformType`. ERLI → `borrows`.
- `AttributeProjectionService` borrows branch passes source param ids/values through
  verbatim (name-keyed).
- `ErliOfferManagerAdapter.buildExternalCategories` / `buildExternalAttributes` emit
  `source:"allegro"` ids verbatim once a category + params are resolved.
- `category_mappings.destination_taxonomy_provenance` column exists (default `'allegro'`).

The **gap** (this issue):
- `CategoryResolutionService.tryCategoryMapping` → `MappingConfigService.resolveDestinationCategory(destinationConnectionId, sourceCategoryId)`
  → `CategoryMappingRepository.findBySourceCategory` queries
  `WHERE destination_connection_id = :dest AND source_category_id = :src`.
  For an ERLI destination this finds **only ERLI-authored rows**; Allegro-authored
  rows (`destination_connection_id = <allegro conn>`) are unreachable → reuse fails.
- `AttributeProjectionService.project` looks up `findByDestinationConnection(ERLI)` —
  same gap. **`attribute_mappings` has no provenance column** (asymmetry vs categories).
- `deriveProvenance` returns the *kind* (`borrows`) but not **which** taxonomy is
  borrowed; the value `'allegro'` lives only implicitly in ERLI's wire types.
- `CategoryResolutionResult.provenance` is `null` on the mapping path (code comment:
  "the mapping-path provenance lands with #1045").

## 3. Design — DECIDED (Design A; tech-reviewed 2026-06-26)

**Design A — provenance-keyed reuse fallback (ADR-023 §83 literal).** Chosen and
hardened per `/tech-review`. **Design B (connection-config "borrows-from" pointer)
rejected**: it contradicts the already-shipped `CategoryMapping` entity docstring
(*"`destinationTaxonomyProvenance` — the owner-taxonomy identifier (e.g. `'allegro'`)
a borrowed-taxonomy destination (ERLI) resolves against"*) and ADR-023 §83, adds an
operator-config burden, and is a strictly larger change. Design C (validation-only)
is impossible — reuse provably does not work today; a wiring change is required.

**Decided sub-questions:**
- **Capability, not a hardcoded default.** A bare "borrows ⇒ `'allegro'`" in core
  would bake "the only borrow target is Allegro" into core listings — a latent
  coupling. A minimal capability avoids it and future-proofs a second borrowing
  marketplace.
- **Attributes are in scope.** Category-only leaves "parameter ids reused" half-met
  and forces operators to re-author attribute mappings for ERLI — contradicting "no
  duplicate mapping rows." The attribute path is *already* source-scoped
  (`attribute-projection.service.ts:126`), so attribute reuse-by-provenance is the
  **unambiguous** half; the category path carries the only real ambiguity (below).

**Type modeling (review IMPORTANT).** The owner-taxonomy identifier (`'allegro'`) is a
**distinct concept** from the existing `CategoryProvenance` union (`owns|borrows|open`).
Model it as its own `as const` union — `TaxonomyOwnerValues = ['allegro'] as const;
type TaxonomyOwner = (typeof TaxonomyOwnerValues)[number]` (engineering-standards §
"Union Types"). The `destination_taxonomy_provenance varchar(50)` column stays loose at
the DB layer, but the domain/capability contract is the typed union — never bare `string`.

**Capability seam.** `TaxonomyBorrower` (role-named, like `OfferCreator`): method
`getBorrowedTaxonomy(): TaxonomyOwner`, co-located guard `isTaxonomyBorrower`. ERLI
returns `'allegro'`.

**Ambiguity containment (review IMPORTANT).** The borrowed-taxonomy value AND the source
(master) connection id are computed **once in `OfferBuilderService`** (which already
resolves the destination adapter at `offer-builder.service.ts:114-115` and
`masterConnectionId` at `:99`) and threaded down — **no second adapter resolution inside
`CategoryResolutionService`** (review SUGGESTION). The category provenance-fallback is
scoped by `sourceConnectionId` when known (it always is here — the master connection),
collapsing the cross-destination-connection ambiguity; oldest-wins + `logger.warn` remain
only as the genuine-ambiguity backstop, consistent with the existing
`findBySourceCategory` posture.

## 4. Step-by-step plan (Design A)

1. **`TaxonomyOwner` union** — `libs/core/src/listings/.../category-resolution.types.ts`
   (or a sibling `*.types.ts`): `TaxonomyOwnerValues` + `TaxonomyOwner`. Export from the
   listings barrel. *AC:* type-only; consumed by steps 2-8.
2. **`TaxonomyBorrower` capability** — `libs/core/src/listings/domain/ports/capabilities/taxonomy-borrower.capability.ts`
   (interface `getBorrowedTaxonomy(): TaxonomyOwner` + co-located `isTaxonomyBorrower`
   guard); export from listings barrel. *AC:* guard narrows; unit test for the guard.
3. **ERLI adapter declares it** — `ErliOfferManagerAdapter implements … TaxonomyBorrower`,
   `getBorrowedTaxonomy() => 'allegro'`. *AC:* adapter spec asserts `'allegro'`.
4. **Category repo provenance lookup** — add `findBySourceCategoryByProvenance(provenance,
   sourceCategoryId, sourceConnectionId?)` to `CategoryMappingRepositoryPort` + repo impl
   (source-scoped when `sourceConnectionId` given; oldest-wins + warn backstop). *AC:* repo
   spec — source-scoped hit; cross-connection warn path.
5. **MappingConfigService** — `resolveDestinationCategory(dest, srcCat, opts?: {
   borrowedTaxonomy?: TaxonomyOwner; sourceConnectionId?: string })`: destination-keyed
   first (explicit ERLI override wins), then provenance fallback. *AC:* service spec
   (override wins; fallback hit; no-match).
6. **Attribute migration** — `apps/api/src/migrations/<synthetic-ts>-add-attribute-mapping-provenance.ts`
   adds `destination_taxonomy_provenance varchar(50) NOT NULL DEFAULT 'allegro'`;
   `up()`+`down()`; synthetic sequential prefix (current tail + 1 step, per
   `docs/migrations.md` rule 3); `migration:show` clean. Update `AttributeMappingOrmEntity`
   + `AttributeMapping` domain entity.
7. **Attribute repo + projection** — `findByProvenance(provenance)` on the attribute repo;
   `AttributeProjectionService.project` input gains optional `borrowedTaxonomy`, falls back
   to provenance-scoped mappings (still filtered by `sourceConnectionId` in
   `selectApplicableMappings` — unambiguous). *AC:* projection spec — Allegro-authored attr
   mapping reused for an ERLI destination with zero ERLI rows.
8. **CategoryResolutionService** — accept threaded `borrowedTaxonomy` + `sourceConnectionId`
   on `CategoryResolutionInput`; on the mapping path pass them through; set
   `result.provenance` on the mapping path (closes the documented `#1045` TODO). No new
   adapter resolution. *AC:* service spec (mapping-path provenance populated; reuse hit).
9. **OfferBuilderService** — compute `borrowedTaxonomy` once from the already-resolved
   destination adapter via `isTaxonomyBorrower`, thread it + `masterConnectionId` into the
   category-resolve and attribute-projection inputs. *AC:* builder spec — ERLI cmd carries
   reused category + `source:"allegro"` params.
10. **Integration test** — `apps/api/test/integration/erli/erli-provenance-reuse.int-spec.ts`:
    author Allegro-destination cat+attr mappings only → assert **zero** rows with
    `destination_connection_id = <erli>` exist → build an ERLI offer → assert `createOffer`
    body carries `externalCategories[source:"allegro"]` + `externalAttributes[source:"allegro"]`
    reused verbatim. Plus a unit test for the category multi-row warn/oldest-wins branch.
    *AC:* green.
11. **ADR addendum (required, ships with the code)** — addendum to ADR-023 documenting (a)
    the `TaxonomyBorrower` capability seam (plugin-contract impact) and (b) the
    cross-destination-connection fallback + source-scoping/tie-break semantics. Plus a
    `docs/architecture-overview.md` Listings note and resolution of the in-code `#1045`
    TODO comments.

## 5. Validate
- **Architecture:** capability-driven (no `platformType`); core stays neutral; ERLI
  declaration lives in the plugin. Repo throws domain errors; provenance is a stored
  neutral string.
- **Naming:** `*.capability.ts` + `is*` guard; migration timestamped per `docs/migrations.md`.
- **Testing:** unit (guard, repos, services, builder) + one int-spec vertical slice.
- **Security:** no new external input; admin-config surface unchanged.
- **Risk:** light overlap with PR #1236 on `erli-offer-manager.adapter.ts` (adds an
  `implements` + one method) — rebase-friendly.
