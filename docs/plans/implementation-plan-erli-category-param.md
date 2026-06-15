# Implementation Plan — #985: Erli category & parameter mapping via Allegro-ID reuse (`source:"allegro"`)

**Date**: 2026-06-15 · **Status**: Ready for Review · **Effort**: M · **Branch**: `985-erli-category-param` (off `984-erli-offer-manager`) · **ADR**: ADR-025 §3 · Part of Wave-4 (see `implementation-plan-erli-wave4-orchestration.md`).

## 1. Task summary
Populate the Erli offer-create body (`POST /products/{externalId}`) with `externalCategories` + `externalAttributes` tagged `source:"allegro"`, reusing OL's **already-resolved Allegro category id + parameter ids** that ride on `CreateOfferCommand`. Erli processes only the `id` (names ignored — ADR-025 §3). No Erli-native taxonomy authoring. Lands in the `// #985:` seam at `erli-offer-manager.adapter.ts:134` + additive wire types in `erli-product.types.ts`. Unit tests only; no CORE change, no migration.

## 2. Key design question — RESOLVED (no new factory dep)
**Allegro ids arrive on the command** (verified):
- Category: `cmd.overrides.categoryId` (resolved by `OfferBuilderService` `offer-builder.service.ts:77-85,111`; Allegro adapter reads the same field `allegro-offer-manager.adapter.ts:1448,1469`).
- Parameters: `cmd.overrides.platformParams.parameters` (offer-section) + `…​.productParameters` (product-section), passed through verbatim by `OfferBuilderService:102,113-115`; entry shape `{ id; values?; valuesIds?; rangeValue? }` (`serialize-allegro-parameters.ts:45-50`).

The Erli adapter reads the **same command fields the Allegro adapter reads** → ADR-025 §3 reuse mandate. **Factory signature unchanged.**

## 3. Scope / non-goals
**In:** `ErliExternalCategory`/`ErliExternalAttribute` wire types; `externalCategories`/`externalAttributes` on `ErliProductCreateBody`; mapping in `buildCreateBody`; graceful "no Allegro data → list without taxonomy"; unit tests.
**Out:** Erli-native authoring (#978 §6.2); variants (#986); stock/price/frozen (#988); status (#989); PATCH-path category mapping (create-only — `buildPatchFromFields` untouched); factory change; any taxonomy fetch.

## 4. `erli-product.types.ts` additions (additive; provisional #992)
```typescript
export type ErliExternalAttributeType = 'dictionary' | 'string' | 'number';
export interface ErliExternalCategory { source: 'allegro'; id: string; }
export interface ErliExternalAttribute {
  source: 'allegro'; id: string; type: ErliExternalAttributeType; values: string[]; unit?: string;
}
// on ErliProductCreateBody (both optional, omitted when empty):
//   externalCategories?: ErliExternalCategory[];
//   externalAttributes?: ErliExternalAttribute[];
```
Designed so #986 (`externalVariantGroup`), #988 (stock/price/frozen), #989 (status) extend the same file without reshaping these.

## 5. `buildCreateBody` mapping
Replace the `// #985:` seam with two helpers; assemble after the barcode block (omit keys when empty):
- **`buildExternalCategories(cmd)`**: `cmd.overrides?.categoryId` non-empty → `[{source:'allegro', id}]`; else `[]`.
- **`buildExternalAttributes(cmd)`**: concat `platformParams.parameters` + `.productParameters` (Erli has one flat list — offer/product split irrelevant on Erli). Narrow each `unknown` entry with a guard mirroring `isAllegroOfferParameterShape` (`allegro-offer-manager.adapter.ts:127-139`): require non-empty `id: string`. Map: `valuesIds` non-empty → `{type:'dictionary', values:valuesIds}`; else `values` non-empty → `{type:'string', values}`; `rangeValue`-only → **dropped v1** (debug-logged); empty → skip. Pure module functions (style: `toErliPrice`).

## 6. "No Allegro data" handling
ADR-025 §3 / #978 §6.2 = no Erli-native fallback, **not** a hard create failure. No `categoryId` + no params → omit both keys; offer still creates (price/stock/title/barcode). Add one `logger.warn` ("no Allegro category; listing without taxonomy reuse — #985/#978 §6.2") for observability. Decision (Open Q2): graceful-omit + warn is the reversible low-risk default; if product wants hard-reject, add a one-branch `OfferCreateRejectedException` preflight.

## 7. Idempotency / errors
No new HTTP calls — one `POST {idempotent:true}` (`adapter:72`). `buildCreateBody` stays sync. Error mapping unchanged (`toCreateRejected` → `OfferCreateRejectedException`, no responseBody leak). Malformed param entries dropped silently (guard), never throw.

## 8. Unit tests (`erli-offer-manager.adapter.spec.ts`, assert on `post.mock.calls[0][1]`)
1. category mapping; 2. dictionary attr (`valuesIds`→type:dictionary); 3. string attr (`values`→type:string); 4. offer+product merge into one flat list; 5. **skip-case** (no data → no keys, offer still POSTs, status `'draft'`); 6. empty-attrs → key omitted; 7. malformed entry dropped; 8. `rangeValue`-only dropped; 9. regression: existing "basic fields" exact-match still holds.

## 9. Architecture / cross-context
No CORE change; types-only barrel imports from `@openlinker/core/listings` (no deep paths, no new cross-context import); all new shapes in `erli-product.types.ts` (single #992 point); no `any` (`unknown`+guard). Update file headers (`adapter:17-19`, `types:11-12`) — #985 taxonomy reuse now implemented (was listed out-of-scope).

## 10. Risks
- **R1 (#992-provisional):** field names/`type` set unconfirmed → isolated in `erli-product.types.ts`.
- **R2 (`type` set):** Erli may want `integer`/`float` (neutral `CategoryParameterType` has them) vs v1's `dictionary|string|number`; single change point (Open Q1).
- **R3 (ranges dropped):** rare; debug-logged.
- **R4 (skip-vs-error):** reversible (Open Q2).

## 11. Open questions
1. **`type` discriminator + ranges** (#992): does Erli accept only `dictionary|string|number`? how to express ranges? v1 defaults non-dict→string, drops ranges.
2. **Skip vs hard-error** when no Allegro category (product): v1 omits+warns.
3. **`unit` source** (#992 / issue author): command parameter entries do NOT carry `unit` (only neutral `CategoryParameter` metadata does, which the adapter never receives). So `ErliExternalAttribute.unit` is type-present but **unwired in v1**. Surface to the issue author — the issue's "optional unit" can't be honored from the command alone today.

## Related
- Wave-4 meta-plan · ADR-025 · #984 plan (`implementation-plan-erli-offer-manager.md`) · Spec #978 §6.2
