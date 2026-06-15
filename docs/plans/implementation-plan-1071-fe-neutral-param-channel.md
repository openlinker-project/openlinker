# Implementation Plan: Migrate offer-creation params to the neutral channel + collapse the Allegro adapter (#1071)

**Date**: 2026-06-15
**Status**: Ready for Review
**Estimated Effort**: ~1–1.5 days
**Issue**: Closes #1071 · Epic #1005 · ADR-023 §3/§6 · follow-up to #1039
**Branch**: `1071-fe-neutral-param-channel`

---

## 1. Understand the task

**Goal**: Retire the transitional dual param-channel #1039 left behind. Operator-picked Allegro offer parameters should travel as the neutral domain `OfferParameter[]` (the same shape projection produces) instead of the Allegro-shaped `platformParams.parameters` / `platformParams.productParameters`. Delete `serializeAllegroParameters`; the offer/product `section` split must exist in exactly one place — the Allegro adapter. `platformParams` keeps only un-modeled knobs (delivery policy id, invoice, warranty ids).

**Layer**: Frontend (wizard serializer, request type, edit round-trip) + Interface (BE create-offer DTO) + CORE (builder merge + Gate-2) + Integration (Allegro adapter).

**Non-goals**: no change to the enqueue/execute/snapshot/retry orchestration *signatures* (see Design D2 — operator params ride the existing `overrides` threading, deliberately avoiding the files the parallel #1042 session is in); no shop-side (`PublishProductCommand`) change (#1072); no new range-param UI.

**Acceptance (issue)**:
1. A wizard-created Allegro offer with operator-picked params publishes identically, params flowing only through `cmd.parameters`.
2. `serializeAllegroParameters` deleted; the offer/product split lives in exactly one place (the Allegro adapter).
3. `platformParams` no longer carries category parameters anywhere.

## Revisions (post tech-review)

- **B1 (blocking, applied) — the BULK FE path also uses `serializeAllegroParameters`.** Importers are not just the single-offer wizard: **`components/bulk/bulk-edit-modal.tsx`** serializes per-product params, and **`components/bulk/bulk-policy.ts:212`** reads `override.overrides?.platformParams?.productParameters` to drive the `needs-product-parameters` blocker (inline-product rows need product params; card-linked rows inherit). AC2/AC3 are unachievable without migrating these. **Scope expands** to: migrate `bulk-edit-modal.tsx` → `overrides.parameters`, and update `bulk-policy.ts`'s blocker to read `overrides.parameters` filtered to `section==='product'`.
- **I1 (applied) — bound `overrides.parameters` in the DTO.** The existing `PlatformParamsSizeValidator` only caps `platformParams`; add `@ArrayMaxSize(N)` + `@ValidateNested({each:true})` on `OfferParameterDto[]` and cap `values`/`valuesIds` lengths so the new field isn't unbounded input.
- **I2 (applied) — bulk `mergeOverrides` semantics for `parameters` = REPLACE.** `mergeOverrides` does `{...shared, ...perProduct}` + deep-merges only `platformParams`; a top-level `parameters` therefore gets per-product-replaces-shared. That's correct for per-category params (a row supplies the complete set for its category) and is kept deliberately — documented + covered by a bulk-submit unit test.
- **I3 (applied) — the D3 fallback is correctness, not just data preservation.** Without it, retrying a pre-#1071 failed record (params under `platformParams`) makes the builder see zero operator params → a required offer-section param the operator supplied now newly `business_failure`s on retry. Keep the fallback + add a "v1 snapshot retries through the fallback" test.
- **S1** — assert the builder does NOT copy `overrides.parameters` onto `command.overrides` (consumed into `command.parameters` only; adapter reads only `cmd.parameters`).
- **S2** — `rangeValue` widens the shared `OfferParameter` that #1072 reuses for `PublishProductCommand` (optional field, harmless for shop) — coordinate.
- **S3** — re-home `MissingCategoryParameterSectionError` into the new serializer file; update wizard + bulk-modal imports.
- **S4** — doc `overrides.parameters` (operator request intent) vs `command.parameters` (merged result) on each so they aren't conflated.

---

## 2. Research — verified surfaces

| Surface | File | Note |
|---|---|---|
| FE serializer (to delete) | `apps/web/.../components/serialize-allegro-parameters.ts` | `→ {offerParameters, productParameters}`; handles dictionary single/multi/custom, **range (`rangeValue {from,to}`)**, scalar. Throws `MissingCategoryParameterSectionError`. |
| FE wizard submit | `AllegroCreateOfferWizard.tsx:719-769` | builds `platformParams.parameters/productParameters` + policy ids; POSTs `overrides.platformParams`. |
| FE edit round-trip | `create-offer-request-to-form-values.ts:55-103,138` | `readParameters` reads `platformParams.parameters` + `productParameters` (incl. `rangeValue`). |
| FE request type | `features/listings/api/listings.types.ts:156-184` | `CreateOfferOverrides.platformParams?: Record`. No FE `OfferParameter`; has `CategoryParameter.section`. |
| BE create-offer DTO | `apps/api/.../dto/create-offer.dto.ts:75-165` | `CreateOfferOverridesDto.platformParams?: Record` (≤4KB validator). |
| Builder (my #1039 code) | `offer-builder.service.ts` | `readOperatorOfferParamIds(platformParams)` for Gate-2; sets `command.parameters` = projected only. |
| Allegro adapter (my #1039 code) | `allegro-offer-manager.adapter.ts` | `mergeSectionParameters(projected, legacyRaw)` reads `platformParams.parameters/productParameters`; splits by section. |
| Neutral type | `offer-parameter.types.ts` | `OfferParameter {id, values?, valuesIds?, section}` — **no `rangeValue`** (gap). |
| `AllegroOfferParameter` | `allegro/.../allegro-api.types.ts` | `{id, name?, values?, valuesIds?}` — range currently flows only via runtime passthrough. |
| Snapshot / retry | `offer-creation-request-snapshot.types.ts`, `bulk-listing-retry.service.ts:167-174`, `offer-creation-execution.service.ts:88-95` | all thread `overrides` as a unit — **untouched** by D2. |

---

## 3. Design

### D1 — extend the neutral type with `rangeValue` (no-regression)
The FE serializer emits `rangeValue {from,to}` for integer/float range params; the neutral `OfferParameter` doesn't model it, so a naive migration would **drop range support**. Add `rangeValue?: { from: string; to: string }` to `OfferParameter` (additive; projection never produces it, only operator params do). Add `rangeValue?` to `AllegroOfferParameter` so the adapter emits it explicitly (today it survives only as an untyped runtime passthrough).

### D2 — operator params ride `overrides.parameters` (neutral), not a new top-level request field
Add `parameters?: OfferParameter[]` to **`CreateOfferOverrides`** (BE domain + FE mirror) and `CreateOfferOverridesDto` (validated). Operator-picked params travel here. **Why `overrides` not a new top-level field:** `overrides` is already threaded verbatim through enqueue → execute → **snapshot** → retry (`bulk-listing-retry.service.ts:174` spreads `snapshot.overrides`), so operator params get persistence + retry pre-fill **for free** with zero changes to those signatures — and crucially **no edits to the orchestration files the active #1042 session is refactoring** (conflict-avoidance). The command keeps its #1039 top-level `command.parameters`; the *request/override* carries operator intent.

### D3 — the builder owns the merge (the merge moves out of the adapter)
`OfferBuilderService`:
- `operatorParams = normalizeOperatorParameters(input.overrides)` — neutral `OfferParameter[]` from `overrides.parameters` (new) **or**, as a transitional read-only fallback for pre-#1071 persisted snapshots, hoisted from legacy `overrides.platformParams.{parameters,productParameters}`. Preferring the neutral field.
- `command.parameters = mergeById(projected, operatorParams)` — **operator wins by id**.
- **Gate-2 simplification**: gate offer-section required params unresolved *after* the merge (subtract operator offer-param ids from `projection.unresolvedRequired`). The typed `overrides.parameters` removes the untyped `readOperatorOfferParamIds(platformParams)` guard.

### D4 — the adapter is the sole shaper (legacy path removed)
`AllegroOfferManagerAdapter`: delete the `platformParams.parameters`/`productParameters` reads and the `legacyRaw` branch of `mergeSectionParameters`. Now just split `cmd.parameters` by `section` → `body.parameters[]` (offer, before the smart-link early-return) / `productSet[0].product.parameters[]` (product, inline path), mapping each `OfferParameter` → Allegro wire (`{id, values?, valuesIds?, rangeValue?}`, `section` stripped).

### D5 — FE
- New `category-parameters-to-offer-parameters.ts` (replaces `serializeAllegroParameters`): form values + `CategoryParameter[]` → **single** `OfferParameter[]` (each carrying its `section`; keep the `MissingCategoryParameterSectionError` strict-section guard; keep dictionary/range/scalar mapping incl. `rangeValue`). Wizard sets `overrides.parameters`, drops `platformParams.parameters/productParameters`.
- `create-offer-request-to-form-values.ts`: read `overrides.parameters` (new) with a transitional fallback to legacy `platformParams.{parameters,productParameters}` for old stored requests.
- FE types: add `OfferParameter` mirror to `listings.types.ts`; `CreateOfferOverrides.parameters?: OfferParameter[]`.

---

## 4. Step-by-step plan

1. **`offer-parameter.types.ts`** (core) — add `rangeValue?: { from: string; to: string }`. **`allegro-api.types.ts`** — add `rangeValue?` to `AllegroOfferParameter`. *AC: additive.*
2. **`offer-create.types.ts`** (core) — `CreateOfferOverrides.parameters?: OfferParameter[]` (+ doc). *AC: additive; rides existing `overrides` threading.*
3. **`create-offer.dto.ts`** (api) — `OfferParameterDto` (class-validator: `id` string; `values?`/`valuesIds?` string[] with capped length; `rangeValue?` nested `{from,to}`; `section` in `['offer','product']`) + `CreateOfferOverridesDto.parameters?: OfferParameterDto[]` with **`@ArrayMaxSize(N)` + `@ValidateNested({each:true})`** (I1 — bound the array; the existing `PlatformParamsSizeValidator` only covers `platformParams`). *AC: rejects malformed; array + value lengths bounded.*
4. **`offer-builder.service.ts`** — `normalizeOperatorParameters` + `mergeById(projected, operator)`; set `command.parameters` = merged; Gate-2 subtract operator offer-ids from the typed list; drop `readOperatorOfferParamIds(platformParams)`. *AC: AC1; wizard offers don't false-fail Gate-2; old snapshots still carry params (fallback).*
5. **`allegro-offer-manager.adapter.ts`** — remove legacy `platformParams.parameters/productParameters`; `mergeSectionParameters` → section-split of `cmd.parameters` only, emitting `rangeValue`. *AC: AC2; range params reach the wire; smart-link unaffected.*
6. **FE (single-offer + BULK — B1)**: new neutral serializer `category-parameters-to-offer-parameters.ts` producing one `OfferParameter[]` (keep dictionary/range/scalar mapping incl. `rangeValue`; **re-home `MissingCategoryParameterSectionError` here** — S3); delete `serializeAllegroParameters` + port its spec. Migrate consumers: `AllegroCreateOfferWizard.tsx` submit → `overrides.parameters`; **`bulk/bulk-edit-modal.tsx`** → `overrides.parameters`; **`bulk/bulk-policy.ts`** `needs-product-parameters` blocker → read `overrides.parameters` filtered `section==='product'` (was `platformParams.productParameters`). Round-trip `create-offer-request-to-form-values.ts` reads `overrides.parameters` (+ legacy `platformParams` fallback). Add FE `OfferParameter` (with `rangeValue?`) + `CreateOfferOverrides.parameters` to `listings.types.ts`. *AC: AC2/AC3; wizard + bulk publish identically.*
7. **Tests** — core: builder merge (operator wins by id), Gate-2 offer-section + operator subtraction, **v1-snapshot legacy fallback retry (I3)**, **`overrides.parameters` not leaked onto `command.overrides` (S1)**, rangeValue passthrough; **bulk-submit: `mergeOverrides` replace-semantics for `parameters` (I2)**; allegro: section split + rangeValue + no legacy `platformParams` read; api: DTO validation + array/value bounds (I1); FE: new serializer (all shapes incl. range + missing-section throw), wizard submit shape, **bulk-edit-modal submit + bulk-policy blocker (B1)**, round-trip both formats. Update the #1039 adapter/builder specs that referenced the legacy channel.
8. **Quality gate** — rebuild libs; `pnpm lint` (FE flaky-suite retry, not `--no-verify`), `pnpm type-check`, `pnpm test` (core + allegro + api + web). `pnpm test:integration` listings create-offer slice (no Docker locally → note for CI). **No migration** (no ORM entity touched; `overrides` is JSONB-carried).

---

## 5. Validation & Risks

- **ADR fidelity** ✅ — single neutral channel; section split confined to the adapter (ADR-023 §6); `platformParams` reserved for knobs.
- **Risk — range regression** → D1 adds `rangeValue` to the neutral type + adapter; covered by tests.
- **Risk — old persisted snapshots** (overrides.platformParams params) lose data on retry → D3 transitional read-fallback; documented, removable once records age out.
- **Risk — #1042 conflict** → mitigated by D2 (no edits to enqueue/execute/snapshot/retry signatures). Both touch `offer-create.types.ts`? #1042 is shop-side (`PublishProductCommand`); shouldn't touch `CreateOfferOverrides`. Rebase if needed.
- **Risk — FE flaky full-suite** (known) → retry, never `--no-verify`.
- **Backward compat** ✅ — additive DTO/type fields; old snapshots read via fallback; no migration.

## 6. Alignment checklist
- [x] Hexagonal — section split in adapter only; core/ FE carry neutral
- [x] Reuses `OfferParameter` (extended), existing `overrides` threading, `business_failure` plumbing
- [x] No `any` (typed DTO + guards); file headers; FE mirrors BE contract
- [x] No migration; minimal blast radius vs the active #1042 work
- [x] Tests across FE/core/api/allegro
