# Implementation Plan — #486 Surface structured Allegro 422 errors

## 1. Goal

Turn the mute "Allegro API error (422): https://…" toast into an actionable, per-error, FE-rendered list with the same translator pipeline that #448 established for offer-create. Today the structured payload Allegro returns (with `code` / `message` / `userMessage` / `path`) is logged but never reaches the operator on the channel-publish surface.

## 2. Layer

Integration (Allegro adapter) → Interface (Content controller) → Frontend (publish UI). No domain port contract changes.

## 3. Non-goals (explicit)

- **No** auto-fixing of underlying offer state. `responsibleProducer` / `afterSalesServices` autobackfill is tracked separately (#487).
- **No** shipping a neutral cross-platform `ChannelPublishRejectedException` in core. Only one channel publisher exists today (Allegro). Defer the wrapping until a second adapter materialises.
- **No** new error-code translations beyond the two from this incident.
- **No** localisation toggles. Allegro's `userMessage` is Polish; show it verbatim (operators are PL-first).
- **No** deep-link "fix it" CTAs in the translator. Out of scope per issue (`translateAllegroError` would need a contract change).

## 4. Reuse map (codebase research)

| Existing artefact | Reused as |
|---|---|
| `AllegroValidationError` (`libs/integrations/allegro/src/domain/types/allegro-api.types.ts:508`) | The exception's typed `allegroErrors[]`. Issue's proposed `AllegroApiErrorEntry` is structurally identical — **do not introduce a parallel type**. |
| `parseAllegroErrors` (private in `AllegroOfferManagerAdapter`, line 1437) | Hoist into a pure helper exported from `infrastructure/http/`. The HTTP client and the offer-manager adapter both call it; today only the adapter does. |
| `mapValidationErrors` pattern (`AllegroOfferManagerAdapter:1429`) — `{ field: path, code, message: userMessage ?? message }` | Mirror this mapping in `ContentController.mapExceptions` so the FE wire format matches `OfferCreationError`. |
| `OfferCreationErrorList` (`apps/web/src/features/listings/components/`) + `translateAllegroError` (`features/listings/lib/`) | Extract list rendering into a `shared/ui/allegro-error-list.tsx` primitive (issue §4). Translator stays in `features/listings/lib/` for now — a follow-up can decide whether to move it to `shared/`. |
| `RESPONSIBLE_PRODUCER_NOT_SPECIFIED` translation (line 48 of `allegro-error-mapping.ts`) | **Already present.** Verified — no code change for this entry. |
| `ApiError.details: unknown` (`apps/web/src/shared/api/api-error.ts:3`) | Carries the full 422 response body. FE pulls `errors[]` off `details` — no new error class needed. |

## 5. Steps

### Step 1 — `parseAllegroErrorBody` shared helper
**File**: `libs/integrations/allegro/src/infrastructure/http/parse-allegro-error-body.ts` (new)
- Pure function: `(body: string | undefined, logger?: Logger) → AllegroValidationError[]`. Returns `[]` on null / parse failure / shape mismatch (no throw).
- Preserves the breadcrumb log when `logger` is passed (#409 / #416 contract).
- **Test** (`__tests__/parse-allegro-error-body.spec.ts`):
  - Empty / undefined body → `[]`
  - Malformed JSON → `[]` + warn logged when logger provided
  - Non-Allegro JSON shape (no `errors` key) → `[]`
  - Well-formed `{ errors: [...] }` → array passthrough

### Step 2 — Attach `allegroErrors` to `AllegroApiException`
**File**: `libs/integrations/allegro/src/domain/exceptions/allegro-api.exception.ts`
- Add `public readonly allegroErrors?: AllegroValidationError[]` to constructor.
- Import the type (cross-layer is OK: domain types are framework-free).

### Step 3 — Parse in the HTTP client chokepoint
**File**: `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts`
- In `handleError`, call `parseAllegroErrorBody(body, this.logger)` for the 4xx (line 459) and 5xx (line 445) branches.
- Pass result as 5th arg to `new AllegroApiException(...)`.
- 401 / 429 paths unchanged — they have their own exception types.
- **Test** (`__tests__/allegro-http-client.spec.ts` — extend existing): 422 with structured body → thrown exception's `allegroErrors` matches; 422 with garbage body → `allegroErrors === undefined`; 500 with structured body → also captured.

### Step 4 — Simplify `AllegroOfferManagerAdapter.createOffer`
**File**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts`
- Replace `parseAllegroErrors(error.responseBody)` (line 1056) with `error.allegroErrors ?? []`.
- Delete the now-unreferenced private `parseAllegroErrors` (lines 1437–1455).
- Existing `mapValidationErrors` stays — it converts Allegro shape → neutral `CreateOfferValidationError`.
- **Test**: existing offer-create specs must keep passing. Update tests that mock `error.responseBody` to also pre-set `error.allegroErrors` (since the HTTP client would have populated it).

### Step 5 — Map exceptions in `ContentController`
**File**: `apps/api/src/content/http/content.controller.ts`
- Add a branch in `mapExceptions`:
  ```ts
  if (error instanceof AllegroApiException) {
    if (error.statusCode === 422 && error.allegroErrors?.length) {
      throw new UnprocessableEntityException({
        message: 'Channel publish rejected by Allegro',
        code: 'CHANNEL_PUBLISH_FAILED',
        errors: error.allegroErrors.map((e) => ({
          field: e.path,
          code: e.code,
          message: e.userMessage ?? e.message,
        })),
      });
    }
    // Non-422 or no structured payload: surface as bad gateway.
    throw new BadGatewayException(error.message);
  }
  ```
- Imports `AllegroApiException` from `@openlinker/integrations-allegro` (already a dependency of `apps/api`).
- Wire format: `{ message, code, errors: Array<{ field?, code, message }> }` — matches `OfferCreationError` shape exactly so the FE renders both with one component.
- **Test** (`apps/api/src/content/http/__tests__/content.controller.spec.ts` — extend existing): publish path that throws `AllegroApiException` with `allegroErrors` → 422 body matches; without `allegroErrors` → 502; non-Allegro errors unchanged.

### Step 6 — Extract `AllegroErrorList` to `shared/ui/`
**File**: `apps/web/src/shared/ui/allegro-error-list.tsx` (new)
- Move the rendering logic verbatim from `OfferCreationErrorList.tsx` (38–58).
- Props: `{ errors: { field?: string; code: string; message: string }[] | null | undefined; className?: string }`.
- CSS class root: rename `.offer-creation-errors*` → `.allegro-error-list*` in `apps/web/src/index.css`.
- `apps/web/src/features/listings/components/OfferCreationErrorList.tsx`: keep the file as a thin pass-through (`<AllegroErrorList errors={errors} />`) so existing call sites and the test file don't need to move.
- Imports `translateAllegroError` from `features/listings/lib/` — this is the documented "features can be imported from shared via dependency injection? No, that's app→features." **Refactor decision**: move `translateAllegroError` to `apps/web/src/shared/lib/allegro-error-mapping.ts` so the shared primitive doesn't import from `features/`. The current `features/listings/lib/` location violates the dependency direction once a second feature consumes it.
- Update `OfferCreationErrorList.test.tsx` import path; add a new `allegro-error-list.test.tsx` covering structured-error rendering at the new location.

### Step 7 — Add the missing translation
**File**: `apps/web/src/shared/lib/allegro-error-mapping.ts` (moved from `features/listings/lib/` per Step 6)
- `RESPONSIBLE_PRODUCER_NOT_SPECIFIED` already present — verified line 48.
- Add `'ConstraintViolationException.AfterSalesServiceConditionsRequiredByCompany'` (full code with namespace prefix) → "Set after-sales policies (returns, warranty, implied warranty) on the connection-edit page or directly on the offer."
- Cover with a unit test if `allegro-error-mapping.test.ts` exists; otherwise add one.

### Step 8 — Render structured errors on content publish failure
**Files**: `apps/web/src/features/content/components/content-panel.tsx` + `content-editor.tsx`
- New helper `apps/web/src/features/content/lib/extract-allegro-errors.ts`:
  ```ts
  type StructuredErrors = Array<{ field?: string; code: string; message: string }>;
  export function extractAllegroErrors(err: unknown): StructuredErrors | null { ... }
  ```
  Reads from `ApiError.details` when shaped as `{ code: 'CHANNEL_PUBLISH_FAILED', errors: [...] }`. Returns `null` otherwise.
- `ContentPanel`: add `errors?: StructuredErrors | null` prop. When provided + non-empty, render `<AllegroErrorList errors={errors}>` ABOVE the bare-string `<Alert tone="error">`. When absent, behaviour is unchanged.
- `ContentEditor`: compute `const publishErrors = extractAllegroErrors(publishMutation.error)` and pass it through `ContentPanel.errors` for both master and channel panels.
- **Test** (`content-editor.test.tsx` — extend existing): mock publish to reject with `ApiError(422, { code: 'CHANNEL_PUBLISH_FAILED', errors: [...] })` → assert each error's `field` and translated message renders; reject with bare `Error('boom')` → assert bare string Alert renders.

## 6. Risks

- **R1 — Non-Allegro callers throwing `AllegroApiException`**: Adding the controller branch coupled to Allegro is fine while Allegro is the only channel adapter. If a second adapter ships later that throws its own `*ApiException` for offer-update, the controller will stop at the bare error. Mitigation: track in a follow-up issue with `// TODO: generalise to PlatformPublishError` comment in the controller.
- **R2 — Existing offer-create tests rely on `parseAllegroErrors` running inside the adapter** (Step 4 changes the source of `parsedErrors`). Mitigation: update specs to seed `error.allegroErrors` directly on the `AllegroApiException` they construct.
- **R3 — Renaming `.offer-creation-errors` → `.allegro-error-list` CSS class** could leak into per-route stylesheets. Mitigation: grep for `offer-creation-errors` outside the moved files before merge; rename all hits.
- **R4 — Moving `allegro-error-mapping.ts` to `shared/`** changes import paths in `OfferCreationErrorList.tsx`. Mitigation: single grep + rewrite, then `pnpm test` across the listings feature.

## 7. Acceptance criteria

- [ ] `AllegroApiException` carries `allegroErrors?: AllegroValidationError[]` populated by `AllegroHttpClient.handleError`.
- [ ] `AllegroHttpClient.handleError` parser is silent on malformed bodies (no throw, no log spam beyond the existing `formatBodyForLog` breadcrumb).
- [ ] Channel-publish 422 responses include `errors[]` with `{ field, code, message }`, mirroring offer-create.
- [ ] `AllegroErrorList` renders one row per error using `translateAllegroError`; field path appears in monospace; original Allegro `userMessage` collapsed to `<details>` when a translation exists.
- [ ] Both incident codes resolve to operator-actionable messages (`AfterSalesServiceConditionsRequiredByCompany` newly added; `RESPONSIBLE_PRODUCER_NOT_SPECIFIED` confirmed present).
- [ ] Unit tests cover: parser branches; controller mapping; FE structured render fallback.
- [ ] No backend port-contract changes (`OrderProcessorManagerPort`, `OfferManagerPort`, `ContentPublisherPort` unchanged).
- [ ] Quality gate: `pnpm lint && pnpm type-check && pnpm test` all green.

## 8. Out of scope (parking lot for follow-ups)

- Neutral `ChannelPublishRejectedException` in `libs/core/src/content/`.
- `AllegroErrorTranslation` extension with `cta: { label; href }` for deep-link buttons.
- Auto-prefilling sellerDefaults on PATCH (#487).
- Translations for codes not yet seen in production.
