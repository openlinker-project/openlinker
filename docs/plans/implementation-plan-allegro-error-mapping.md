# Implementation plan — translate Allegro misleading error codes (#448)

## 1. Goal

Replace Allegro's raw `userMessage` with operator-actionable text on the job-detail page when the offer-creation record carries a known Allegro error code. Keep the raw payload one click away. Pure FE work — the BE already forwards Allegro's structured `OfferCreationError { code, field?, message }` array via `OfferCreationStatusResponse.errors`.

**Layer:** Frontend only. No CORE / Integration / API changes.

**Non-goals:**
- Multilingual translation (English only — confirmed in issue).
- Telemetry on which Allegro errors fire most.
- BE side: extending `OfferCreationError` with structured `metadata.unknownProperties` (out of scope; would unlock a richer rendering for `UnknownJSONProperty` later).

## 2. Codebase research

- Page: `apps/web/src/pages/sync-jobs/sync-job-detail-page.tsx` is the "job detail" surface (route: `/jobs-logs`). Renders `OfferCreationTracker` when the job is a `marketplace.offer.create` carrying an `offerCreationRecordId`. `OfferCreationTracker` itself renders the structured errors via `OfferCreationErrorList` for the `failed` and `draft` branches.
- Render site: `apps/web/src/features/listings/components/OfferCreationErrorList.tsx` — for each `OfferCreationError` it renders `[field?] [message] [code]`. This is the one place that needs to consume the new mapping.
- Type: `apps/web/src/features/listings/api/listings.types.ts:136` defines `OfferCreationError { field?: string; code: string; message: string }`. The `field` is the Allegro path (e.g. `parameters.EAN`), `message` is Allegro's `userMessage`, `code` is the Allegro code we'll key on.
- Convention precedent for pure helper modules: `apps/web/src/features/listings/lib/allegro-seller-panel-url.ts` + co-located `*.test.ts`. The codebase uses **`lib/`** for pure derivation/lookup helpers; no `util/` directory exists anywhere under `features/`. The issue body suggested `util/` — flagged below.

## 3. Design

### File placement deviation

The issue specifies `apps/web/src/features/listings/util/allegro-error-mapping.ts`. The OpenLinker FE convention is `lib/` (every existing pure helper module lives in `features/<domain>/lib/`). I'll place the file at **`apps/web/src/features/listings/lib/allegro-error-mapping.ts`** alongside `allegro-seller-panel-url.ts`. This is a naming deviation from the issue, not a behavioural one — call out in the PR.

### Public surface

```ts
// apps/web/src/features/listings/lib/allegro-error-mapping.ts
import type { OfferCreationError } from '../api/listings.types';

/**
 * Friendly translation of a single Allegro error code into operator-actionable
 * text. Returns null when the code is not in our allowlist — callers fall
 * back to rendering Allegro's raw `userMessage` verbatim.
 */
export function translateAllegroError(error: OfferCreationError): string | null;
```

A function-valued mapping table — some translations interpolate `error.field` (e.g. `UnknownJSONProperty`), so a `Record<string, string>` would be too rigid. Keep the table local to the module so adding a code is a single edit.

### Render integration

Update `OfferCreationErrorList` to:
- Try `translateAllegroError(error)` first, render its result as the primary message text when non-null.
- When translated, append a collapsible `<details><summary>Allegro's original message</summary>{error.message}</details>` so the raw `userMessage` is one click away. The `field` and `code` mono badges stay where they are — they're already useful debugging context.
- When **not** translated, render `error.message` verbatim (existing behaviour preserved).

This keeps the visual structure identical for the unmapped path, satisfies the AC "raw error payload still accessible", and avoids the heavier `RawPayloadPanel` (which is a JSON viewer designed for top-level error blobs, not per-list-item supplements).

### Mapping table contents

Verbatim from the issue, with `error.field` interpolated only where meaningful:

| Code | Translation |
|---|---|
| `SAFETY_INFO_NOT_DEFINED` | "Allegro rejected the safety information for this category. Verify the discriminator (`type`) and re-save the connection's seller defaults. If the issue persists, the category likely requires a TEXT discriminator with substantive content rather than NO_SAFETY_INFORMATION." |
| `NO_SAFETY_INFORMATION_OPTION_NOT_ALLOWED` | "This category requires substantive safety information. Edit the connection and choose 'Provide safety information (text)' with category-relevant content (battery warnings, age restrictions, CE/RoHS, etc.)." |
| `UnknownJSONProperty` | "OpenLinker sent a field Allegro doesn't recognize${field ? \` at \\`${field}\\`\` : ''}. This is usually a regression in the OL Allegro adapter. Please file an issue with the offer id." |
| `RESPONSIBLE_PRODUCER_NOT_SPECIFIED` | "Configure a Responsible Producer entry in the connection's seller defaults." |
| `UnsupportedLanguageInAcceptLanguageHeader` | "OpenLinker sent an unsupported Accept-Language header. This is a regression — please file an issue." |

The "link to connection edit" part of the issue's `NO_SAFETY_INFORMATION_OPTION_NOT_ALLOWED` and `RESPONSIBLE_PRODUCER_NOT_SPECIFIED` rows is **deferred** for this PR — implementing it requires plumbing the connectionId into the error-list call site (currently only `record.errors` is passed) and deciding whether to deep-link with a hash anchor. The friendly message text by itself is high-value already; making the link clickable is a follow-up.

## 4. Step-by-step plan

### Step 1 — Add the lookup table

**File:** `apps/web/src/features/listings/lib/allegro-error-mapping.ts` (new)

- Export `translateAllegroError(error: OfferCreationError): string | null`.
- Internal `Record<string, (error: OfferCreationError) => string>` keyed on the 5 Allegro codes.
- File header per engineering-standards.

**Acceptance:** module is pure, no side effects, no imports beyond the `OfferCreationError` type.

### Step 2 — Tests for the lookup table

**File:** `apps/web/src/features/listings/lib/allegro-error-mapping.test.ts` (new)

- One test per mapped code asserting the friendly text.
- One test for `UnknownJSONProperty` with an `error.field` set, asserting the field is interpolated.
- One test for `UnknownJSONProperty` with no field (defensive), asserting the sentence reads correctly without it.
- One test for an unmapped code returning `null`.

**Acceptance:** `pnpm test` includes these and they pass.

### Step 3 — Wire the mapping into `OfferCreationErrorList`

**File:** `apps/web/src/features/listings/components/OfferCreationErrorList.tsx` (edit)

- Call `translateAllegroError(error)` per row.
- Primary message slot renders the translation when present, falls back to `error.message` otherwise.
- When translated, render a `<details>` with summary "Allegro's original message" containing the raw `error.message`.
- Field and code mono badges are unchanged.

**Acceptance:** existing tests for `OfferCreationErrorList` still pass (they assert on `MISSING_EAN` / `GENERIC_FAILURE` / `TOO_LONG` / `INVALID` — none of which are in the mapping table, so the fallback branch is exercised).

### Step 4 — New tests for the rendered behaviour

**File:** `apps/web/src/features/listings/components/OfferCreationErrorList.test.tsx` (edit)

- Add one test: a `SAFETY_INFO_NOT_DEFINED` error renders the friendly text and exposes the raw message in a collapsed `<details>`.
- Add one test: an unmapped code (e.g. `MISSING_EAN`, already covered by existing tests) does **not** render a `<details>` block — i.e. behaviour for unknown codes is byte-identical to today.

**Acceptance:** both new tests pass.

### Step 5 — Minimal CSS

**File:** `apps/web/src/index.css` (edit)

- `.offer-creation-errors__raw` (the `<details>` block): small top margin, muted summary text using `var(--text-muted)`, body text `0.8125rem` aligned with siblings.

**Acceptance:** no new tokens, all colour/size via existing CSS custom properties; lint passes.

### Step 6 — Quality gate

```
pnpm lint
pnpm type-check
pnpm test
```

**Acceptance:** zero errors. Existing test counts grow by exactly the new tests added in Steps 2 and 4.

## 5. Validation

- **Architecture:** pure FE feature, dep direction `pages → features → shared` preserved (the new module sits in `features/listings/lib`, only consumed by `features/listings/components`).
- **Naming:** `lib/` matches existing convention; module exports a `translate*` function in lower-camel, types reused.
- **Testing:** unit-test only (one mapping table + one component); no integration test needed.
- **Security:** no user input rendered as HTML, no `dangerouslySetInnerHTML`. The friendly strings are static literals; the only interpolation (`UnknownJSONProperty`) is `error.field` from the BE response, rendered as a React text node so it's escaped.

## 6. Risks & open questions

- **CTA links** (e.g. "Open connection edit page" for `RESPONSIBLE_PRODUCER_NOT_SPECIFIED`) are deferred. The friendly text is high-value standalone; the linkability is a follow-up because it requires plumbing the connection id through `OfferCreationErrorList`.
- **`UnknownJSONProperty.metadata.unknownProperties`**: the BE doesn't currently expose Allegro's metadata block. This PR doesn't add that — the friendly message just calls out that "OpenLinker sent a field Allegro doesn't recognize at `<path>`", which is enough to file a bug. Surfacing the verbatim list is a follow-up.
- **Naming deviation**: issue body says `util/`, project convention is `lib/`. Calling out in the PR description.
