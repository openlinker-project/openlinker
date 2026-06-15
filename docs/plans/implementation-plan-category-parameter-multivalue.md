# Implementation Plan — CategoryParameter `multiValue` (#1035)

**Issue:** #1035 (epic #1005, ADR-023 §6) · **Layer:** CORE contract + Integration (Allegro) mapper · **Size:** XS

## 1. Understand

Add the neutral multi-value cardinality signal to the `CategoryParameter` contract so cross-platform consumers (the attribute-projection brain, #1038) can tell a multi-value parameter from a single-value one without knowing each platform's encoding (eBay `itemToAspectCardinality: MULTI`, Allegro `restrictions.multipleChoices` / `allowedNumberOfValues`).

**Non-goals:** building eBay/Amazon adapters; FE rendering changes; making `dictionary[].id` optional.

## 2. Research findings (baseline / reuse check — substitutes for a formal pre-implement gate on this XS change)

- `CategoryParameterDictionaryEntry` **already carries `id` + `value`** (both, `id` required) → the issue's "add `dictionary[].id`" half is **already satisfied**. We will **not** make `id` optional: it's required today, every consumer (Allegro mapper, FE `serialize-allegro-parameters`) relies on it, and there is no present adapter that lacks stable value ids. A future eBay adapter synthesises an id at its boundary. (Documented deviation from ADR-023 §6's `dictionary[].id?`.)
- `multiValue` does **not** exist yet → the real work.
- **Allegro has no `variantsAllowed` field** (ADR-023 §6's example was inaccurate). Allegro multi-value = `restrictions.multipleChoices === true || (allowedNumberOfValues ?? 1) > 1`.
- FE reads `restrictions.multipleChoices` directly (`build-parameters-zod-schema.ts:88`) → additive `multiValue?` leaves FE untouched.
- 7 object-literal construction sites set `section:` → making `multiValue` **required** would touch all 7 for zero present benefit. Use **optional** (`multiValue?: boolean`), per the issue's "additive" acceptance. Document the upgrade-to-required path for when a 2nd adapter lands.

## 3. Design

- Neutral contract: `CategoryParameter.multiValue?: boolean` — undefined ⇒ single-valued. Roll-up flag, not a replacement for `restrictions` (which keep the platform-precise counts).
- Allegro adapter is the only producer; it emits an explicit boolean.

## 4. Steps

1. `libs/core/src/listings/domain/types/category-parameter.types.ts` — add `multiValue?: boolean` to `CategoryParameter` with a doc comment; add a one-line Amazon "flattened top-level only" note to the file header. **AC:** type-check green; field documented.
2. `libs/integrations/allegro/src/infrastructure/mappers/allegro-category-parameter.mapper.ts` — populate `multiValue` from `multipleChoices`/`allowedNumberOfValues`. **AC:** dictionary multi-select → `true`; `allowedNumberOfValues > 1` → `true`; single → `false`.
3. `…/__tests__/allegro-category-parameter.mapper.spec.ts` — add cases covering the three branches against the existing fixture. **AC:** specs pass.

## 5. Validate

- Architecture: contract lives in core, mapping in the adapter — no boundary crossing. Additive optional field — no breaking change. `as const`/types conventions respected. No `any`, no `console.log`.
- Testing: unit only (pure mapper); no migration, no integration surface.

## Follow-up (out of scope)

ADR-023 §6 wording should be corrected when PR #1033 merges: drop the `variantsAllowed` example, and note `dictionary[].id` is required (not optional). Tracked in the #1035 PR description.
