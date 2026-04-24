# Implementation Plan — Fix Allegro `POST /sale/product-offers` images[] shape (#387)

## 1. Understand the task

**Goal:** Stop Allegro from rejecting every offer create with 422 `JsonMappingException` on `images[0]`. The adapter sends `images: [{ url }]`, Allegro's current `POST /sale/product-offers` expects `images: string[]`.

**Classification:** Integration layer, bug fix. Single adapter + single type + one test assertion.

**Non-goals:**
- No changes to the `updateOfferFields` capability (doesn't write images today).
- No changes to image validation (size/count/format) — Allegro still owns that and returns `validation.errors`.
- No migration, no new port, no new API surface, no FE changes.
- Do not revisit the legacy `POST /sale/offers` endpoint — the shape `{ url }` came from there but is dead code for the current adapter.

## 2. Research — what already exists

- `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts:745-747` — wraps URLs in `{ url }`.
- `libs/integrations/allegro/src/domain/types/allegro-api.types.ts:334` — type encodes the wrong shape `Array<{ url: string }>`.
- `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts`:
  - `:516–529` — `baseCmd` already includes `imageUrls: ['https://example.com/img.jpg']`.
  - `:537–560` — the "draft status" path asserts the body via `toMatchObject` but never touches `images`. Every body-shape assertion in the suite omits `images` — that's how the bug slipped through.
  - `:689–706` — the "omits images" path is green and must stay green.
- Input contract: `CreateOfferCommand.overrides.imageUrls?: string[] | null` (core, already a string array).

No other adapter, service, or test references `images` with the wrapped shape.

## 3. Design

**Change 1 — type:** `AllegroProductOfferCreateRequest.images?: string[]` (was `Array<{ url: string }>`).

**Change 2 — adapter:** emit the array as-is.
```ts
if (cmd.overrides?.imageUrls && cmd.overrides.imageUrls.length > 0) {
  body.images = cmd.overrides.imageUrls;
}
```
No defensive copy — `body` is built once, serialised straight into the HTTP request, never mutated. The rest of `buildCreateOfferRequest` and `applyPlatformParams` already pass arrays through without copying.

**Change 3 — test:** add two positive assertions in the existing `createOffer` suite:
- single-URL `baseCmd` produces `body.images: ['https://example.com/img.jpg']` (catches the original bug)
- multi-URL fixture produces `body.images` equal to the input array verbatim (locks in order-preservation against future "improvements")

The "no images" path at `:689` already locks in the omission case — leave it untouched.

No other files need editing. No module rewiring, no DI changes.

## 4. Step-by-step

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/integrations/allegro/src/domain/types/allegro-api.types.ts:334` | `images?: string[];` | `pnpm type-check` green |
| 2 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts:745-747` | `body.images = [...cmd.overrides.imageUrls];` | adapter compiles against new type |
| 3 | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` — add one `it(...)` inside `describe('createOffer', …)` | Assert `expect(body).toEqual(expect.objectContaining({ images: ['https://example.com/img.jpg'] }))` for `baseCmd` | new test fails on current code, passes after steps 1-2; `:689` still green |
| 4 | Quality gate | `pnpm lint && pnpm type-check && pnpm test` | all green |

## 5. Validate

- **Architecture:** type + adapter only; no domain or application changes — no hexagonal boundary crossings.
- **Naming:** unchanged file names, unchanged class names.
- **Testing:** unit test at the adapter boundary, mocks the HTTP client (per `backend.md`: "mock ports and interfaces"). No integration-test impact.
- **Security:** image URLs are already caller-supplied; serialising them as strings instead of `{ url }` objects changes no trust boundary.
- **Migration / DB:** none.
- **Backwards compat:** `images` is an internal adapter-to-Allegro detail; no consumer outside the adapter reads it.

## Risks & open questions

- Allegro's docs could theoretically accept both shapes; error text strongly suggests they don't. Manual sandbox check after merge: POST an offer with at least one image URL and confirm 201/202 instead of 422.
- No concerns around multi-image payloads — the same transformation applies to every element.

## Verification

1. `pnpm --filter @openlinker/integrations-allegro test` — unit tests green.
2. `pnpm lint && pnpm type-check && pnpm test` — full quality gate.
3. Sandbox: trigger a `marketplace.offer.create` job on a connection with a variant that has images; confirm Allegro returns 201/202 and the adapter logs `status=active|draft` instead of `rejected`.

**Note:** `libs/integrations/allegro/dist/` carries the wrong type from the previous build. Anyone running locally against pre-built artifacts must `pnpm --filter @openlinker/integrations-allegro build` (or `pnpm build` at root) before manual sandbox testing, otherwise the bug appears to persist after the source is fixed. CI rebuilds from source, so this only affects local dev.
