# Implementation Plan — #420: Allegro name-field Unicode-punctuation sanitizer

## 1. Goal

Allegro's `POST /sale/product-offers` rejects offers when `productSet[0].product.name` (mirrored from `body.name`) contains characters its product-name validator considers invalid — confirmed for em-dash (U+2014) by the #419 sandbox repro:

```
ProductValidationException: Product name contains invalid characters — - Em Dash [61]
path: productSet[0].product
```

The product-name validator is stricter than the offer-name validator and likely rejects other Unicode punctuation too (en-dash, curly quotes, ellipsis). The fix is a small Allegro-adapter sanitizer — symmetric to the existing `sanitizeAllegroDescription` — that ASCII-normalizes operator-supplied names before they reach Allegro's wire. The sanitizer is applied at every adapter site that writes a `name` field destined for Allegro, so the same class of failure cannot re-emerge from a different code path (offer create, offer field update, inline-product mirror).

The util is named **`sanitizeAllegroName`** (not `…ProductName`) because it covers all three `name` write sites: offer-section `body.name` on POST, `productSet[0].product.name` on POST (inline product), and `body.name` on PATCH. Two of three are technically offer-name fields, not product-name fields — the neutral name reflects the actual scope.

## 2. Layer classification

| Layer | Change |
|---|---|
| **CORE** | None — sanitization is per-platform; CORE keeps the operator-supplied title untouched. |
| **Integration (Allegro)** | New util `sanitizeAllegroProductName` co-located with `sanitizeAllegroDescription`. Wire into `AllegroOfferManagerAdapter` at three sites: `buildCreateOfferRequest` (writes `body.name`), `applyPlatformParams` (mirrors `body.name` onto `productSet[0].product.name`), and `updateOfferFields` (writes `body.name` on PATCH). |
| **Interface (API)** | None — the 75-char cap stays on the existing DTOs (`create-offer.dto.ts` + `update-offer-fields.dto.ts`). |
| **Frontend** | None for this slice — operator-side warn-on-banned-char hint is deferred (issue body explicitly flags it as optional). The sanitizer is a defense-in-depth backstop the adapter must always apply, irrespective of whether the FE warns. |
| **DX** | None. |

## 3. Non-goals

- **No** wizard / FE warning for banned characters at edit time (issue body §Scope flags as "optional"). The adapter sanitizer is the sole gatekeeper for #420.
- **No** length truncation in the sanitizer. The 75-char cap is enforced upstream in four places (`create-offer-fields.schema.ts`, `edit-offer-fields.schema.ts`, `create-offer.dto.ts`, `update-offer-fields.dto.ts`). If sanitization expands a string past 75 chars (e.g. `"…"` → `"..."` adds 2 chars), Allegro returns a length-specific 422 which is operator-meaningful — silent truncation would produce `"Aparat cyfrowy CANO..."`-style mid-word cuts which are worse UX.
- **No** sanitization of other free-text fields (description already has its own sanitizer; descriptions accept Unicode that names don't).
- **No** Allegro-side discovery of the full banned char list. We sanitize **only the set enumerated in the issue body** — em-dash (empirically confirmed) plus the issue's "likely also" list (en-dash, curly quotes, ellipsis). If Allegro rejects an additional char in sandbox/production, the map is a one-line append; extend then. The description sanitizer followed the same iterative-rejection loop.

## 4. Design

### 4.1 Banned characters and replacements

The sanitizer maps Unicode punctuation to ASCII equivalents. Empirically-confirmed minimum is em-dash (U+2014); the rest of the table is exactly the issue body §Open-questions enumerated set.

| Unicode | Char | Codepoint | Replacement | Reason |
|---|---|---|---|---|
| Em dash | `—` | U+2014 | ` - ` (space-hyphen-space) | **Confirmed by sandbox 422.** Mirrors the way Allegro's userMessage formatter joins fields. |
| En dash | `–` | U+2013 | `-` | Adjacent dash variant; issue body "likely also". |
| Left single quote | `‘` | U+2018 | `'` | TinyMCE / Word smart-quote source; issue body "likely also". |
| Right single quote | `’` | U+2019 | `'` | Same. |
| Left double quote | `“` | U+201C | `"` | Same. |
| Right double quote | `”` | U+201D | `"` | Same. |
| Horizontal ellipsis | `…` | U+2026 | `...` | Smart-ellipsis; issue body "likely also". |

Constants are exported as `BANNED_NAME_CHAR_MAP` (a `Record<string, string>`) so future additions are a one-line append and the test suite can iterate the map directly. The em-dash → ` - ` replacement is the only multi-char mapping; the rest are 1:1 substitutions, so the sanitizer never *expands* common inputs by more than +2 chars (one ellipsis worst case).

After substitution the sanitizer collapses **all runs of internal whitespace** to single spaces and trims leading/trailing whitespace. This is a deliberate widening of the substitution rule — it cleans up not just the double-spacing the em-dash → ` - ` rule could introduce (`"a — b"` → `"a - b"`, not `"a  -  b"`), but also pre-existing operator-typed double-spaces in titles. Allegro's name validators do not require collapsed whitespace, so this is a UX nicety, not a correctness requirement; flagged here as an explicit divergence from `sanitizeAllegroDescription` which preserves all whitespace.

### 4.2 Why ASCII normalization (not drop, not throw)

Three options were enumerated in the issue body §Open questions. Picking ASCII normalization because:

1. **Lowest operator friction.** Title content is preserved; the operator doesn't have to manually fix every PrestaShop-side punctuation paste.
2. **Idempotent.** Sanitizing already-clean ASCII is a no-op — round-tripping through the adapter never mutates a clean title.
3. **Symmetric to `sanitizeAllegroDescription`.** That util also lossily normalizes (strips disallowed tags, preserves inner text). Same shape of contract.
4. **Backstop, not gate.** A "throw on banned char" path forces operator action mid-flow with no automated remediation — exactly the experience the wizard is trying to avoid for marketplace-specific quirks.

The trade-off: if Allegro adds a *new* banned char we don't know about, the sanitizer leaves it in place and Allegro 422s. That's the same place we are today, just with a smaller surface — and the next iteration extends the map.

### 4.3 Where the sanitizer is applied

Two **operator-input boundaries** in `AllegroOfferManagerAdapter` — every place an operator-supplied name string enters the request body:

| Site | Field written | Why sanitize |
|---|---|---|
| `buildCreateOfferRequest` (line 849: `body.name = name`, where `name = cmd.overrides?.title`) | `body.name` (offer-section title) | The offer-name validator is *probably* more lenient than the product-name one (the #419 sandbox repro got past `body.name` and 422'd on `productSet[0].product.name`), but applying the same sanitization is the conservative default per the issue body and prevents a future tightening of the offer-name validator from re-creating the same class of bug. |
| `updateOfferFields` (line 640: `body.name = cmd.fields.title`) | `body.name` on `PATCH /sale/product-offers/{offerId}` | Same Allegro-side validator, different HTTP verb. Operator-driven title edits should hit the same gate. |

The third name write in the adapter — `applyPlatformParams` (line 957: `productSet[0].product.name = body.name`) — does **not** sanitize again. By the time `applyPlatformParams` runs, `body.name` was already sanitized at site #1 in `buildCreateOfferRequest` (which calls `applyPlatformParams` further down the same function). The plan keeps a single sanitization point per request lifecycle to avoid the "why is this being sanitized — wasn't it already?" reader confusion. The dependency is documented by an inline comment at the productSet write: *"`body.name` is already sanitized in `buildCreateOfferRequest`; no re-sanitization needed."*

Pattern: each operator-input site reads the supplied title once and passes it through `sanitizeAllegroName(...)` before the assignment.

### 4.4 Empty-after-sanitization edge case

If the operator's title is `"…"` (literal ellipsis, no other content), it sanitizes to `"..."` — 3 chars, non-empty. So the precondition stays valid.

The pathological case is a title that is *only* banned chars that map to *empty*. Today none of our mappings are empty (no character in the table is replaced with `""`), so the sanitizer cannot produce an empty result from a non-empty input. If a future banned char is mapped to `""` (e.g. zero-width space), the precondition check on lines 836-840 (`name.trim().length === 0`) must run *after* sanitization — addressed by sanitizing before the precondition check in step 2 below.

### 4.5 What the sanitizer does NOT do

- **Does not cap length** — see §3 non-goal #2.
- **Does not strip HTML tags** — names should not contain HTML; the wizard schema enforces plain text.
- **Does not lowercase / case-fold** — preserves operator casing.
- **Does not replace ASCII characters** — only Unicode punctuation defined in the map.
- **Does not run any validation/throw** — purely transformational. Validation stays at the DTO / Zod layer.

## 5. Step-by-step plan

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/integrations/allegro/src/infrastructure/util/sanitize-allegro-name.ts` (new) | Create util exporting `sanitizeAllegroName(name: string): string` and `BANNED_NAME_CHAR_MAP`. Implementation: `[...str].map(ch => MAP[ch] ?? ch).join('').replace(/\s+/g, ' ').trim()`. JSDoc header per `engineering-standards.md` §File Headers, plus a paragraph linking to the sandbox 422 evidence and explaining the ASCII-normalization choice + the "covers offer-name and product-name fields" naming rationale. | Util compiles, exported from the module, no framework imports (pure infrastructure helper). |
| 2 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` | (a) Add import for `sanitizeAllegroName`. (b) In `buildCreateOfferRequest`, sanitize `cmd.overrides?.title` *before* the empty-precondition check, then assign sanitized value to `body.name`. (c) In `updateOfferFields`, sanitize `cmd.fields.title` before the `body.name = ...` assignment. (d) Add an inline comment at the `applyPlatformParams` `productSet[0].product.name = body.name` line documenting that `body.name` arrives already sanitized — no re-sanitization. (e) At each operator-input site (b + c), emit a `this.logger.debug(...)` line when `sanitized !== original`, surfacing the operator-typed and wire-bound titles for ops debugging. (f) Brief inline `#420` references at each site. | Adapter writes ASCII-normalized names at both operator-input sites; productSet write reads already-sanitized `body.name`. Logs surface mutation events. No regressions in existing 169 spec branches. |
| 3 | `libs/integrations/allegro/src/infrastructure/util/__tests__/sanitize-allegro-name.spec.ts` (new) | Unit tests: (a) em-dash → ` - ` (the sandbox-failing case); (b) en-dash, curly quotes (left/right single, left/right double), ellipsis individual coverage; (c) idempotency on clean ASCII input; (d) plain-text passthrough; (e) whitespace collapse including pre-existing operator double-spaces (the explicit divergence from `sanitizeAllegroDescription`); (f) trim of leading/trailing whitespace; (g) preserves operator casing; (h) handles empty string; (i) full-table coverage by iterating `BANNED_NAME_CHAR_MAP`. | All branches pass; full table coverage. Mirrors the structure of `sanitize-allegro-description.spec.ts`. |
| 4 | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` | Add four end-to-end branches: (a) `body.name` is sanitized on offer create when title contains em-dash; (b) `productSet[0].product.name` reads the already-sanitized `body.name` when product-section parameters trigger productSet creation (asserts the no-redundant-sanitize invariant — both names match and are ASCII); (c) clean ASCII title round-trips unchanged through both name fields; (d) `updateOfferFields` PATCH `body.name` is sanitized. Use the existing `baseCmd` fixture — extend it with em-dash titles in test-local overrides. | Adapter spec ticks 169 → 173; all branches green. |
| 5 | All — quality gate | `pnpm lint` (0 errors), `pnpm type-check` (clean), `pnpm test` (all packages green). | Quality gate passes. |
| 6 | Manual sandbox repro — **hard merge gate** | Before merging, retry offer creation against cat 257933 with the same Canon variant from the #419 repro. Expect `active` / `validating` status. The userMessage from the #419 sandbox showed Allegro itself appending ` — Aparat_cyfrowy` (em-dash + reference) to its display string, which is purely server-side formatting — but our submitted name (the PrestaShop product name `Aparat cyfrowy CANON PowerShot SX740 Lite Edition _ srebrny`) contains no em-dash, so the sanitizer is in fact a *no-op* for that exact title. **The repro succeeding therefore validates the structural fix; failing with a different char would extend the banned-char map in this same PR per the #419-strengthened criterion.** | Sandbox round-trips to `active`/`validating`; if a new banned char surfaces, extend the map and re-test in the same PR. |

## 6. Tests-of-record

Following the layered test pattern established in #410 → #415 → #419:

- **Util spec** — `sanitize-allegro-product-name.spec.ts`: char-by-char sanitization rules. Pure function, no mocks.
- **Adapter spec** — `allegro-offer-manager.adapter.spec.ts`: end-to-end wire-shape assertions that the body Allegro receives has the sanitized name at every site. Mocks the HTTP client port (per `engineering-standards.md` §Mocking Ports).
- **No CORE / FE tests needed** — sanitization is per-platform and contained in the Allegro adapter package.

## 7. Validation

- **Hexagonal compliance** — change is purely inside the Allegro adapter package's infrastructure layer; CORE / FE / API DTO untouched. ✅
- **Naming** — util filename `sanitize-allegro-name.ts` mirrors `sanitize-allegro-description.ts`. The function applies to multiple `name` fields (offer-name + inline-product-name), so the neutral `sanitizeAllegroName` is more accurate than `…ProductName` — see §1 closing paragraph. ✅
- **Headers** — new util gets a JSDoc header matching the description-sanitizer's style. ✅
- **Tests** — co-located in `__tests__/` (existing pattern in this package). ✅
- **Security** — no new attack surface; the sanitizer is a *narrowing* of accepted characters, not a widening. No injection risk; no user-visible behavior change beyond the substitution. ✅
- **Migrations** — none. ✅
- **Public API** — only the new util is added to the package's exports if needed; the existing port surface is unchanged. ✅
- **DX rules in `.claude/rules/backend.md`** — no new ports/services; no DI tokens needed; pure infrastructure helper. ✅

## 8. Risks & open questions

- **Sanitizer is incomplete** — possible. Allegro hasn't published the full banned-char list. If sandbox repro surfaces a different rejected char (e.g. `™`, `•`, `→`), extend `BANNED_PRODUCT_NAME_CHAR_MAP` in this same PR rather than chaining a follow-up. The strengthened merge gate from #419 still applies.
- **Allegro-side userMessage formatting confused us once** — re-reading the #419 sandbox log, the userMessage `"…srebrny — Aparat_cyfrow"` was Allegro's display join of `name + " — " + reference`, not what we sent. So the em-dash that triggered the original 422 was actually *Allegro's own* formatter complaining about its own derived display string, not our submission. The PrestaShop product name in that repro contains no em-dash, so our submitted `body.name` was clean — meaning the sandbox repro for #420 will pass without the sanitizer doing any work. The sanitizer is still the right defense-in-depth fix because the *next* operator with an actual em-dash in their title (or any of the other Unicode punctuation we substitute) would otherwise hit the same rejection. **Frame the manual repro outcome accordingly:** "no regression" is the success state, not "sanitizer rewrote the title."
- **PATCH-side validator may differ from POST-side** — possible. We're applying sanitization to all three sites (POST `body.name`, POST `productSet[0].product.name`, PATCH `body.name`) on the conservative principle. If Allegro's PATCH validator turns out *more* lenient than POST, we're being slightly over-eager — harmless; round-trips ASCII titles unchanged.
- **Operator UX surprise** — an operator typing `"Smartphone — black"` and seeing `"Smartphone - black"` in the published listing might be confused. Mitigation: the title in OL's UI should still show the operator-typed value (the wizard form-state preserves it); only the wire payload to Allegro is normalized. If this becomes a friction point, the optional FE-warn-on-banned-char path from the issue body §Scope is the natural follow-up. Out of scope for #420.

## 9. Out of scope (explicitly deferred)

- Frontend warn-on-banned-char UX in the wizard / edit form.
- Generalized "marketplace name normalization" in CORE — sanitization is a per-platform concern.
- Discovery of Allegro's full banned-char list via empirical sandbox sweep — extend the map only when a real rejection surfaces.
