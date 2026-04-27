# Implementation Plan — #415: Route product-section category parameters to `product.parameters`

## 1. Goal

Follow-up to #410. The create-offer wizard currently sends *every* category parameter under `body.parameters[]` on Allegro's `POST /sale/product-offers`. Allegro splits parameters into two sections — **offer-section** (free-text fields, condition, EAN, etc.) and **product-section** (Brand, Model, Manufacturer-code, etc.) — and rejects offers where product-section parameters appear in `body.parameters` with `ParameterCategoryException`. This plan routes product-section parameters to `body.product.parameters[]`. The wizard UI does not change — operators still fill one unified list; the split happens at submit time.

## 2. Layer classification

| Layer | Change |
|---|---|
| **CORE** | Extend `CategoryParameter` neutral type with required field `section: 'offer' \| 'product'`. |
| **Integration (Allegro)** | Mapper reads `options.describesProduct`. Adapter's `applyPlatformParams` routes `platformParams.productParameters` to `body.product.parameters`. |
| **Interface (API)** | Extend `CategoryParameterResponseDto` to expose `section` over the wire (else the FE never sees it). The request-side `platformParams` stays `Record<string, unknown>`. |
| **Frontend** | Serializer returns two arrays. Wizard submit merges both into `platformParams`. Retry reverse-mapper reads both keys. |
| **DX** | None — no migrations, no env vars. |

## 3. Non-goals

- **No** linking offers to existing Allegro products (so brand/model are inherited rather than typed). Tracked separately.
- **No** auto-mapping of product-section params from OL master attributes (brand-from-PrestaShop, etc.). Belongs to #412.
- **No** wizard layout change — required-first / optional-collapsed groups stay one unified list. Operators don't see the split.
- **No** new fixture capture — the bundled `category-parameters-257933.json` already contains `Marka` (id 248811) with `options.describesProduct: true`, which is sufficient for mapper-level tests. (Capturing cat 257932 is a polish item that can ride on a follow-up if we want richer coverage.)

## 4. Design

### 4.1 Source-of-truth flag

Allegro's raw `GET /sale/categories/{id}/parameters` response carries `options.describesProduct: boolean` per parameter. From the bundled fixture:

```json
{
  "id": "248811",
  "name": "Marka",
  "type": "dictionary",
  "required": true,
  "requiredForProduct": true,
  "options": { "describesProduct": true, "customValuesEnabled": false }
}
```

`requiredForProduct` is a separate field that we deliberately do *not* surface on the neutral type — it's only meaningful to Allegro's product-catalog flow, which we don't use yet. The single `section: 'offer' | 'product'` flag derived from `options.describesProduct` is enough for the create-offer wire-shape decision.

### 4.2 Wire-shape change (Allegro `POST /sale/product-offers`)

| Before | After |
|---|---|
| `body.parameters: AllegroOfferParameter[]` (everything) | `body.parameters: AllegroOfferParameter[]` (offer-section only) |
| (no `body.product` key) | `body.product?: { parameters: AllegroOfferParameter[] }` (product-section only, omitted when empty) |

`applyPlatformParams` reads two distinct keys from `platformParams`:
- `platformParams.parameters` → `body.parameters`
- `platformParams.productParameters` → `body.product = { parameters: ... }`

Each goes through the same `isAllegroOfferParameterShape` validator. No new wire shape — both arrays use the existing `{ id, values?, valuesIds?, rangeValue? }` envelope.

### 4.3 FE serializer split

`serializeAllegroParameters` returns:

```ts
export interface SerializedParameters {
  offerParameters: AllegroParameterInput[];
  productParameters: AllegroParameterInput[];
}
```

The function loops parameters in metadata order (preserving stable submission order per existing test invariant) and routes each to the appropriate array based on `param.section`. Empty / hidden values continue to be dropped silently.

### 4.4 FE retry reverse-mapper

`readParameters` (in `create-offer-request-to-form-values.ts`) extends to read both `params.parameters` and `params.productParameters`, merging into the flat form-state map keyed by parameter id. The form doesn't track section — re-submission re-derives the split from the freshly-loaded category-parameters metadata.

## 5. Step-by-step plan

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/core/src/listings/domain/types/category-parameter.types.ts` | Add `CategoryParameterSectionValues` (`as const`) + `CategoryParameterSection` type. Add `section: CategoryParameterSection` field to `CategoryParameter`. | Type compiles, exported from barrel. |
| 2 | `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` | Confirm/extend `AllegroCategoryParametersResponse` shape so `options.describesProduct?: boolean` is reachable. | TypeScript reads the field cleanly. |
| 3 | `libs/integrations/allegro/src/infrastructure/mappers/allegro-category-parameter.mapper.ts` | Map `raw.options?.describesProduct === true ? 'product' : 'offer'` into `section`. | Mapper sets the field on every output. |
| 4 | `libs/integrations/allegro/src/infrastructure/mappers/__tests__/allegro-category-parameter.mapper.spec.ts` | Assert `section: 'product'` for `Marka` (id 248811). Assert `section: 'offer'` for at least one parameter without the flag. | Tests pass; both branches covered. |
| 5 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` | Extend the create-offer body type (or local interface) to include optional `product?: { parameters?: AllegroOfferParameter[] }`. Update `applyPlatformParams` to read `platformParams.productParameters` and write to `body.product.parameters`. Filter through `isAllegroOfferParameterShape`. | Both `body.parameters` and `body.product.parameters` populated correctly. `body.product` omitted when empty. |
| 6 | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` | New test: given `platformParams.productParameters = [...]`, the request body has `body.product.parameters` set and `body.parameters` is unchanged. Edge case: empty product array → no `body.product` key emitted. | Both branches covered. |
| 7 | `apps/api/src/listings/http/dto/category-parameter-response.dto.ts` | Add `section` field to the response DTO with `@ApiProperty({ enum: CategoryParameterSectionValues })`. Update the controller's projection helper (`toCategoryParameterResponseDto` in `listings.controller.ts`) to copy `param.section` into the response. | DTO Swagger reflects the field; controller passes it through; FE receives the value over the wire. |
| 8 | `apps/web/src/features/listings/api/listings.types.ts` | Mirror the new `section: 'offer' \| 'product'` field on the FE `CategoryParameter` type. Add `CategoryParameterSectionValues` runtime array. | Type lines up with the wire shape from the API. |
| 9 | `apps/web/src/features/listings/components/serialize-allegro-parameters.ts` | Change return type to `{ offerParameters, productParameters }`. Route each parameter by its `section` field. | Existing serializer tests updated; new tests assert the split. |
| 10 | `apps/web/src/features/listings/components/serialize-allegro-parameters.test.ts` | Update existing assertions to read `.offerParameters`. Add a test where one parameter is product-section and asserts both arrays. | All cases pass. |
| 11 | `apps/web/src/features/listings/components/CreateOfferWizard.tsx` | Update submit handler to set `platformParams.parameters` from `offerParameters` and `platformParams.productParameters` from `productParameters`. Omit empty arrays. | Submit payload carries both keys when both are non-empty. |
| 12 | `apps/web/src/features/listings/components/create-offer-request-to-form-values.ts` | Extend `readParameters` to also read `params.productParameters`. Merge into the same flat form-state map. | Retry pre-fill round-trips both sections. |
| 13 | `apps/web/src/features/listings/components/create-offer-request-to-form-values.test.ts` | Add two tests: snapshot with **`productParameters` only** → surfaced into form state. Snapshot with **both `parameters` and `productParameters`** → both merged correctly with no array dropped. | Edge cases covered. |
| 14 | `apps/web/src/features/listings/components/CreateOfferWizard.test.tsx` | Existing happy-path test (auto-prefill + serializer wiring) gets a product-section parameter added. Asserts `platformParams.productParameters` carries it and `platformParams.parameters` does not. | One test exercises the end-to-end split. |
| 15 | All — quality gate | `pnpm lint` (0 errors), `pnpm type-check` (clean), `pnpm test` (all packages green). | Quality gate passes. |

## 6. Tests-of-record

After this work, the question *"does serialization correctly route Brand to `productParameters`?"* must be answered by:

- **Mapper spec** (step 4) — Allegro flag → neutral `section`.
- **Serializer spec** (step 10) — neutral `section` → wire-shape split.
- **Adapter spec** (step 6) — wire-shape split → request body shape.
- **Wizard test** (step 14) — end-to-end wiring through the wizard.

## 7. Validation

- **Hexagonal compliance** — change is layered cleanly; CORE owns the contract, Allegro adapter owns the dialect, FE owns the form mapping. ✅
- **Naming** — `as const` + union per engineering-standards; default `section: 'offer'` keeps the type tractable for non-Allegro adapters. ✅
- **Headers** — every modified file already has a JSDoc header; no new files. ✅
- **Tests** — every behavioral change has a spec; the wizard test guards regression of the wire-payload split. ✅
- **Security** — no new secrets, no auth surface changes; `platformParams` size validator (4 KB) on the API DTO continues to apply. ✅
- **Migrations** — none. ✅

## 8. Risks & open questions

- **Resolved**: Pre-implementation grep confirmed `body.product` is **not** referenced anywhere in `allegro-offer-manager.adapter.ts`, so the new write is a clean greenfield assignment — no merge logic needed.
- **Resolved**: Pre-implementation grep confirmed `serializeAllegroParameters` has exactly one production caller (`CreateOfferWizard.tsx:470`) plus its co-located spec — no hidden consumers to update.
- **Risk (low)**: Allegro may also reject `body.product = { parameters: [] }` (empty array). Mitigation: omit the entire `body.product` key when no product-section params are present (step 5 acceptance criterion).
- **Risk (low)**: an existing connection has stored `platformParams.parameters` containing product-section IDs from before this fix (i.e. a failed-record snapshot). The retry path's `readParameters` cannot distinguish offer- vs. product-section without the metadata, so we route everything into the form state and let the next submit re-split using the fresh metadata. No data loss, no regressions.

## 9. Out of scope (explicitly deferred)

Same list as the issue body — repeated here for completeness:

- Linking to existing Allegro products
- Auto-mapping product-section params from OL master attributes (#412)
- Improving the truncated `userMessage` in the adapter log (#408)
