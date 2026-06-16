# Implementation Plan: Wire category + attribute projection into offer creation (#1039)

**Date**: 2026-06-15
**Status**: Ready for Review
**Estimated Effort**: ~1–1.5 days
**Issue**: Closes #1039 · Epic #1005 · ADR-023 §1/§3/§5 · ADR-024 §Flow
**Branch**: `1039-wire-projection-offer-creation`

---

## 1. Understand the task

**Goal**: Make `OfferBuilderService` (core/listings) actually *use* the placement + projection machinery merged this week. Today it resolves the destination category **barcode-only** and **never projects attributes**, so the per-source-category mapping (#1037) and `AttributeProjectionService` (#1038/#1054) are dead on the real offer path.

**Approach = the ADR-faithful end-state (D1-C), not the MVP shortcut.** Verified against ADR-023/024: both ADRs depict the pipeline currency as a **typed neutral parameter list** (ADR-023:156, ADR-024:89 `ResolvedParameter[]`), and ADR-023's Decision mandates **no platform strings/ids in core** + **all platform shaping in the adapter** (it rejected a per-platform projector "because adapters would hold no platform code"). `platformParams` appears in **zero** ADRs — its use as the projected-param carrier (PR #1070) is an unrecorded implementation compromise. So #1039 introduces the **first-class neutral channel** the ADRs draw, and records the carriage decision in ADR-023.

**Layer**: CORE (new domain type + builder wiring) + a contained **Integration** change (Allegro adapter consumes the new channel) + a small **doc** edit (ADR-023 contract-surface note).

**Non-goals (filed as follow-ups, see §6)**:
- FE wizard still emits Allegro-shaped `platformParams.parameters`/`productParameters`; migrating it to the neutral channel + deleting `serializeAllegroParameters` + collapsing the adapter to a single channel → **follow-up issue**.
- Unifying the shop `PublishProductCommand` onto the same neutral parameter channel (revisit #1070's `platformParams` carriage) → **follow-up issue**.
- No mapping-authoring API/FE (#1044), no shop publish (#1041/#1042/#1043), no ERLI reuse (#1045), no migration.

**Acceptance (from the issue)**:
1. An Allegro offer with a mapped source category + dictionary attributes publishes with valid parameters.
2. An unmapped required category/parameter yields `business_failure` carrying the unmapped keys.

## Revisions (post tech-review)

- **B1 (blocking, applied) — Gate-2 is scoped to `section === 'offer'` required params only.** Allegro's catalog smart-link (#431/#808) inherits **product-section** params (Brand/EAN/Model…) from the card and early-returns in the adapter (`allegro-offer-manager.adapter.ts:1562`), and the bulk path (#824) self-links every variant — so gating product-section required params at the builder would false-fail offers that succeed via card inheritance, **regressing shipped behavior**. Product-section required validation is deferred to the adapter / Allegro's `2xx`-with-`validationErrors`. To filter by section the builder needs section on each unresolved entry → `AttributeProjectionResult.unresolvedRequired` gains a `section` field (additive, populated owns-path only).
- **I1 (applied) — the merge lives in the adapter, not the builder.** The builder sets `command.parameters = projected only` and reads operator **offer-param ids** (from `platformParams.parameters`) *only* for the Gate-2 subtraction. The Allegro adapter performs the actual merge of `cmd.parameters` with the legacy `platformParams.parameters/productParameters` (operator wins by id). No double-merge; core never un-shapes Allegro's offer/product split.
- **I2 (applied) — typed guard, no `any`.** Reading operator param ids from `platformParams` uses an `isOfferParameterIdShape`-style narrowing, not `any`.
- **I3 (applied) — full integration sweep.** Audit/adjust `listings-create-offer` + bulk int-specs for the new gate and run the **full** `pnpm test:integration`, not just the one slice.
- **S1** — projection's schema fetch routes through the adapter's cached `fetchCategoryParameters` (24h TTL) — confirm, no raw fetch per offer.
- **S3** — record the carriage decision in ADR-023 as a dated **addendum** line (don't rewrite the Accepted body).
- **S4** — projection re-runs on retry (#742) against current mapping state — intended reconcile-forward; noted.

---

## 2. Research — verified surfaces

| Surface | File | Status for #1039 |
|---|---|---|
| `OfferBuilderService.buildCreateOfferCommand` | `listings/application/services/offer-builder.service.ts:51` | barcode-only; no projection — **edit site** |
| `OfferBuilderService.resolveCategory` | `…:144` | passes only `{connectionId, barcode}` — add `sourceCategoryIds` |
| `CategoryResolutionService.resolveCategory` | `…/category-resolution.service.ts:54` | already accepts `sourceCategoryIds`, returns `{destinationCategoryId, provenance, method}` — no change |
| `AttributeProjectionService.project` | `…/attribute-projection.service.ts:49` | returns `{parameters: ResolvedParameter[], unmappedSourceKeys, unresolvedRequired}` — **re-type output to domain `OfferParameter`** (alias keeps it source-compat) |
| `ResolvedParameter` | `application/types/attribute-projection.types.ts:35` | referenced only inside listings (types + service + barrel) — safe to make an alias of the new domain type |
| `OfferBuilderValidationException` | `domain/exceptions/offer-builder-validation.exception.ts` | `issues: {field,code,message}[]` — reuse for the parameter gate |
| `OfferCreationExecutionService.mapBuilderException → recordToOutcome` | `…/offer-creation-execution.service.ts:271,221` | already maps `OfferBuilderValidationException` → `Failed` → `business_failure` — **no change** |
| `Product.categories?: string[]` (#1034) | `products/domain/entities/product.entity.ts:38` | source ids; already fetched at `offer-builder.service.ts:75` |
| `ProductVariant.attributes` | `products/domain/entities/product-variant.entity.ts:21` | projection input; already fetched at line 54 |
| Allegro param consumption | `allegro-offer-manager.adapter.ts:1550` (`platformParams.parameters`), `:1621` (`platformParams.productParameters`); split done by FE `serializeAllegroParameters` | sole live `createOffer` consumer (grep-verified) |
| Tokens / module | `listings.tokens.ts`, `listings.module.ts` | `ATTRIBUTE_PROJECTION_SERVICE_TOKEN` exists; `AttributeProjectionService` already a provider in `ListingsModule` (same module as `OfferBuilderService`) → injectable directly |

**Verified**: Allegro is the **only** adapter implementing `createOffer`; the smart-link `unique` branch early-returns (`…:1562`) so product-section params are dropped (inherited from the card) while offer-section `body.parameters` still applies.

---

## 3. Design (D1-C — typed neutral channel, adapter is sole shaper)

### 3.1 New canonical domain type
`listings/domain/types/offer-parameter.types.ts`:
```ts
export interface OfferParameter {
  id: string;             // owns-path: live CategoryParameter.id; pass-through: destinationParameterName
  values?: string[];      // free-text / pass-through
  valuesIds?: string[];   // resolved dictionary entry ids (owns + dictionary type)
  section: CategoryParameterSection;   // neutral 'offer' | 'product'
}
```
- `AttributeProjectionResult.parameters` re-typed to `OfferParameter[]`; the projection service imports the domain type (application→domain is allowed). `export type ResolvedParameter = OfferParameter` kept as a deprecated alias so the barrel + any in-flight PRs don't break.
- This is the real answer to PR #1070's objection ("don't let the command reference an application type"): **model the concept in the domain**, don't hide it in an opaque bag.

### 3.2 First-class command channel
`CreateOfferCommand.parameters?: OfferParameter[]` (domain→domain, clean). `platformParams` is **no longer** the carrier for category parameters — it reverts to its documented role (un-modeled platform knobs: `deliveryPolicyId`, `invoice`, `handlingTime`, warranty ids).

### 3.3 Builder flow (ADR-023: two gates; ADR-024:89 currency)
```
fetch variant → connection → masterConnectionId → productMaster.getProduct()
  ↓
resolveCategory({ connectionId, barcode, sourceCategoryIds: product.categories }) → categoryId
  ↓
push price issues
  ↓
GATE 1: issues (category null | price) → throw OfferBuilderValidationException        ← business_failure
  ↓  (categoryId guaranteed non-null)
project({ sourceConnectionId: masterConnectionId, destinationConnectionId: connectionId,
          destinationCategoryId: categoryId, attributes: variant.attributes ?? {} })
  ↓
merge: projected OfferParameter[]  ⊕  operator-supplied (transitional: ids read from
       legacy platformParams.parameters/productParameters) — operator wins by id
  ↓
GATE 2: required params still unpopulated after merge → throw OfferBuilderValidationException
        (one issue per param: field `parameters.<name>`, code `PARAMETER_REQUIRED`)   ← business_failure
  ↓
unmappedSourceKeys → logger.warn (omit + warn; offer still publishes)
  ↓
command.parameters = merged OfferParameter[]
```
**Gate-2 correctness (the wizard hazard):** projection's `unresolvedRequired` is computed from mappings only and is blind to operator-supplied params. To avoid a false `business_failure` on a valid wizard offer, the builder **subtracts operator-supplied parameter ids** (read from the legacy `platformParams.parameters`/`productParameters` `id` fields — ids only, no shaping) from `unresolvedRequired` before gating. When no mappings AND no operator params exist, an offer with required params correctly fails (AC2); a wizard offer where the operator supplied them passes.

### 3.4 Adapter = sole platform shaper
`AllegroOfferManagerAdapter.applyPlatformParams` gains a consumer for `cmd.parameters`:
- split by `section`: `'offer'` → `body.parameters[]`; `'product'` → `body.productSet[0].product.parameters[]` (inline path only — the `unique` smart-link branch still inherits product params from the card; **offer-section params from `cmd.parameters` are applied before the early-return**, mirroring today's `body.parameters`).
- **transition merge**: legacy `platformParams.parameters`/`productParameters` (FE wizard) still read; operator-supplied wins by `id`. (Removed in the FE-migration follow-up.)
- reuse `isAllegroOfferParameterShape` (it validates `id`/`values`/`valuesIds`; the extra `section` is ignored — stripped before attaching).

### 3.5 ADR record
Add a short note to **ADR-023 §Contract surface** (and a pointer from ADR-024): *projected/operator parameters travel as the neutral domain `OfferParameter[]` on `CreateOfferCommand.parameters`; the offer/product section split and wire-key naming live in the adapter; `platformParams` is reserved for un-modeled platform knobs.* Records the carriage decision that #1070 left implicit.

---

## 4. Step-by-step plan

1. **`listings/domain/types/offer-parameter.types.ts`** — new domain `OfferParameter` + barrel export. *AC: domain type, no app import.*
2. **`attribute-projection.types.ts`** — `parameters: OfferParameter[]`; `export type ResolvedParameter = OfferParameter` (deprecated alias). **`attribute-projection.service.ts`** — import the domain type. *AC: projection returns `OfferParameter[]`; existing spec passes unchanged.*
3. **`offer-create.types.ts`** — add `CreateOfferCommand.parameters?: OfferParameter[]` with doc. *AC: additive, optional.*
4. **`offer-builder.service.ts`** — inject `IAttributeProjectionService`; pass `sourceCategoryIds: product.categories` into `resolveCategory`; run projection after Gate 1; merge + Gate-2 (with operator-id subtraction); `logger.warn` unmapped; set `command.parameters`. *AC: AC1 + AC2; wizard offers with operator params don't false-fail Gate 2.*
5. **`allegro-offer-manager.adapter.ts`** — consume `cmd.parameters`, section-split, transitional merge with legacy keys (operator wins by id), smart-link product-param note + offer-params-before-early-return. *AC: command with `cmd.parameters` emits valid offer+product params; legacy FE path unchanged; `unique` path inherits product params.*
6. **Tests** — builder spec (sourceCategoryIds forwarded; projected → `command.parameters`; `unresolvedRequired` → `business_failure` with keys; operator-supplied subtracted from gate; unmapped → warn+build; projection not called when category null). Allegro adapter spec (`cmd.parameters` section-split; legacy precedence by id; `unique` drops product params, keeps offer params). Projection spec updated for the type alias (should be a no-op).
7. **ADR-023** §Contract-surface note + ADR-024 pointer.
8. **Quality gate** — rebuild libs (`pnpm -r --filter "./libs/**" build`), then `pnpm lint`, `pnpm type-check`, `pnpm --filter @openlinker/core test -- offer-builder attribute-projection`, `pnpm --filter @openlinker/integrations-allegro test -- offer-manager`, full `pnpm test`; `pnpm test:integration` listings create-offer slice. No migration.

---

## 5. Validation & Risks

- **ADR fidelity** ✅ — typed neutral currency (ADR-023:156 / ADR-024:89); platform shaping confined to the adapter (ADR-023 Decision); `business_failure` reuse (ADR-007). Carriage decision now recorded.
- **Risk — wizard false-fail (Gate 2)**: mitigated by operator-id subtraction (§3.3) + an explicit test.
- **Risk — Allegro regressions**: dual-channel transition with operator-wins-by-id; smart-link `unique` product-param drop is asserted, not accidental.
- **Risk — `ResolvedParameter` alias**: only internal references; alias keeps barrel + open PRs (#1070) compiling.
- **Risk — `Product.categories` empty (pre-#1034 syncs)**: resolution → manual → null → Gate-1 `business_failure` with an actionable message (correct).
- **Backward compat** ✅ — additive optional command field; no-mappings/no-attributes offers behave as today.

## 6. Follow-up issues (filed)
- **FE neutral parameter migration + single-channel collapse** — wizard emits neutral `OfferParameter[]` (section-tagged); delete `serializeAllegroParameters`; remove the legacy `platformParams.parameters`/`productParameters` path from the Allegro adapter so `cmd.parameters` is the sole channel. (Epic #1005, ADR-023/024.)
- **Shop-side carriage unification** — `PublishProductCommand` carries the neutral `OfferParameter`/`ListingParameter` list instead of `platformParams` (revisit #1070); the offer and shop sides share one parameter channel. (Epic #1005, ADR-024.)

## 7. Alignment checklist
- [x] Hexagonal boundary respected — platform split stays in the adapter
- [x] Reuses projection + resolution + `business_failure` plumbing; canonical neutral type modeled in domain
- [x] Ports/tokens via Symbol injection
- [x] No migration / no ORM change
- [x] Tests cover both gates, the wizard-subtraction, the adapter split, smart-link behavior
- [x] Carriage decision recorded in ADR-023; follow-ups filed for FE + shop unification
