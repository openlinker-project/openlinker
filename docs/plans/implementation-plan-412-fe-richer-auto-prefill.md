# Implementation Plan — #412 FE: richer auto-prefill for CreateOfferWizard parameters (brand, producer code)

## 1. Goal & Context

Extend the conservative auto-prefill helper introduced in #410 (`apps/web/src/features/listings/components/auto-prefill-parameters.ts`) to cover two more parameter classes:

- **`Marka` (Brand)** — case-insensitive **exact** match against the parameter's dictionary; high-confidence prefills only. If the variant has a brand value but no exact dict match, surface a soft "no exact match" hint under the field instead of stomping it.
- **`Kod producenta` (Producer code)** — straight passthrough from a deliberate variant attribute (`manufacturerCode`); **never** from `sku` (SKU is the shop's stock keyring, not the manufacturer's part number).

Existing EAN + Stan prefill behaviour from #410 stays unchanged.

**Layer**: Frontend — pure feature-internal extension to `features/listings/components/auto-prefill-parameters.ts` + the wizard wiring + the parameters-step hint surface.

**Non-goals** (explicit in the issue):
- Per-shop attribute-key mapping admin UI.
- Cross-marketplace prefill (Allegro-specific for now).
- Sourcing producer code from SKU (banned by design).
- BE-side adapter changes to populate `variant.attributes.brand` / `variant.attributes.manufacturerCode` — see §7 risk #1; the FE is built to consume the keys when they exist and is a no-op otherwise. A BE follow-up will populate the keys.

---

## 2. Diverges from issue text

**Attribute key naming.** The issue floats `variant.attributes.brand` and `variant.attributes.manufacturer_code` / `variant.attributes.mpn`. I'll standardize on:

- `brand` — short, conventional.
- `manufacturerCode` — camelCase to match the existing FE convention (`variant.ean`, `variant.gtin`, `variant.sku` are all camelCase top-level fields; the `attributes` bag is free-form but the precedent everywhere else is camelCase).

The JSDoc on the new fields documents both terms ("manufacturer code / MPN"). When the BE adapter populates the bag, it'll use these keys.

Nothing else diverges.

---

## 3. Architecture

### Today

```
variant.ean ─┐
             │
             ▼
autoPrefillParameters(parameters, { ean })
             │
             ▼
{ [paramId]: value }            ──► form.setValue('parameters', merged)
             │
             ▼
prefilledIds: Set<paramId>     ──► CategoryParametersStep prefilled prop
                                       │
                                       ▼
                                ParameterField — "Auto-filled from variant data"
                                (cleared once the operator dirties the field)
```

### After #412

```
variant.ean ────────────┐
variant.brand ──────────┼─► autoPrefillParameters(parameters, { ean, brand, manufacturerCode })
variant.manufacturerCode┘                 │
                                          ▼
                                  { [paramId]: value }
                                          │
                                          ▼
                                  prefilledIds (existing) + extraHints (new)
                                          │
                                          ▼
                                  CategoryParametersStep
                                          │       │
                                          ▼       ▼
                                  Auto-filled hint   "Variant brand: X — no exact match…"
                                  (cleared on dirty) (cleared on dirty)
```

### Why this shape (instead of one richer return type)

The existing helper returns `CategoryParameterFormValues` (a `paramId → value` map). Tests and the wizard call sites depend on that shape. The clean extension is:

- Keep `autoPrefillParameters` shape unchanged — extend `AutoPrefillVariantFields` with two optional fields and add brand/MPN rules to `prefillOne`.
- Add a separate, narrow function `collectUnmatchedBrandHints(parameters, variant, filled)` that emits `{ paramId, message }` entries only for the "had a brand value but couldn't match" case.

Two functions, each with one job. Tests for the new function don't touch the existing tests. The wizard composes both outputs into the two pieces of state it already owns (`prefilledIds`) plus one new piece (`extraHints: Record<paramId, string>`).

### State ownership

| Concern | Owner |
|---|---|
| Per-category parameter schema (server state) | TanStack Query (existing) |
| Per-field form values | React Hook Form (existing) |
| `prefilledIds` ("auto-filled" hint surface) | Wizard local `useState` (existing) |
| `extraHints` (new "no exact match" hint surface) | Wizard local `useState` (**new**) |

No new global state, no new context.

---

## 4. File-by-file plan

### 4.1 `apps/web/src/features/listings/components/auto-prefill-parameters.ts` — extend matcher + add hint collector

**Extend `AutoPrefillVariantFields`**:
```ts
export interface AutoPrefillVariantFields {
  /** Variant's barcode — matches EAN/GTIN/Kod EAN parameter names. */
  ean?: string | null;
  /**
   * Variant's brand value (free-text from the master catalog). Used to find
   * an exact case-insensitive match against the `Marka` parameter's
   * dictionary; never used for fuzzy / substring matching to avoid wrong
   * fills.
   */
  brand?: string | null;
  /**
   * Manufacturer code / MPN — copied verbatim into the `Kod producenta` /
   * string-typed parameter. Deliberately a separate field from `sku`: SKU
   * is the shop's internal stock-keeping reference, MPN is the
   * manufacturer's part number. They are often equal in practice but the
   * semantics differ; conflating them here would silently break offers
   * where they diverge.
   */
  manufacturerCode?: string | null;
}
```

**Add module-scope constants** (next to the existing `EAN_NAME_PATTERNS` etc.):
```ts
const BRAND_NAME_PATTERNS = ['marka', 'brand', 'producent'];
const MANUFACTURER_CODE_NAME_PATTERNS = ['kod producenta', 'manufacturer code', 'mpn', 'producer code'];
```

**Extend `prefillOne`** with two new branches after the existing Stan branch:

```ts
// Brand (Marka) — exact case-insensitive match against the dictionary.
// Multi-match or no-match → no fill (the "no exact match" hint is emitted
// separately by collectUnmatchedBrandHints).
if (
  variant.brand &&
  BRAND_NAME_PATTERNS.includes(nameLower) &&
  param.type === 'dictionary' &&
  !param.restrictions.multipleChoices
) {
  const target = variant.brand.toLowerCase().trim();
  const matches = (param.dictionary ?? []).filter(
    (entry) => entry.value.toLowerCase().trim() === target,
  );
  if (matches.length === 1) return matches[0].id;
  // 0 or >1 matches → leave blank, hint surfaces elsewhere.
}

// Kod producenta (manufacturer code / MPN) — verbatim string passthrough,
// trimmed to defend against whitespace-contaminated attribute bags
// (operator-edited values routinely carry leading/trailing spaces; Allegro's
// `Kod producenta` is whitespace-sensitive on submit). Only fires when the
// parameter is a string type and the variant carries a non-empty value.
// Deliberately does NOT touch SKU — that's the shop's internal stock-keeping
// reference, not the manufacturer's part number.
if (
  variant.manufacturerCode &&
  MANUFACTURER_CODE_NAME_PATTERNS.includes(nameLower) &&
  param.type === 'string'
) {
  const trimmed = variant.manufacturerCode.trim();
  if (trimmed) return trimmed;
}
```

**Add `collectUnmatchedBrandHints`** (new exported function below the existing one):

```ts
export interface UnmatchedBrandHint {
  paramId: string;
  message: string;
}

/**
 * Emits a soft hint for every `Marka` parameter where the variant has a
 * brand value but no exact dictionary match was found. Operators see the
 * variant's brand value alongside the field with a prompt to pick manually
 * — better than a silent empty field with no explanation.
 *
 * Mirrors the matcher list used by autoPrefillParameters above, and uses
 * the same one-match-only invariant — if the dictionary has the brand,
 * autoPrefillParameters already filled it and this function skips that
 * param via the `filled` lookup.
 */
export function collectUnmatchedBrandHints(
  parameters: CategoryParameter[],
  variant: AutoPrefillVariantFields,
  filled: CategoryParameterFormValues,
): UnmatchedBrandHint[];
```

Implementation walks the parameter list, matches the same `BRAND_NAME_PATTERNS`, skips any param already in `filled`, and emits `{ paramId, message: `Variant brand "${variant.brand}" — no exact match in Allegro brand list; pick manually.` }` when `variant.brand` is set.

### 4.2 `apps/web/src/features/listings/components/auto-prefill-parameters.test.ts` — extend tests

Existing tests stay. Add new test cases inside the existing `describe('autoPrefillParameters', ...)`:

1. **Brand exact-match fills** — dictionary `[{id: 'p_sony', value: 'Sony'}]`, variant `brand: 'sony'` → `out.p1 === 'p_sony'`. Case-insensitive proven.
2. **Brand no-match leaves blank** — dictionary `[{id: 'p_x', value: 'OtherBrand'}]`, variant `brand: 'Sony'` → `out.p1 === undefined`.
3. **Brand multi-match leaves blank** — dictionary `[{id: 'a', value: 'Sony'}, {id: 'b', value: 'sony'}]` (defensive — shouldn't happen but matters): `out.p1 === undefined`.
4. **Brand skipped when variant has no brand** — variant `{}` → `out.p1 === undefined`.
5. **Manufacturer code fills verbatim** — string param `Kod producenta`, variant `manufacturerCode: 'ABC-123'` → `out.p1 === 'ABC-123'`.
6. **Manufacturer code does NOT fill from SKU** — variant has `sku` in attributes (we don't read it) and no `manufacturerCode` → `out.p1 === undefined`.
7. **Existing tests unchanged** — EAN, Stan, no-match behaviour.

New `describe('collectUnmatchedBrandHints', ...)`:

1. **Emits hint when variant has brand but no match** — returns one entry with the variant brand in the message.
2. **Empty when variant brand was matched and filled** — `filled` map includes the param id, no entry emitted.
3. **Empty when variant has no brand** — variant `{}` → empty array.
4. **Emits across multiple unmatched Marka params** — two params both named `Marka`, neither has a matching dict entry, both emit hints.

Test file aim: 7 new `it()` blocks (4 for `autoPrefillParameters` extensions + 4 for `collectUnmatchedBrandHints` — minus one overlap = 7 new total) on top of the existing 6.

### 4.3 `apps/web/src/features/listings/components/AllegroCreateOfferWizard.tsx` — thread brand + MPN + new hints

**State** (next to existing `pickedVariantEan`, line 264):
```ts
const [pickedVariantBrand, setPickedVariantBrand] = useState<string | null>(null);
const [pickedVariantManufacturerCode, setPickedVariantManufacturerCode] = useState<string | null>(null);
const [extraHints, setExtraHints] = useState<Record<string, string>>({});
```

**Variant pick handler** (around line 519, where `setPickedVariantEan` lives):
```ts
setPickedVariantEan(variant.ean ?? null);
setPickedVariantBrand(variant.attributes?.['brand'] ?? null);
setPickedVariantManufacturerCode(variant.attributes?.['manufacturerCode'] ?? null);
setPickedProductId(product.id);
```

**Prefill effect** (line 367-405, mirroring the `pickedVariantEan` thread): pass the two new fields into `autoPrefillParameters`, then call `collectUnmatchedBrandHints` against the same parameters and the resulting `filled` map. Build a `Record<paramId, message>` and call `setExtraHints(map)`. The same once-per-`(connectionId, categoryId)` ref guard applies.

**Pass `extraHints` to the step component** (line 951):
```tsx
<CategoryParametersStep
  parameters={categoryParameters}
  formNamespace="parameters"
  prefilledIds={prefilledIds}
  extraHints={extraHints}
/>
```

### 4.4 `apps/web/src/features/listings/components/category-parameters-step.tsx` — new `extraHints` prop

**Extend `CategoryParametersStepProps`**:
```ts
/**
 * Map of parameter id → soft hint message rendered next to the field.
 * Generic by design — appended to the field's description channel, cleared
 * per-field once the operator dirties the field (same lifecycle as
 * `prefilledIds`).
 *
 * Today the sole producer is `collectUnmatchedBrandHints` (#412), surfacing
 * the variant's brand value when no exact dictionary match was found.
 * Extension point for future fill-attempt diagnostics (e.g., ambiguous
 * catalog match, dict-value mismatch) — keeping the prop intent-agnostic
 * means new hint producers can plug in without a prop-rename PR.
 */
extraHints?: Record<string, string>;
```

**Live-strip on dirty** (next to the existing `liveprefilledIds` memo at line 84):
```ts
const liveExtraHints = useMemo(() => {
  if (!extraHints || Object.keys(extraHints).length === 0) return extraHints ?? {};
  const next: Record<string, string> = {};
  for (const [paramId, message] of Object.entries(extraHints)) {
    if (!dirtyParameters[paramId]) next[paramId] = message;
  }
  return next;
}, [extraHints, dirtyParameters]);
```

**Pass through to `ParameterField`** (lines 122, 141):
```tsx
<ParameterField
  ...
  prefilled={liveprefilledIds.has(param.id)}
  extraHint={liveExtraHints[param.id]}
/>
```

**Extend `ParameterFieldProps`** + render:
```ts
interface ParameterFieldProps {
  ...
  prefilled: boolean;
  extraHint?: string;
}

// inside ParameterField
const autoFillHint = prefilled ? 'Auto-filled from variant data' : undefined;
// extraHint flows through unchanged; FormField joins all three with ' · '
description={[description, autoFillHint, extraHint].filter(Boolean).join(' · ') || undefined}
```

The `FormField` already aria-describedbys the description, so screen readers pick up the new hint without further wiring.

### 4.5 No new step-component test file

The `category-parameters-step.tsx` has zero unit tests today (`category-parameters-step.test.tsx` does not exist). The existing `prefilledIds` mechanism (and its `liveprefilledIds` dirty-strip memo) is verified only through the wizard test (`AllegroCreateOfferWizard.test.tsx`) by render-tree inference. The new `extraHints` prop reuses the exact same dirty-strip shape as `prefilledIds`, plus a third entry in the existing `[description, autoFillHint, extraHint].filter(Boolean).join(' · ')` join. Adding a focused step-component test for the new prop diverges from the existing precedent — the helper unit tests (`autoPrefillParameters`, `collectUnmatchedBrandHints` — §4.2) carry the logic, and the wizard test catches integration regressions. If a third hint producer ever lands, that's the natural moment to introduce `category-parameters-step.test.tsx` and back-fill coverage for all three hint paths together.

### 4.6 No CSS changes

The hint uses the existing description channel on `FormField`. No new tokens, no new classes.

---

## 5. Quality Gate

```
pnpm lint        # 0 errors
pnpm type-check  # 0 errors
pnpm test        # all packages; apps/web with the new tests
```

No BE changes → no `migration:show`. No `apps/api` files touched.

---

## 6. Acceptance Criteria (mapped from issue)

- [x] Brand auto-prefill works for the common case (exact case-insensitive match) with no false positives — §4.1 + §4.2 tests 1-4
- [x] Producer-code prefill is wired to a dedicated attribute, never to SKU — §4.1 + §4.2 tests 5-6
- [x] Both prefills surface the "auto-filled" hint, and the hint clears once the user edits the field — reuses the existing `prefilledIds` + `liveprefilledIds` mechanism
- [x] Variants without a matchable brand show the soft "no exact match" hint instead of an empty field — §4.1 `collectUnmatchedBrandHints` + §4.4 `extraHints` prop
- [x] Existing EAN + Stan prefill behaviour unchanged — §4.2 existing tests stay, new tests are additive
- [x] Unit tests cover: exact match, no match, ambiguous match, missing attribute — §4.2 covers all four
- [x] `pnpm lint && pnpm type-check && pnpm test` pass — §5

---

## 7. Risks & Open Questions

1. **PrestaShop adapter doesn't populate `variant.attributes.brand` / `manufacturerCode` today.** Verified via grep over `libs/integrations/prestashop/src/`. Today's `variant.attributes` is a free-form bag with no consistent keys for these fields. The FE prefill is implemented as a no-op when the keys are absent — the BE follow-up that populates them is a separate issue (worth filing). Without that BE work the operator-visible behaviour change for this PR is limited to the **soft no-match hint** path (which fires only when the variant DOES have a brand value).

2. **Allegro parameter naming variation.** Today the matchers are hard-coded lists (`EAN_NAME_PATTERNS = ['ean (gtin)', 'ean', ...]`). Adding more rows for brand/MPN follows the existing pattern but inherits the same fragility — if Allegro renames `Marka` to `Marka produktu` the prefill silently goes quiet. The TODO in the existing JSDoc (lines 25-34) flags replacing literals with a config map as future work; staying inside the literals list keeps #412 focused.

3. **Brand dictionary multi-match.** Defensive code path — Allegro's brand dictionaries normally have one entry per brand, so this branch shouldn't fire in practice. Choosing "leave blank" instead of "pick the first" matches the issue's "no false positives" requirement.

4. **`variant.attributes` key conflict potential.** The current variant-display label at `AllegroCreateOfferWizard.tsx:143` joins ALL `Object.values(variant.attributes)` to build the option label. Adding `brand` / `manufacturerCode` keys to the bag would surface them in the display label too, which is mildly noisy but not wrong. Acceptable — the variant picker is functional, not curated. If it becomes an issue, the label code can filter by known display-only keys later.

5. **`extraHints` empty-map shape.** `setExtraHints({})` is the no-hints state. The step's `liveExtraHints` memo returns `{}` for that case. Reading `liveExtraHints[paramId]` for an unknown id yields `undefined`, which `[description, autoFillHint, extraHint].filter(Boolean)` strips correctly. No special-casing needed.

6. **Responsive (mobile + tablet) coverage.** The new hint is appended to the existing `FormField.description` channel — same line, same flow, same wrap behaviour. No new visual elements. Default-mobile-into-scope satisfied by reuse.

7. **PR #647 conflict surface.** Open PR #647 (#609 feature barrels) modifies 7 files inside `features/listings/components/` but **only the import lines** — and only cross-feature imports from `connections`, `products`, `content`, `mappings`. `auto-prefill-parameters.ts` and `category-parameters-step.tsx` are NOT in #647's modified set, and `AllegroCreateOfferWizard.tsx` is touched only at its existing import statements (lines 48-53), not the area I'll edit (state declarations, prefill useEffect, the JSX render around line 951). Conflict risk is LOW; the only overlap is `AllegroCreateOfferWizard.tsx` and even there only at the top-of-file imports vs. mid-file state/effect changes. Either PR can land in either order.

---

## 8. Out of Scope (explicit)

- BE-side adapter changes to populate `variant.attributes.brand` / `variant.attributes.manufacturerCode` — separate follow-up issue.
- Per-shop attribute-key mapping admin UI (the issue's "configurability (deferred)" section).
- Replacing the hard-coded `*_NAME_PATTERNS` literal lists with a config map keyed by connection locale + parameter role — the existing JSDoc TODO survives.
- Cross-marketplace prefill — Allegro-specific today.
- Filtering `variant.attributes` keys out of the display label assembly at `AllegroCreateOfferWizard.tsx:143` — see risk #4.
