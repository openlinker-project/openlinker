# Implementation Plan — #419: Route product-section parameters to `body.productSet[].product.parameters`

## 1. Goal

Follow-up to #415 (which was a follow-up to #410). The #415 fix routed product-section category parameters to `body.product.parameters[]` on Allegro's `POST /sale/product-offers`, but Allegro 422s with `UnknownJSONProperty: { unknownProperties: "product" }` — the POST contract does not accept a top-level `product` key.

The existing GET-side type `AllegroProductOffer` exposes product-level parameters under `productSet[].product.parameters`, and Allegro's POST API mirrors that shape. This plan moves the wire-shape destination from `body.product.parameters` to `body.productSet[0].product.parameters`. The CORE / FE / serializer layers from #415 are correct and untouched — only the adapter's target field is wrong.

## 2. Layer classification

| Layer | Change |
|---|---|
| **CORE** | None — `CategoryParameter.section` flag is correct. |
| **Integration (Allegro)** | Replace `body.product?: { parameters?: … }` with `body.productSet?: Array<{ product?: { name?: string; parameters?: AllegroOfferParameter[] } }>` on the create-offer body type. Update `applyPlatformParams` to write to `body.productSet[0].product.parameters` and to forward `body.name` as `productSet[0].product.name` (Allegro requires `name` when creating an inline product). |
| **Interface (API)** | None. |
| **Frontend** | None. |
| **DX** | None. |

## 3. Non-goals

- **No** linking offers to existing Allegro product IDs (the "smart-link" flow). The wizard sends inline product details; Allegro's catalog handles matching/creation server-side.
- **No** wizard UI change — operators still fill one unified list.
- **No** changes to the neutral `CategoryParameter.section` field, the FE serializer, the wizard, the API DTO, or the retry reverse-mapper.
- **No** new fixture capture — `category-parameters-257933.json` already covers cameras with multiple product-section parameters (Marka, Model, Rozdzielczość, etc.).

## 4. Design

### 4.1 Wire-shape change (Allegro `POST /sale/product-offers`)

| Before (#415, broken) | After (#419) |
|---|---|
| `body.product?: { parameters?: AllegroOfferParameter[] }` (rejected — `UnknownJSONProperty`) | `body.productSet?: Array<{ product?: { name?: string; parameters?: AllegroOfferParameter[] } }>` (matches the GET shape Allegro already documents). |

When `platformParams.productParameters` is non-empty, the adapter emits:

```json
{
  "productSet": [{
    "product": {
      "name": "<body.name>",
      "parameters": [
        { "id": "248811", "valuesIds": ["248811_canon"] }
      ]
    }
  }]
}
```

`body.parameters[]` (offer-section) is unchanged.

### 4.2 Why `productSet[0].product.name` from `body.name`

Allegro's POST contract requires `productSet[].product.name` when creating an inline product (no existing `product.id` to inherit from). The wizard already validates `body.name` (the offer title) at `≤ 75 chars`; reusing it as the product name is the simplest non-broken default. If a future iteration wants distinct offer / product names, it can split them — `body.name` as product name is a safe MVP default.

> **MVP coupling note** — the adapter implementation should carry an inline comment flagging that `productSet[0].product.name = body.name` is a deliberate MVP coupling, not a long-term contract. The smart-link / catalog-matching follow-up (#412) is the natural place to revisit it; until then, callers must treat the offer title as also being the product name.

### 4.3 Empty-array semantics

Allegro 422s on `productSet: []` and on `productSet: [{ product: { parameters: [] } }]` exactly the same way it did on `product: { parameters: [] }`. Continue to **omit `body.productSet` entirely** when there are zero product-section parameters after shape-filtering.

> **Carried-over assumption** — the empty-rejection behaviour is inherited from #415 and was itself never directly verified against `productSet[]`. We are mirroring the same omit-when-empty rule because (a) it kept the offer-section path safe in #415, and (b) sending an empty `productSet[0].product.parameters` when there are no product-section params would also force us to invent a `productSet[0].product.name` for an otherwise empty product, which has no business meaning. If the manual sandbox repro in §5 / §6 surfaces a contradicting behaviour (e.g. Allegro requires `productSet` to be present even when offer-section-only), we revisit this here.

## 5. Step-by-step plan

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` | Replace the `product?: { parameters?: AllegroOfferParameter[] }` field on `AllegroProductOfferCreateRequest` with `productSet?: AllegroProductSetEntry[]`, and introduce a named `AllegroProductSetEntry` interface (`{ product?: { name?: string; parameters?: AllegroOfferParameter[] } }`) co-located with the existing `AllegroOfferParameter` alias. Update the JSDoc on the productSet field; remove the now-stale comment that calls out `body.product`. | Type compiles; `body.productSet` is reachable, `body.product` is no longer a permitted key on the request type, and `AllegroProductSetEntry` is reusable from the adapter spec. |
| 2 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` | In `applyPlatformParams`, replace the `body.product = { ..., parameters: filtered }` write with `body.productSet = [{ product: { name: body.name, parameters: filtered } }]`. Keep the empty-array omission and the `isAllegroOfferParameterShape` filter. Update the inline comment to reference #419 and `productSet`. | Adapter writes the correct shape; `body.product` no longer appears in any request payload. |
| 2.1 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` (added in commit 2 — sandbox-driven) | After the image-upload step in `createOffer` rewrites `body.images` to Allegro CDN URLs, mirror that array onto `productSet[0].product.images`. Allegro requires `productSet[].product.images` (≥1) when creating an inline product — confirmed by sandbox repro returning `ProductValidationException` at path `productSet[0].product` when omitted. The mirror **must** happen post-upload because `applyPlatformParams` runs against pre-upload operator URLs which Allegro rejects. Type extends `AllegroProductSetEntry.product` with `images?: string[]`; spec adds a fourth branch ("omits product.images when offer-level images are empty") covering the wizard-precondition failure path. | `body.productSet[0].product.images` carries the post-upload CDN URL array; sandbox `productSet[0].product` no longer rejects on missing images. |
| 3 | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` | Update the three #415 tests under `describe('product-section parameters …')`: assertions move from `body.product.parameters` → `body.productSet[0].product.parameters`. Add an assertion that `productSet[0].product.name` equals the offer title. Refresh the empty-array test to assert `body.productSet` is absent. | All three branches still covered, now against the correct wire shape. |
| 4 | `docs/architecture-overview.md` (Listings entry) | Update the one-paragraph note added in #415 to say `body.productSet[].product.parameters` rather than `body.product.parameters`. | Docs reflect reality. |
| 5 | All — quality gate | `pnpm lint` (0 errors), `pnpm type-check` (clean), `pnpm test` (all packages green). | Quality gate passes. |
| 6 | Manual sandbox repro — **hard merge gate** | **Before merging the PR**, retry offer creation against cat 257933 with required product-section params filled. Expect `active` / `validating` (no `UnknownJSONProperty`, no `ParameterCategoryException`). | This is the actual definition of "fixed". The unit tests can only confirm the wire shape is what we *intended*; only Allegro can confirm the wire shape is what they *accept*. #415 demonstrated that "tests green + plausible-looking shape" was insufficient evidence — we shipped a fix that Allegro rejected on first contact. This time the sandbox round-trip must be confirmed before the PR merges, not as a fast-follow. If the sandbox round-trip surfaces a *new* missing field (e.g. `productSet[0].product.category`), address it inside this PR rather than chaining another follow-up. |

## 6. Tests-of-record

Same 4-test layering established in #415 — only the adapter spec assertion moves:

- **Mapper spec** — Allegro flag → neutral `section`. (unchanged)
- **Serializer spec** — neutral `section` → wire-shape split. (unchanged)
- **Adapter spec** — wire-shape split → request body shape. (assertion moves to `body.productSet[0].product.parameters`)
- **Wizard test** — end-to-end wiring through the wizard. (unchanged — it asserts on `platformParams.productParameters`, not on the adapter-side body)

## 7. Validation

- **Hexagonal compliance** — change is purely inside the Allegro infrastructure adapter; CORE / FE / API DTO untouched. ✅
- **Naming** — no new types, no new files. The existing `AllegroOfferParameter` named alias continues to back both offer-side and product-side wire entries. ✅
- **Headers** — every modified file already has a JSDoc header. ✅
- **Tests** — the adapter spec change keeps the same three branches (populated / empty-omits / malformed-filtered) but against the correct field. ✅
- **Security** — no new secrets, no auth changes. The 4 KB `platformParams` size validator on the API DTO continues to apply transparently. ✅
- **Migrations** — none. ✅

## 8. Risks & open questions

- **Allegro requires more than `name + parameters` on `productSet[0].product`** — confirmed by sandbox repro: Allegro 422'd with `ProductValidationException` at path `productSet[0].product` saying *"At least one image should be attached to add product."* (`Wymagane jest co najmniej 1 zdjęcie`). Fixed inside this PR by mirroring the post-upload `body.images` onto `productSet[0].product.images` after the image-upload step (the mirror **must** happen post-upload — operator URLs would be rejected by Allegro). The same loop applies if Allegro surfaces yet another missing field on the next round-trip: address it here, not in a fast-follow. The "ship and follow up" pattern is what produced #419 in the first place; we are explicitly closing that loop.
- **Allegro creates duplicate products on each offer** — possible, but that's Allegro's catalog matching problem, not ours. If we observe duplicates accumulating in the seller's product catalog, the answer is the smart-link flow (out of scope here) — not changing the request shape.
- **Wizard cache** — the FE caches the categoryParameters response for 24 h. Operators with stale caches won't see any difference (the response shape didn't change). No invalidation needed.

## 9. Out of scope (explicitly deferred)

- Linking offers to existing Allegro product IDs (smart-link inheritance).
- Auto-mapping product-section params from OL master attributes (#412).
- Splitting offer-name vs product-name UX in the wizard.
