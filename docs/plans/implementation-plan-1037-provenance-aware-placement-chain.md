# Implementation Plan — #1037 Provenance-aware placement chain

**Issue:** #1037 · **Epic:** #1005 · **ADR-023 §1** · **Branch:** `1037-provenance-aware-placement-chain`

---

## Phase 1 — Understand

**Goal.** Generalise `CategoryResolutionService` from a 2-step Allegro-named chain into a capability-gated, **provenance-aware** chain returning a neutral `{ destinationCategoryId, provenance, method }`, with the ADR-023 §1 ordering: **provision → barcode → per-source-category mapping → manual**.

**Layer.** CORE (`listings` application service) + a small additive method on the `mappings` context's service interface. Backend only.

**AC (from the issue).**
- Allegro (owns) + a borrows-provenance destination both resolve via the **same** chain.
- The provision step is a **no-op** when the destination lacks `CategoryProvisioner`.

**Non-goals.**
- `CategoryProvisioner` capability/guard/command — that's **#1041** (ADR-024). #1037 leaves a capability-gated no-op seam.
- Provenance-keyed cross-connection mapping reuse (ERLI resolving Allegro's *rows*) — that's **#1045**. #1037 makes the chain provenance-*aware*; #1045 makes the mapping *lookup* provenance-keyed.
- Attribute projection — **#1038/#1039**.
- Neutralising the HTTP wire field (`allegroCategoryId`) / surfacing `provenance` to the FE — deferred to **#1044** (API + FE surfaces). This PR keeps the wire contract byte-identical.
- The separate `EanMatchResult.allegroCategoryId` batch-match type + its allegro util + FE bulk types + mappings DTOs — unrelated to `CategoryResolutionResult`; untouched.

---

## Phase 2 — Research (what already ships)

- `CategoryResolutionService` (`libs/core/src/listings/application/services/category-resolution.service.ts`): 2-step chain (barcode → mapping → manual), returns `{ allegroCategoryId, method }`. Resolves the `OfferManager` adapter via `IIntegrationsService.getCapabilityAdapter`, gates barcode on `isCategoryBarcodeMatcher`, calls `IMappingConfigService.resolveDestinationCategory(connectionId, sourceCategoryId)` (returns `string | null` — **no provenance**).
- Types (`category-resolution.types.ts`): `CategoryResolutionMethodValues = ['auto_detect','category_mapping','manual']`; `CategoryResolutionResult.allegroCategoryId`. Exported via the `@openlinker/core/listings` barrel.
- **Consumers of `CategoryResolutionResult` (the only ones):** `offer-builder.service.ts:158` (`return result.allegroCategoryId`) and the HTTP boundary `listings.controller.ts:496` → `ResolveCategoryResponseDto.allegroCategoryId` (`resolve-category.dto.ts`). The DTO imports only `CategoryResolutionMethodValues`/`CategoryResolutionMethod`, not the result interface.
- Capability guards present: `isCategoryBrowser` (`category-browser.capability.ts`), `isCategoryParametersReader`, `isCategoryBarcodeMatcher`, `isEanCategoryMatcher`. **`CategoryProvisioner` is absent** (no file; not in `CoreCapabilityValues`).
- Mappings context (post-#1036): `CategoryMapping.destinationTaxonomyProvenance: string`; `CategoryMappingRepositoryPort.findBySourceCategory(destinationConnectionId, sourceCategoryId): Promise<CategoryMapping | null>` (carries provenance); `IMappingConfigService.resolveDestinationCategory` flattens it to the id.

---

## Phase 3 — Design

### D1 — `provenance` = capability-derived **relationship** union (ADR-literal)

`CategoryProvenance = 'owns' | 'borrows' | 'open'`, derived from the **destination adapter's capabilities** (never `platformType`):
- **`owns`** — adapter has `CategoryBrowser` (its own category tree): Allegro.
- **`open`** — adapter has `CategoryProvisioner`: shops. *(Not reachable in #1037 — the guard lands in #1041; the seam yields `open` then.)*
- **`borrows`** — neither (accepts ids, ships no tree): ERLI.

This is what attribute projection (#1039) needs: `borrows` → emit source ids verbatim; `owns` → resolve against the destination's own dictionary. The owner-id string (`'allegro'`) is already carried by the mapping rows + the ids themselves; the *relationship* is the missing axis, so that's what the result adds.

### D2 — derive provenance on the barcode path; preserve laziness + resilience (zero behaviour change)

*Corrected during implementation against the existing specs* — two encode behaviour I must keep: (1) `getCapabilityAdapter` is **not** called when no `barcode` is supplied (laziness + perf); (2) an adapter-resolution failure is **caught** and falls through to mapping (resilience). So the chain must **not** resolve the adapter eagerly at the top.

Instead: `provenance: CategoryProvenance | null`, derived from the destination adapter **on the barcode path** — i.e. wherever the adapter is already resolved (inside the existing `tryAutoDetect` try/catch). When the adapter resolves successfully, capture it and set `provenance`:
- **`owns`** — `isCategoryBrowser(adapter) || isCategoryParametersReader(adapter)` (ADR-023: owns = "own category tree + per-category parameter schema").
- **`open`** — `CategoryProvisioner` present (deferred to #1041 — unreachable in #1037).
- **`borrows`** — otherwise.

When no `barcode` is supplied (no adapter resolved), or adapter resolution throws (graceful fallback), or the result is manual without an adapter → `provenance: null`.

**Why this still meets the AC:** the real offer-creation flow (`offer-builder.service.ts`) always calls `resolveCategory` **with** a barcode, so both `owns` (Allegro) and `borrows` (ERLI-class) get a populated `provenance`. The mapping-only path (wizard, no barcode) reports `provenance: null` until **#1045** makes the mapping *lookup* provenance-bearing — that's exactly #1045's scope ("Allegro-provenance mappings resolve for ERLI"). The chain is shared + capability-gated for both provenances now; population on the mapping-only path is #1045. **No new adapter resolution, same resilience, same "manual is 200" contract → existing service/controller specs stay green unmodified (bar the field rename).**

### D3 — keep the HTTP/FE wire contract byte-identical (backend-only PR)

`ResolveCategoryResponseDto` keeps `allegroCategoryId` + the existing `method` values. The controller maps the neutral result at the boundary (`allegroCategoryId: result.destinationCategoryId`). `provenance` is **not** surfaced yet (no consumer). Wire-neutralisation + provenance exposure is #1044's job. → no FE churn, no contract break.

### D4 — `method`: add `'provision'`, keep the rest

`CategoryResolutionMethodValues = ['provision','auto_detect','category_mapping','manual']`. `auto_detect`/`category_mapping` are already neutral step descriptors (not Allegro-named) and are on the wire — keep them. Add `'provision'` for the new step.

### D5 — provision step = capability-gated no-op seam

A private `tryProvision(adapter)` that returns `null` today, with a header comment marking it the **#1041** wiring point (`isCategoryProvisioner` + `provisionCategory`). The chain calls it first; it always falls through now. AC "no-op when the destination lacks CategoryProvisioner" holds trivially (nothing implements it yet) and is asserted by a unit test.

### D6 — (dropped) no `mappings`-context change

*Resolved by the tech-review:* with D2 deriving `provenance` from the destination adapter's capabilities (not the mapping row), there is **no consumer** in #1037 for a provenance-returning mapping lookup. The mapping step keeps calling the existing `IMappingConfigService.resolveDestinationCategory` (id only). The provenance-keyed mapping lookup is **#1045's** job. #1037 stays a pure `listings`-context change — no `mappings` edit.

---

## Phase 4 — Step-by-step

1. **`category-resolution.types.ts`** — add `CategoryProvenanceValues = ['owns','borrows','open'] as const` + `CategoryProvenance`; add `'provision'` to `CategoryResolutionMethodValues`; rename `CategoryResolutionResult.allegroCategoryId` → `destinationCategoryId`; add `provenance: CategoryProvenance | null`. Update the file header. AC: type-check; barrel re-exports cleanly.
2. **`category-resolution.service.ts`** — neutralise: chain provision (no-op seam) → barcode → mapping → manual; derive `provenance` on the barcode path from the resolved adapter (`isCategoryBrowser(a) || isCategoryParametersReader(a)` → `owns`, else `borrows`; `open` deferred to #1041); `null` when no adapter resolved (no barcode / fallback / manual). Return `{ destinationCategoryId, provenance, method }`. Neutral logging + header (drop "Allegro"/"3-step"). Preserve laziness (no adapter call without barcode) + resilience (catch adapter failure → mapping). AC: existing spec semantics hold + new provenance/provision assertions.
3. **`offer-builder.service.ts:158`** — `result.allegroCategoryId` → `result.destinationCategoryId`. AC: offer-builder spec green.
4. **`listings.controller.ts:496`** — `allegroCategoryId: result.destinationCategoryId` (wire field + `method` unchanged; `provenance` not surfaced). AC: controller spec green; response shape identical.
5. **Tests** — update both spec files (`category-resolution.service.spec.ts` + `__tests__/category-resolution.service.spec.ts`; not identical — keep both, field-rename through) for `destinationCategoryId` + add `provenance` to expectations (`null` on the existing barcode-mock paths since the mock adapters lack `CategoryBrowser`/`CategoryParametersReader` → wait: barcode-resolved mock has no browser → `borrows`). Add new cases: provenance `owns` when adapter has `CategoryBrowser`/`CategoryParametersReader`, `borrows` when only `matchCategoryByBarcode`, `null` on no-barcode + manual paths, provision no-ops. Update `offer-builder` + `listings.controller` specs for the renamed field.
7. **Quality gate**: `pnpm lint && type-check && test`; full `pnpm test:integration` for the listings slice (`listings-create-offer`, resolve-category routes); `migration:show` (expect none — no schema change).

---

## Phase 5 — Validate / risks / open questions

- **Risk: barrel contract change on `CategoryResolutionResult`.** Contained — only core (offer-builder) + the DTO (method-only import) consume it; both updated in-PR. No external/plugin consumer.
- **Risk: behaviour drift on the resolve-category route.** None — D2 preserves laziness + resilience; no new adapter resolution on any path. The existing controller/service specs are the oracle (only the renamed field changes).
- **No migration** — pure code generalisation; the #1036 schema already carries provenance.
- **Q1 — RESOLVED (tech-review):** no `IMappingConfigService` change in #1037 (D6 dropped); provenance comes from the adapter. Provenance-keyed mapping lookup → #1045.
- **Q2 — RESOLVED:** `provenance` is the relationship union `owns/borrows/open` (D1) — ADR-literal, what attribute projection consumes.
