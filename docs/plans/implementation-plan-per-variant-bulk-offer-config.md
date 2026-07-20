# Implementation Plan - Per-variant configuration in the Bulk offer creation wizard (#1741)

## 1. Goal & classification

Let operators configure **each variant independently** in the bulk offer-creation wizard: own weight / dimensions / category parameters / EAN / images / price / title / description, plus include/exclude per variant. Today the wizard emits one product-level override that the backend applies to every sibling (only stock is per-variant, #823/#824).

- **Layers**: Frontend (wizard) + CORE (application submit service + offer-creation payload + `OfferBuilderService` EAN threading) + transport DTOs. `OfferBuilderService` is a **core application service** (`libs/core/src/listings/application/services/offer-builder.service.ts`), NOT an integration - the EAN change is a core-domain-type + core-service change, no CORE↔Integration boundary crossing.
- **Non-goals**: no DB migration; no change to the worker execution/progress state machine (#737); no change to Allegro auto-grouping (#824); currency stays batch-wide; **no image-upload backend** - per-variant images = choosing/removing/reordering the master's existing image URLs, not uploading new files.

## 2. Central architectural decision (resolve first - the analyses flagged this)

**The FE must expand siblings client-side and resolve each variant; the BE stays the single fan-out source but honors the FE's per-variant data + exclusions.**

- Today the FE only ever sees the **primary** variant: `seedRow` picks `product.variants?.[0]` (`bulk-wizard.tsx:469`); Resolve sends only `primaryVariant.id` to `resolveCategoriesBatch` + availability (`bulk-resolve-step.tsx:109-134`). Products arrive already hydrated with `variants` (`bulk-wizard.tsx:45`), so client-side expansion is feasible.
- **Submission model**: FE sends `productIds` (selected primary ids, unchanged) + `perVariantOverrides` (keyed by actual variant id) + `excludedVariantIds`. BE `expandVariantJobs` remains the fan-out; it (a) skips excluded siblings, (b) honors an **overridden EAN** in the barcode gate so a barcode-less sibling the operator rescues is no longer silently dropped, (c) does not strip a per-variant `productCardId` the operator explicitly picked. This keeps one fan-out source of truth while letting the FE drive the exact set.

## 3. Backend contract (land + test FIRST - it couples the FE half)

### 3.1 Transport additions
- `libs/core/src/listings/application/types/bulk-listing-submit.types.ts` - on `BulkListingSubmitInput`: `perVariantOverrides?: Record<string, PerProductOverride>` (keyed by **actual variant id**), `excludedVariantIds?: string[]`.
- `apps/api/src/listings/http/dto/bulk-offer-create.dto.ts` - mirror both (`@IsObject` map like existing `perProductOverrides`; `@IsArray @IsString({each:true}) @IsOptional` for excludes).
- `apps/web/src/features/listings/api/bulk-listings.types.ts` - mirror both on `BulkOfferCreateRequest`.
- Controller passes both through into `BulkListingSubmitInput` (no logic).

### 3.2 Per-variant EAN override (new field on the offer contract)
- Add optional `ean?: string` (and/or `gtin`) to `CreateOfferOverrides` (`libs/core/src/listings/.../offer-create.types.ts:68-117`) + `CreateOfferOverridesDto` + FE `BulkOfferOverrides`.
- `expandVariantJobs` barcode gate (`bulk-listing-submit.service.ts:276-282`): a sibling with no entity barcode but an overridden EAN in `perVariantOverrides[sibling.id].overrides.ean` is **kept**, not skipped.
- Core `OfferBuilderService` (`offer-builder.service.ts`) must thread the override EAN at **both** barcode sites: the `variantBarcode` self-link (`:242`) **and** `resolveCategory(..., variant.ean ?? variant.gtin, ...)` / EanCategoryMatcher (`:130-135`) - else a rescued barcode-less sibling hits category resolution with `null` and fails for owns-taxonomy destinations (`requiresResolvedCategory`).

### 3.3 `BulkListingSubmitService` (`bulk-listing-submit.service.ts`)
- `expandVariantJobs`: skip `excludedVariantIds`; never skip the explicitly-selected id unless excluded; `totalCount` reflects post-exclusion fan-out; honor override EAN in the barcode gate (§3.2).
- `buildEnqueueInput`: override precedence **base `sharedConfig` → `perProductOverrides[job.selectedId]` (family) → `perVariantOverrides[job.variantId]` (variant wins)**, field-by-field. Extend `mergeOverrides` to a 3-way merge; `platformParams` deep-merged across all three (**must preserve `platformParams.deliveryPolicyId` - #808 regression**).
- **`clearProductCard` reconciliation**: only strip `productCardId` for an expanded sibling when the per-variant override did **not** explicitly set one (multi-match candidate pick, `bulk-edit-modal` sets `productCardId`). Run the strip *before* layering the per-variant override, or guard it on `perVariantOverrides[variantId]?.overrides?.productCardId === undefined`.
- Master stock stays authoritative (incl. 0) for expanded siblings; per-variant `stock`/`price` override still wins for passthrough/single-variant.
- Absent new fields ⇒ byte-identical to current behaviour.

### 3.4 Tests (`__tests__/bulk-listing-submit.service.spec.ts`)
- per-variant override wins over family + base; family layer still applies; `platformParams.deliveryPolicyId` preserved through 3-way merge (#808 guard).
- exclusion drops a sibling and adjusts `totalCount`.
- override EAN rescues a barcode-less sibling (not skipped); worker builder prefers override EAN.
- explicit per-variant `productCardId` survives `clearProductCard`.
- single-variant passthrough unchanged; unknown variant keys are no-ops.
- **retry-rebuild** carries per-variant overrides (the per-record `request` snapshot bakes the merged input) - add a case so #742 retry stays correct.

## 4. Frontend (`apps/web/src/features/listings/`)

### 4.1 Row model (`bulk-wizard.types.ts`)
- `BulkWizardRow` gains `variants: BulkVariantRow[]`; each `BulkVariantRow` = `{ variantId, ean, distinguishingAttributes, masterStock, masterPrice, masterCurrency, included: boolean, blockers: string[], resolvedCategoryId, resolvedProductCardId, categoryCandidates, override: BulkPerProductOverride, editFormValues? }`. Base/shared stays on the row (`override` = base defaults). Category stays product-level.

### 4.2 Resolve step (`bulk-resolve-step.tsx`, `bulk-policy.ts`)
- **Fan out to ALL sibling variant ids** (not just primary): `resolveCategoriesBatch` + availability per sibling; compute blockers **per variant** (`no-ean`/`no-match`/`multi-match` per sibling by its own EAN; `no-master-price`/`no-master-stock`/`currency-mismatch` per variant; platform blockers per variant).
- **Param-schema fan-out**: `useBulkRequiredProductParams` (`selectBulkProductCardId` / `computeNeedsProductParameters` in `bulk-policy.ts:173-177,304-313`) must resolve **each sibling's** card + category param schema so `allegro:needs-product-parameters` is computed per variant - expanded no-card siblings otherwise 422 silently.
- Category resolution (tree + multi-match candidate) reachable here; product-level.

### 4.3 Review step (`bulk-review-step.tsx`)
- Expandable product rows → per-variant sub-rows. Per-variant status = the **exact** chips from `NEUTRAL_BLOCKER_CHIPS` + plugin `platformBlockerChips`, labels+tones verbatim, **multiple per variant**, each clickable → its fix. Chip set: `no-variant` (neutral), `no-ean` (err), `no-match`="manual category" (err), `multi-match`="choose category" (warn), `no-master-price`/`no-master-stock` (err), `currency-mismatch` (warn), `allegro:needs-product-parameters`="add product params" (warn), `erli:missing-image`="add image" (err).
- **Blocker-fix routing.** `no-ean` / `no-match` open the **editor** on that variant (both fixes live there: **correct the per-variant EAN** - a typo/wrong EAN is the common cause, and a corrected valid+unique EAN re-resolves and clears the blocker - OR pick a product-level category manually via the chip). `multi-match` opens the candidate picker. Param/price/stock blockers open the editor. `already-listed` is informational (exclude to avoid a duplicate). The banner for `no-ean`/`no-match` offers both "Correct EAN" and "Choose category" so the operator isn't forced into a manual category when the real fix is the EAN.
- Per-variant include/**exclude** checkbox → `excludedVariantIds`; excluded don't block and aren't submitted; Allegro groups the rest. Aggregate product-row status ("2 ready · 1 attention"). Summary strip (ready/attention/excluded) kept.
- Gate `canApprove = includedReady > 0 && includedNeedsAttention === 0 && !paramsResolving` - **preserve the `!paramsResolving` gate** (`bulk-review-step.tsx:139`), now spanning every sibling category.
- **Edit** opens the editor focused on the flagged variant.
- All four async states: loading (resolve spinner), error (+Retry), empty (+CTA), data.

### 4.4 Editor (`bulk-edit-modal.tsx` → redesigned; add sub-components)
- Wide two-pane modal (960px; full-screen <640px). Desktop = variant rail + form; mobile = accordion (one open). "Save all" (whole product), not per-row "Save row".
- "Shared base" panel = all defaults + full Allegro category-parameter block via the platform `bulkOfferRowSection` rendered **per scope** (Required: Stan/Marka/Kod producenta; Optional collapsible: Waga/EAN GTIN/Stan opakowania/Kod taryfy celnej; dependent/filtered params show "Filtered by parent … N of M available").
- Per-variant panel: inherit-all-from-base. Field states: **inherited** (ghosted, placeholder = base default) / **overridden** (bold + reset-to-base); typing/selecting promotes to override; clearing a text override → back to inherited; selects stay override until reset. **Provenance badges**: from master / inherited / overridden / distinguishing / policy (markup·flat·cap). Progressive disclosure "override more base fields" for rarely-touched base fields.
- Per-variant: EAN (from master, editable → §3.2), distinguishing param (Rozmiar, read-only from master), stock (from master, authoritative), price, images (choose/remove/reorder master URLs, inherit base set, reset-to-base - backed by `BulkOfferOverrides.imageUrls`), **per-variant `publishImmediately`** (preserve today's per-row capability), category params.
- Category shown as settled chip + "change ↱" back to Resolve; multi-match candidate picker sets a per-variant `productCardId` (must survive §3.3 clearProductCard).
- AI suggest (`SuggestionDialog`) on base description: tone chips + regenerate + apply-to-base; one shared description unless a variant overrides it. **Parametrize `channel` via `usePlatform`** - not the hardcoded `channel="allegro"` (`bulk-edit-modal.tsx:541`).
- **Parametrize the title max-length / "Allegro limit"** copy (`:306,311`) via the platform slot - shared Allegro+Erli shell.

### 4.5 Submit assembly (`bulk-wizard.tsx`)
- Build `perVariantOverrides[variantId]` from each variant's `override`; `excludedVariantIds` from unchecked variants; keep `perProductOverrides` for base/product-level bits.
- **Preserve permission/demo gating**: `useWriteAccess('listings:write', demoMode)` forcing `generateDescription`, `ReadOnlyLock`/`demoReadOnly` in Config + Confirm (`bulk-wizard.tsx:85,307`, `bulk-config-step.tsx:341-383`, `bulk-confirm-modal.tsx:107-115`).
- **Currency**: remove the per-row currency select (`bulk-edit-modal.tsx:424-432`); read-only batch-wide from Config - call this behaviour change out in the PR.

### 4.6 Confirm (`bulk-confirm-modal.tsx`)
- Count **included variants** (offers), not products: "N offers / M products / X excluded" + publish-immediately re-confirm + idempotency note. FE computes included-variant count (today `rowCount = readyCount` products, `bulk-wizard.tsx:336-338`).

### 4.7 Platform-slot rule
- All platform rendering via `usePlatform(platformType)` / capability guards (`CategoryBrowser` vs Erli `borrows` #1045) - no `platformType` literals. `bulkOfferConfigSection` stays batch-level; `bulkOfferRowSection` renders per-variant (and base). Erli: no product-section params, `erli:missing-image` gate must read the **effective per-variant `imageUrls`** override, not just `row.product.images` (`bulk-policy.ts:352-354`).

### 4.8 Tests
- Editor: inherit → override → reset; clear-to-inherit; per-variant image choose/remove; per-variant publish. Review: include/exclude gating + per-variant chips + `paramsResolving` gate. Submit: correct `perVariantOverrides` + `excludedVariantIds` payload; permission gating preserved. Resolve: sibling fan-out computes per-variant blockers.

### 4.9 Simple / single-variant products + product-level selection
- **Flat rendering.** A product whose fan-out is a single offer (a simple product's synthetic variant, or a product with exactly one real variant) renders **flat** in Review: no expand caret, no per-variant sub-rows, one status pill. `bulk-review-step.tsx` branches on `row.variants.length <= 1`.
- **Flat editor.** Editing a flat product opens the modal in a **simple mode**: no variant rail, no base/variant split, no inherit/override badges (there is nothing to inherit from). All fields edit directly (title, description + AI, images add/remove, price, stock, currency read-only, full category-param block, publish, category chip + change). Mobile = plain scroll (no accordion). Reuses the same field builders + platform `bulkOfferRowSection`, minus the inheritance layer.
- **Product-level include checkbox** in the lead column of every product row: multi-variant = **tri-state parent** (`checked`=all / `indeterminate`=some / `unchecked`=none) that toggles all variants and reflects child state; simple/flat = a single include/exclude toggle. The checkbox never triggers row expansion (the `data-toggle` guard already excludes `.chk`).
- **Submit / gating cascade.** Excluding a whole product adds all its offer variant ids to `excludedVariantIds`; the summary strip, Confirm count, and `canApprove` gate count included offers across **all** products (multi-variant + simple). Excluding every product ⇒ `canApprove` false + the BE empty-fan-out guard (§7 B3).
- **Transport note.** A simple product still submits its (single) primary/synthetic variant id in `productIds`; excluding it = putting that id in `excludedVariantIds` (which then hits the empty-fan-out guard if it was the only product).

## 5. Risks / open questions
- **Large FE churn** (review + edit modal + resolve + wizard state + policy). Mitigation: land+test the BE contract first, then FE against it; one PR.
- **EAN-on-contract widening** (§3.2) touches the worker builder - the only surface beyond FE+submit. Alternative if we want to keep v1 tight: EAN display-only from master (read-only), defer editable-EAN + barcode-less rescue to a follow-up. **Recommend doing it now** - it fixes the silent-skip bug the analysis found.
- Minor UI defaults (cheap to flip): Rozmiar read-only; summary strip kept; platform-slot border kept.

## 6. Validation
- Hexagonal: submit-service + `OfferBuilderService` changes are **core Application-layer**; DTO at Interface; `CreateOfferOverrides.ean` is a core domain type. No CORE↔Integration breach (the earlier draft wrongly placed the builder in the Allegro integration). FE respects feature-barrel + platform-slot rules. `pnpm lint && type-check && test`; `pnpm test:integration` for the submit-service slice.

## 7. Tech-review reconciliation (3 independent reviews: UX / backend / e-commerce)

### BLOCKING - resolved into the plan before coding
- **B1 (UX) Editor form-state model.** RHF `useForm` per **scope** (base + one active variant), driven off `row.override` / `variant.override`. Override-presence is tracked **explicitly** in the row model (a per-field `override` object holds only the keys the operator set), NOT via RHF `dirty` (an inherited field pre-filled with the base value is not "dirty" yet must render inherited). Switching scope in the rail **commits** the active form into `row.variants[i].override` (never discards). Add a colocated `bulk-edit-modal.schema.ts` (Zod) validating base + per-variant fields (price `{amount}`, EAN, required params).
- **B2 (UX) "Save all" persistence.** Rail switch = commit-to-local-row; "Save all" writes the whole product's base + per-variant overrides back to wizard state; "Cancel" discards the modal session. No silent loss.
- **B3 (backend) Empty fan-out zombie batch.** `submit` throws `EmptyBulkSubmissionException` when **post-exclusion** `expandedJobs.length === 0` (before persisting the batch). FE `canApprove` is false when a product has 0 included variants or the batch has 0 included variants.
- **B4 (e-commerce) Editable EAN safety.** Editor validates an overridden EAN as (a) a structurally valid GTIN (EAN-8/13 checksum) and (b) **unique within the variant group** (no two included siblings share an EAN → they'd collapse to one catalog card and lose the distinguishing axis). Invalid/duplicate = a field error + a per-variant blocker; not submittable.

### BLOCKING-adjacent correctness (treat as must-fix)
- **EAN edit forces re-resolve.** Changing a variant's EAN in the editor re-runs that sibling's category/card/blocker resolution (same escape-hatch semantics as "change category"), so Review status can't go stale-green while the worker links by the new EAN.

### IMPORTANT - folded in
- **`parameters` array merge.** `mergeOverrides` shallow-spreads; an array field (`parameters`) would wipe inherited params. Resolution: the **FE emits the full effective `parameters` array per variant** (base ∪ per-variant overrides, already how the single-offer editor serialises). Service keeps whole-array replace for `parameters`/`imageUrls`; deep-merge stays only for `platformParams`.
- **Guard grouping-breaking overrides.** `categoryId` is **stripped/forbidden** from `perVariantOverrides` (category is product-level - a per-variant category splits the Allegro group). `productCardId` per-variant is allowed **only** from the multi-match candidate picker and must be grouping-compatible (same category family); document that an arbitrary card breaks single-listing grouping.
- **DTO boundary validation.** Add a per-map nested validator (value-DTO transform) for `perVariantOverrides` values (currently `@IsObject`-only), and `@ArrayMaxSize(100)` on `excludedVariantIds`. Reject a per-variant `price.currency` that diverges from the batch currency.
- **Clickable chips = real `<button>`** with accessible name (e.g. "Fix: no EAN - Size M") + visible focus ring; not an `onClick` span.
- **Variant rail a11y.** Rail is a `tablist`/`radiogroup` with arrow-key nav + `aria-selected`/`aria-current`; mobile accordion uses disclosure semantics (`aria-expanded`, `<button>` headers). Opening from a chip focuses the flagged variant's first blocking field. Rail labels use the **distinguishing attribute value** ("Size: M"), never `variantId`/SKU.
- **Review IA.** Use `DataTable`'s single expandable **detail panel** per product row (aggregate status collapsed → per-variant sub-rows + chips expanded). **Single-variant products render flat with no expand affordance.**
- **Exclude edge-gating.** Excluding all variants of a product, or zero included batch-wide → `canApprove` false with explicit messaging. Handle "primary excluded, siblings kept" in Confirm/summary counts and fan-out.
- **Multi-sibling async fan-out UX.** Per-sibling resolve (category + availability + param-schema) multiplies queries; show resolve progress, handle per-sibling partial failure, keep the `!paramsResolving` gate spanning every sibling category.
- **Tablet band (640-960px).** Define behaviour explicitly (modal max-width vs viewport; rail collapse threshold) so a 960px modal doesn't overflow a ~700px viewport.
- **Mixed `publishImmediately` warning.** Surface in Confirm when a group has mixed publish/draft variants (buyers would see an incomplete variant selector).
- **Override-EAN threaded to category resolution** (see §3.2 edit) - both self-link and EanCategoryMatcher.

### SUGGESTION - noted (apply if cheap)
- Uniform per-field reset/override toggle so inherited-empty vs overridden-empty text is unambiguous; reserve badges for master/policy/overridden, use ghosting for inherited.
- AI "apply-to-base" shows a note that variants which overrode the description won't change.
- Price field renders the batch currency inline (per-row currency select removed).
- Primary variant: `perProductOverrides[selectedId]` and `perVariantOverrides[variantId]` key the same id - document the (harmless) self-override precedence.
- Tests: retry-rebuild asserts the **merged** snapshot incl. `ean` + persisted master stock; note expanded-sibling `stock` overrides are intentionally discarded; note a corrected re-submit is a new `batchId` (not deduped against the prior batch).
- Erli `siblingCount` derives from `getVariantsByProductId` (total), not the submitted set - cosmetic one-option group when all-but-one excluded; acceptable.

### Verdicts
- UX: minor revisions (form-state model + rail a11y + chip interactivity were the gaps) - addressed above.
- Backend: not implementation-ready until the empty-fan-out guard + `parameters` merge + override-EAN-in-category-resolution land - addressed above.
- E-commerce: architecturally sound + grouping-aware; editable EAN + per-variant card/category needed fencing - addressed above.

## 8. Scenario coverage & edge-case resolutions (completeness round 2)

### Backend correctness (must-fix)
- **Excluded-primary resurrection.** `expandVariantJobs`'s defensive re-add of `selectedId` (`:295-298`) must respect `excludedVariantIds` - if the seed/primary id is excluded, it is NOT re-added. A product whose every variant is excluded contributes zero jobs (then hits the empty-fan-out guard, §7 B3).
- **Empty-fan-out guard is post-expansion.** Throw `EmptyBulkSubmissionException` on `expandedJobs.length === 0` **after** exclusion + barcode filtering, not just on raw `productIds` (`:95`).
- **Stock is master-authoritative for expanded siblings - NOT operator-editable.** `buildEnqueueInput` keeps `masterAvailable` for `useMasterStock` siblings; the editor renders per-variant stock **read-only `from master`** (as the mock already does). Operator stock applies only to simple/single-variant/passthrough. Digest item 12's "override everything incl. stock" is corrected: stock is per-variant *from master*, not an operator override, for multi-variant siblings.
- **No phantom stock.** A sibling missing from the availability map resolves to **0** (out of stock), never the nominal `sharedConfig.stock` (1). Fix the `masterAvailable ?? operatorStock` fallback for `useMasterStock` jobs to `?? 0`.
- **Override EAN lives in `overrides.ean`** so the enqueue snapshot (`offer-creation-enqueue.service.ts`) bakes it and **#742 retry rebuilds with it**. Add a retry test asserting the rescued EAN survives.
- **Barcode-less included sibling.** The FE `no-ean` blocker must fire for any included sibling with neither an entity barcode nor an override EAN, so submit is gated - the BE otherwise silently drops it (`:275-282`). Add a BE test documenting the drop + an FE test proving the gate.

### FE state / interaction (must-fix)
- **Single source of truth for inclusion.** Each variant's `included` bool is the only state; the lead-column checkbox is *derived* (tri-state) and, on click, writes all children; the per-variant row toggle writes one. `excludedVariantIds` is computed at submit from `included === false`. No double source.
- **Tri-state semantics.** Parent reflects **inclusion**, not readiness (an included-but-blocked variant → parent checked + row status `attention`; two orthogonal axes). Clicking an `indeterminate` parent → **include all**. Toggling the last child flips the parent.
- **Same product selected twice.** Dedup selected ids by `productId` before client-side expansion so a product surfaced twice yields one row / one fan-out (mirror BE `seen` dedup).
- **Re-resolve preserves overrides.** Re-running Resolve (explicit, EAN-edit-forced, or step back→forward) updates blockers/category/master values but **merges**, preserving each variant's `override` + `editFormValues`. EAN-edit re-resolve preserves the sibling's other overrides.
- **Sibling-set drift (known limitation).** FE expands from hydrated `product.variants`; BE re-enumerates via `getVariantsByProductId`. If master changes between resolve and submit the sets can drift (a new sibling gets base config, bypassing unseen blockers). v1: accept + log; a "variants changed since resolve" reconcile guard is a deferred follow-up. Verify the detail endpoint populates variant `attributes` + `ean` (not just the list projection).
- **Rail labels.** Label = distinguishing attribute value; on a missing/duplicate distinguishing value fall back to `Variant {n}` (index) - never the raw `variantId`.
- **Demo / read-only in the new editor.** Gate the two-pane editor fields, image add/remove, and "Save all" behind `demoReadOnly` / `useWriteAccess`, matching Config + Confirm.
- **Mid-resolve navigation.** In-flight per-sibling queries cancel on unmount (TanStack default); state re-resolves on return (no partial persistence).
- **Large-batch fan-out.** Cap concurrency on the per-sibling resolve fan-out (bounded batches, not products×siblings unbounded). Note: the product cap is 100 but the **offer** count can exceed it; the retry loop's "≤100" comment (`bulk-listing-retry.service.ts:140`) is already stale under #824 - fix the comment; sequential-await retry perf is a deferred concern.
- **Different-category siblings.** Category is product-level (correct for grouping); when a sibling's own EAN resolves to a different category, surface a best-effort info note in Resolve/editor - it is still forced into the product category for grouping.

### FE churn scope (broader than §4.1-4.3 listed)
- Re-key from `row.primaryVariant` to `row.variants[]` across: `seedRow` (`:469`), `readyCount`/`noVariants` (`:335-338`), `noCardCategoryIds` fan-out (`:107-116`), `mergeResolveOutcomes` (`bulk-policy.ts:446`), `selectBulkProductCardId`/`recomputeRowBlockers` (`:304,329`), and the review reconcile effect (`bulk-wizard.tsx:175-194`).

### Operational (promoted from non-goal)
- **Progress page labels.** `BulkBatchRecordSummary` gains a product name + distinguishing-attribute label so `bulk-batch-progress-table.tsx` shows "Doniczka Terra - 16 cm", not `ol_variant_*`. Per-variant fan-out makes "which variant failed" the whole point; opaque ids are unacceptable. Minimal in-scope improvement (not the full progress-page redesign).

### Partial-decision closures
- **Dependent/filtered params (#16).** Render the allowed-value set the category-parameters query already returns per parent value (not just the label copy).
- **Policy provenance badge (#19).** Sourced from `computeResolvedPrice`/`computeResolvedStock` (`bulk-policy.ts`) - badge = `policy` when the value came from markup/flat/cap, not master/override.
- **no-match tree picker (#29)** is an explicit AC (breadcrumb + search + drill-in), alongside the multi-match candidate picker.
- **Distinguishing param (#18)** renders read-only by default; single-real-variant products still show it (they have real attributes; a synthetic variant does not).

### Tests to add (beyond §3.4)
- Simple/synthetic-variant exclude + count cascade; mixed batch (1 simple + 1 multi with some siblings excluded + 1 fully-excluded) asserting Confirm N/M/X + `canApprove`; tri-state parent click-direction + child→parent reflection; excluded-primary not resurrected; phantom-stock→0; retry carries override EAN.

## 9. Round-2 tech-review reconciliation (UX / backend / e-commerce)

### BLOCKING
- **B5 - EAN safety enforced in the BACKEND, not only the editor.** §7 B4 put GTIN-checksum + intra-group-uniqueness in the FE only, but §2 makes the BE the single fan-out source. Move the invariant to `expandVariantJobs`: reject/skip an included sibling whose effective EAN fails the GTIN checksum, and reject a submission where two included siblings of one product resolve to the **same** EAN (they'd collapse to one Allegro card, losing the distinguishing axis, or duplicate-reject). FE keeps the same checks for fast UX feedback; the BE is the enforcement point (a direct API call or resolve→submit drift must not corrupt grouping).
- **B6 - "Already listed on this connection" guard (create-only pipeline).** The bulk flow is create-only, idempotency-keyed per batch; re-running the wizard for a product that already has live `OfferMapping`s re-issues `createOffer` → duplicate offers / 409 storm recorded as `Reused`. This feature's exclude-then-return-later workflow makes re-runs first-class. Resolve/Review must query `OfferMappingRepositoryPort.findMany` per included variant on the target connection and raise an **`already-listed`** blocker/chip so the operator can't silently double-list. Scope the wizard explicitly as **create-only**; edit/update of a live offer is a documented future path.

### IMPORTANT - backend correctness
- **Guards span BOTH override maps.** The `categoryId` strip, `price.currency`-mismatch rejection, GTIN check, and nested-DTO validation (§7) apply to `perProductOverrides` (family layer) as well as `perVariantOverrides` - both flow through the same `mergeOverrides`.
- **3-way merge covers the scalar fields, not just `overrides`.** `price` and `publishImmediately` are top-level `PerProductOverride` fields resolved at `buildEnqueueInput:339-344` **outside** `mergeOverrides`; they must be 3-way-resolved (base → `perProductOverrides[selectedId]` → `perVariantOverrides[variantId]`) or per-variant price / per-row publish are silently dropped. `stock` stays master-authoritative for multi-variant siblings (read-only, §8). **The flat/simple editor writes to the same map `buildEnqueueInput` reads** - define: a flat product writes `perVariantOverrides[itsSoleVariantId]`, and the scalar 3-way resolution reads it.
- **Partial-submit robustness (elevate from non-goal).** Today the sequential enqueue loop commits `totalCount` before enqueue; a mid-loop failure at job k<N leaves N−k variants with **no `OfferCreationRecord`** (retry #742 can't recover them), counters that can never reach `totalCount` (permanently non-terminal batch), and already-enqueued successes as live offers under a `Failed` batch. Fix: **persist all `OfferCreationRecord`s before enqueue** (so retry can recover un-enqueued) OR **reconcile `totalCount`** to the number actually enqueued on failure. Wider per-variant fan-out makes this materially more likely. Also add a **total-expanded-offer cap** (product cap is 100; offers are uncapped).
- **DTO shape.** Use a distinct `PerVariantOverrideDto` that **omits `categoryId`** (reusing `CreateOfferOverridesDto` re-admits it). `excludedVariantIds` cap tracks the expanded ceiling, not the 100 product cap (offer count > product count).

### IMPORTANT - UX / operability
- **Progress page: per-product rollup, not just a label (§8 upgrade).** The new failure mode is "a live listing goes public missing a size." Group progress records by product with an "n/m live" header (e.g. "Doniczka Terra - 2/3 live, size M failed → listing incomplete") so partial-group failure is visible among hundreds of rows.
- **Edit-and-retry reality.** #742 retry rebuilds each record from its snapshot = re-runs identical data; the very errors this feature enables (bad EAN, missing param) are *fixable* input errors that retry can't fix. v1: surface clearly that fixing a data error = a new batch (exclude the already-succeeded siblings via B6). An edit-then-retry surface is a documented follow-up.
- **Modal edit-loss traps.** "change category ↱" (jump to Resolve) must commit-to-row first (or warn). Cancel/Esc/backdrop dismiss of the multi-variant editor needs a dirty-state "Discard changes to N variants?" confirm + gating Radix `onInteractOutside`/`onEscapeKeyDown` when dirty ("Save all" spans every variant - accidental dismissal is costly).
- **Fix-on-base affordance.** When the same blocker (e.g. `add product params: Marka`) recurs across many siblings, offer "fix on base (applies to all inheriting variants)" instead of steering to O(n) per-variant chip fixes - otherwise "bulk" is defeated.
- **Tri-state a11y implementation.** Set `indeterminate` via the DOM property (not JSX attr), `aria-checked="mixed"`, and announce parent toggles via a polite live region ("12 variants included").

### SUGGESTION
- **Distinguishing-axis reality (#824).** Allegro groups off each variant's own catalog product (GTIN + Allegro-derived param); emitting OL `attributes` as explicit distinguishing params is **deferred**. So the Rozmiar field in the editor is informational unless it is a mapped Allegro category parameter present in the emitted `parameters[]`. State this so the grouping payoff isn't assumed to come from the OL attribute.
- **Erli partial explicit group.** Erli maps `variantGroup` → `externalVariantGroup` over total siblings; a partial included subset is NOT necessarily benign (dangling selector). Verify Erli renders a partial explicit group coherently and that later-created siblings join the same `externalVariantGroup` - Erli-side verification task, not "cosmetic."
- **GPSR / responsible-person / product-safety** fields must be in the required-param set feeding `allegro:needs-product-parameters` (Allegro rejects most categories without them) - confirm they render in `bulkOfferRowSection`, inheritable from base.
- **`no-master-price` / `currency-mismatch` are product-level** (price sources from the master product, same for all siblings; only stock is per-variant). Don't over-model `masterPrice`/`masterCurrency` as per-`BulkVariantRow` - keep them on the row.
- **Exclusion buyer-facing note** ("you excluded 1 of 3 sizes - buyers see fewer options") near the toggle / in Confirm.
- **`erli:missing-image` dead-end**: image-less master → the blocker can't be cleared in-wizard (no upload); show an "add images in the master catalog, then re-resolve" empty-state instead of a bare unfixable blocker.
- **Incremental Resolve**: counted progress ("resolving 340/500") and/or render Review as siblings settle, so one slow sibling query doesn't hold the whole step.
- **Mixed publish/draft**: OL has no "activate drafts later" affordance - buyers see a partial selector until done in Allegro's UI. Conscious limitation.
- **Editor initial scope**: generic row "Edit" opens base; a chip opens the flagged variant. Excluded variants stay visible/greyed in Review + the rail so they can be re-included.
- **Allegro first-image compliance** under per-variant reorder (promoting a non-compliant image to slot 1 → 422 no blocker predicts; master URLs must be publicly fetchable).

### Verdicts (R2)
- UX: pre-submit surface solid; **post-submit half (partial-group-failure visibility + edit-and-retry) + modal edit-loss traps** must land.
- Backend: **not implementation-ready** until B5 (BE EAN guard), the both-maps guard, scalar 3-way merge, and partial-submit robustness land.
- E-commerce: **B6 already-listed guard** + distinguishing-axis confirmation are the gates; grouping logic otherwise sound.

## 10. EAN / GTIN / product-code requirement model (verified: code + Allegro + Erli)

**Verified current code state (all layers, both platforms): EAN is NOT required to create/publish an offer.** Allegro single-create has no EAN field (only `categoryId` is Zod-required); the bulk `no-ean` is a soft category blocker cleared by a manual `categoryId`; the backend never gates on EAN (`variantBarcode` only drives an optional catalog smart-link, else inline product); Erli keys the resource on the OL variant id and treats `ean` as optional. So OL can create offers - including **drafts** - without an EAN today on both marketplaces. This matches the operator's statement.

**Marketplace reality (what it takes to actually SELL / publish live):**
- **Allegro - EAN required to publish in most categories.** Since 2 Jan 2024 Allegro validates the GTIN against GS1 at publish time; an invalid EAN blocks both listing **and** editing. Escape hatches: the "Mój produkt nie ma kodu GTIN (EAN)" path for eligible categories, and an exempt-category set (handmade, used/vintage/refurbished, personalised, vehicle parts by OEM number, art/collectibles, services, Allegro Lokalnie). **Variant grouping requires a per-variant GTIN** - each sibling self-links its own catalog product (#824); a no-GTIN offer lists standalone and won't auto-group.
- **Erli - EAN NOT required to sell.** Grouping is via `externalVariantGroup` + `attributes` (#1065/#986), not GTIN. **Open item to verify on the Erli sandbox:** whether a product code (SKU/`reference` or `ean13`) is required to *sell* (the schema marks `sku`/`ean` optional, but "API-accepts" ≠ "sells" - the operator believes a product code is required). Treat as: for an Erli *published* offer, require a product identifier (SKU or EAN); confirm live before shipping.

**Design model - EAN-requiredness is CONDITIONAL on publish intent × platform × category:**
1. **Publish immediately + Allegro + non-exempt category + no valid EAN ⇒ HARD `no-ean` blocker** ("EAN required to publish"). Resolutions: add a valid (checksum-passing, intra-group-unique) EAN; mark the category exempt / "product has no GTIN"; or **switch the offer/variant to draft** (uncheck publish).
2. **Draft (publishImmediately = false) ⇒ `no-ean` is NOT blocking** on either platform - the offer is created as a draft/inactive and the operator completes + activates it on the marketplace later. `no-ean` shows as informational, not a gate.
3. **Erli + publish ⇒ require a product code (SKU or EAN)** [verify]; EAN is not needed for grouping.
4. Therefore `computeBlockers` (`bulk-policy.ts`) must factor **`publishImmediately` + platform capability + category-exemption** into `no-ean` severity - it is no longer an always-soft flag. The Allegro GS1 publish-gate also means an **invalid** EAN blocks publish+edit, reinforcing the B4/B5 checksum enforcement (FE for UX + BE as the source of truth).
5. **Per-variant publish interaction:** because publish can be per-variant (§4.4), `no-ean` severity is evaluated per variant against that variant's effective publish flag - a variant published live needs a valid EAN (Allegro non-exempt); a draft sibling doesn't.

**Implications for the wizard UX (reflected in the mockup):**
- The `no-ean` chip/banner is worded as "EAN required to publish" and offers: correct the EAN, mark the category as no-GTIN/exempt, or create as draft.
- The base/variant "Publish immediately" toggle drives whether `no-ean` gates: unchecking it (draft) clears the `no-ean` gate with an informational note ("created as a draft - add the EAN and activate on the marketplace to sell").
- Category-exemption ("product has no GTIN" / exempt category) is a per-product affordance that clears `no-ean` for a publishable-without-GTIN listing (standalone, non-grouped).
- Erli: surface the product-code (SKU/reference) requirement as its own blocker if the sandbox confirms it; EAN stays optional for Erli.

## 10.1 Identifier model - corrected after the Allegro + Erli deep-dive

**Supersedes the publish-conditional framing in §10.** The requirement is not a bespoke "publish needs EAN" gate; it is the existing category-parameter mechanism plus a validity gate.

**Allegro - two objects:**
- A **catalog product** needs a strong identifier to be pinned: **GTIN/EAN** OR **Kod producenta (MPN) + Marka**. WHICH one and WHETHER required is **per-category**, expressed by `requiredForProduct` on the category's parameters - which OL already fetches (`GET /sale/categories/{id}/parameters`) and already surfaces as the **`allegro:needs-product-parameters` blocker (#810)**. So the category-driven identifier requirement is ALREADY handled by the required-params path - do **not** add a separate publish-conditional `no-ean` gate.
- An **offer** needs no identifier of its own; `external.id` (seller SKU) is optional and never validated.
- **`no-ean` / `no-match` are catalog-matching / grouping signals, not publish gates.** Without a GTIN, OL falls through to an inline product proposal (works where the category doesn't require an identifier) - the offer lists **standalone and does not auto-group**. So `no-ean`/`no-match` remain **soft** (bypassable by inline/manual category), and their real cost is "no catalog card + no auto-grouping," not "can't publish."
- **GS1 validity gate (B5):** a *provided* EAN must be GS1-valid (checksum + registered) or Allegro rejects create AND edit - enforced FE (UX) + BE (source of truth). This is validity, not mandatoriness.
- **Identifier validation happens on create for drafts too** (INACTIVE) - `publishImmediately` controls visibility/selling, NOT identifier validation. (Correction to §10's draft framing.)
- **Variant grouping** needs each sibling to resolve its own catalog product (GTIN, or MPN+Brand) + a distinguishing parameter.

**Erli - identifiers are NOT category-dependent:**
- Resource key = `externalId` (OL variant id, URL path). `ean` optional (create + sell), `sku` optional (OL never sends it), category optional (lists uncategorised). Category governs valid VAT + parameter sets, not identifier-requiredness.
- The real **sell-gate is not identifiers** but: `deliveryPriceList` (#1530), responsible producer / GPSR (#1531), `status:active`, positive `stock`. Grouping via `externalVariantGroup` + attribute indexes - no EAN.
- Async validation after the 202 means a category-specific barcode expectation, if any, surfaces post-accept - **verify on sandbox**; nothing in the schema/adapter requires it.

**Net effect on the design:**
1. Keep `no-ean`/`no-match` **soft** (catalog-matching/grouping), per-variant, resolvable by: correct/add EAN, provide Kod producenta (MPN), or manual category (lists standalone, no group).
2. Category-**required** identifiers (GTIN or MPN, per `requiredForProduct`) are gated by the **existing `allegro:needs-product-parameters`** blocker - per-variant param-schema fan-out (§4.2) already covers this.
3. Enforce **GS1 validity** on any supplied EAN (B5), FE + BE.
4. SKU: never gate on it. Erli EAN/SKU: never gate; Erli sell-gate is delivery/producer/stock/active (out of this issue's scope but note it).
5. Drop the publish-conditional `no-ean` idea from §10 - it was inaccurate; requiredness is category-param-driven and applies to drafts too.

## 11. Final case-matrix closure (design QA round)

### Connection / platform scoping (was unaddressed)
- **One target connection per batch.** The wizard's Config step selects exactly one `connectionId`; a batch never spans multiple connections or mixed platforms. Restate this explicitly (the whole design threads a single `platformType`).
- **Gate the connection picker to `OfferCreator`-capable connections.** Only connections whose adapter implements `OfferCreator` appear as targets. **WooCommerce** (base-port-only, stock write-back via `ShopProduct` mappings, #1498) and any no-`OfferCreator` connection are **excluded from the offer-creation wizard** - selecting one is impossible, not undefined.

### Blocker fix-paths (were dead-ends / unspecified)
- **`no-master-stock` on a multi-variant sibling is NOT a hard blocker.** Master stock (incl. 0) is authoritative and read-only for siblings; a 0/absent value lists the variant **out-of-stock/inactive**, it is not a create error. So `no-master-stock` gates only single-variant / passthrough offers (operator stock); for multi-variant siblings it is informational (or absent). Removes the §4.3 "opens editor" dead-end.
- **`currency-mismatch` fix path:** resolved by aligning the **batch currency** (Config step) or entering a per-variant/base **price override in the batch currency**; the chip routes to the editor (price override) with a "or change the batch currency in Config" hint. State the two paths (the per-row currency select is gone).
- **2+ simultaneous blockers:** all chips render; the editor focuses the first blocking field; fixing one re-evaluates the rest live (no forced sequence).

### Identifier uniqueness (was intra-group only)
- **Batch-wide EAN uniqueness, not just intra-product-group.** Two *different* products in one batch sharing an EAN would collapse to the same Allegro catalog card (cross-product collision). Extend the B5 uniqueness check to **batch-wide** (FE warns, BE enforces): a given EAN may back only one product's catalog link in the batch.
- **Duplicate distinguishing-attribute value across included siblings** ⇒ a **grouping blocker**: two included siblings with the same distinguishing value (e.g. two "M") can't be told apart in one Allegro group. Flag it (block or force-exclude one); today only the rail-label fallback was specified.

### Lifecycle races / joining existing groups
- **already-listed is a best-effort FE pre-check; the BE is authoritative.** It reads `OfferMapping`s at Resolve; a concurrent in-flight batch may not have written its mappings yet → possible double-list. The real guard is the per-variant idempotency key + the create-time mapping write under the per-(offer,connection) lock (existing). Document that the FE chip prevents the common case, not the race.
- **Adding a late sibling joins the existing Allegro group automatically** - Allegro auto-groups off each variant's own catalog product (GTIN); a newly-created sibling with its own GTIN joins the pre-existing buyer-facing listing without an explicit group call (#824). State this so the "exclude now, return later" flow is understood to converge.
- **Erli sell-gate** (delivery-price-list #1530, responsible producer / GPSR #1531, active, stock) is **out of scope for #1741** - note it so nobody assumes creating an Erli offer here makes it sellable.

### Scale / minor
- **8+ variants:** the editor rail scrolls (`overflow-y:auto`); add a "jump to next flagged variant" affordance (nice-to-have) so blocked siblings are reachable without scanning.
- **Simple-product editor** carries its own include/exclude toggle + excluded note in-modal (parity with the variant editor), not only the row checkbox.
- **Per-variant image reorder → Allegro first-image compliance:** promoting a non-compliant image to slot 1 can 422 with no predictive blocker; surface as a post-submit failure reason (progress rollup), not a pre-flight gate.

## 12. Final 6-lens review round (ecommerce / UX / capability / performance / security / issue-audit)

> The issue #1741 body was rewritten clean after this round and is the canonical checklist. §12 records the rationale for the new/elevated items. **The stale publish-conditional §10 checkboxes are superseded by §10.1 - do not implement them.**

### Ecommerce
- **Grouping-determining attributes are base-only.** Fence not just `categoryId` but **Brand (`Marka`)** and **Condition (`Stan`)** from per-variant divergence - siblings must share condition + brand to resolve to one catalog-product family; a per-variant divergence breaks auto-grouping or duplicate-collapses.
- **Identifier-uniqueness spans the effective identifier, not just EAN.** Extend the uniqueness guard to **EAN OR MPN+Brand** (the §10.1 rescue path can collapse two barcode-less siblings sharing MPN+Brand exactly like duplicate EANs), and to **batch-wide** (two different products sharing an identifier collide on one card), not only intra-group.
- Per-variant title is a no-op on a grouped listing → keep title base-only for grouped products or note it.

### UX (at 20 products / 60 variants)
- **Discovery-at-scale is required, not polish:** make the filter box work + provide "show only flagged / jump to next flagged". Collapsed rows at scale make hunting flagged siblings the biggest cost.
- **`fix-on-base` must be a real action** (button routing to the base field), not copy - the common case is one missing shared param across all siblings.
- **Per-variant `publishImmediately`** in the variant panel (parity with today's per-row capability) + a **mixed-publish/draft warning** in Confirm.
- **A11y:** fix-chip accessible names include variant identity ("Fix: no EAN - Size M"); the rail is a keyboarded `tablist`/`radiogroup`; tri-state via the `indeterminate` DOM property + `aria-checked="mixed"` + live-region; modals via the project Radix `Dialog`.
- Reconcile `no-master-stock`/`no-master-price` chip mapping with §11 (not a hard editor dead-end for multi-variant siblings).

### Capability (verified - no blocker)
- The **`OfferCreator` connection-picker gate already exists** (`bulk-config-step.tsx`, `OfferCreationLauncher.tsx`); Allegro + Erli advertise it, **WooCommerce does not → excluded**. `CategoryBrowser` vs borrows, `EanCategoryMatcher` suppression for Erli, and `offerValidation`/`platformBlockerChips` are all capability/config-gated, never `platformType`.
- **Latent trap:** do NOT add an FE `supportedCapabilities.includes('CatalogProductReader')` gate for the candidate picker (Allegro is advertised-without-dispatch and would fail it) - candidates come from the `resolveCategoriesBatch` response. Preserve Erli's `destinationResolvesCategoryAtSubmit` suppression when re-keying primary→variants[].

### Performance & scale (BLOCKING at ~600 offers - the 6× fan-out multiplier)
- **200-id request caps** on `resolve-category-batch` + inventory-availability break at ~34 six-variant products → **chunk both fan-outs to ≤200 (≤~50 for latency)**, parallel chunks.
- **Category resolve concurrency = 3 per EAN** → 600 cold-cache EANs ≈ 60-100 s in one synchronous request → raise concurrency / parallel chunks / resolve-time budget; incremental Resolve is required at this scale.
- **Param-schema `useQueries`** unbounded → cap concurrency; **`requiredByCategory` rebuilt every render** (O(variants)) → memoise.
- **Submit** sequential per-row inserts → batch-insert + persist-before-enqueue (also the §9 partial-submit fix). **Retry** sized "≤100", worst case 4×600 serial awaits → single counter decrement + bounded concurrency.
- **Progress page** polls all ~600 full records (with `request` snapshot) every 5 s, unvirtualized → **virtualise + counts-only/paginated poll + drop the snapshot from the payload**.
- State expected worker drain time + AI cost; default AI-per-variant off for large batches.

### Security & data-integrity (elevated to BLOCKING)
- Authz is fine and server-enforced (`@Roles('admin','operator')`; demo `viewer` → 403). Keep it; no demo-only branch.
- **Override-map value validation** (nested `PerVariantOverrideDto` for BOTH maps - `whitelist` doesn't recurse into `Record<>`), **size/key caps + expanded-offer ceiling**, **prototype-pollution key rejection** (`^ol_variant_[a-f0-9]+$` / null-proto), **currency divergence rejection**, **partial-submit atomicity**, and **BE EAN/card/uniqueness enforcement** (retry rebuilds from the snapshot and does NOT re-validate, so the gate must be at submit). All BLOCKING.

### Issue hygiene
- The issue was rewritten to remove the §10-vs-§10.1 contradiction, fix the `OfferBuilderService` = CORE labelling, reconcile EAN-uniqueness to batch-wide, split the mega Editor/Review ACs into discrete verifiable checkboxes, and de-duplicate the empty-fan-out / master-stock / currency / already-listed / EAN-validity ACs.
