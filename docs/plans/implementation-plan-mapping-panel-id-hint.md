# Implementation plan — show human label + faded ID on mapping rows (#474 Phase 1)

## 1. Goal

Render the Allegro delivery method's human-readable name alongside its UUID on the carrier-mapping panel so operators no longer need to cross-reference Allegro's seller portal to recognise which method is which. The BE half of the issue (`listDeliveryMethods()` returning `{ value: methodId, label: methodName }`) shipped with **#472** — that endpoint already returns labelled data live from the seller's `/sale/shipping-rates`. The remaining gap is purely **FE rendering**: today `MappingPanel` shows only `{label}`, hiding the UUID; the issue spec asks for "human-readable name plus a faded UUID".

**Layer:** Frontend only. No BE / CORE / Integration changes.

**Phase 2 (carrier-family / pattern matching) is explicitly deferred.** The issue body says it should only ship if Phase 1 isn't enough — punt to a follow-up issue once we have signal.

## 2. Codebase research

- **BE endpoint**: `apps/api/src/mappings/http/mapping-options.controller.ts:112` — `@Get('source/delivery-methods')` already wires through to the adapter's `listDeliveryMethods` via the SourceOptionsReader capability resolution. Existing controller spec at `mapping-options.controller.spec.ts:48` mocks `listDeliveryMethods` returning `{ value: 'paczkomat-uuid', label: 'Paczkomat' }`.
- **BE adapter**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts:344` — fully implemented, walks `/sale/shipping-rates` then per-id details, flattens + dedupes by methodId, returns `MappingOption[]`. Comment header credits `(#472 / #474)` — meaning the adapter scope was always intended to cover both.
- **FE consumer**: `apps/web/src/features/mappings/components/MappingPanel.tsx`. Used by all three mapping tabs (statuses / carriers / payments) on `connection-mappings-page.tsx`. The dropdown renders `{o.label}` (line 167) and the saved-rows table renders `labelFor(sourceOptions, row.sourceValue)` (line 140), which returns just the label or falls back to the raw value if the saved value is no longer in the options list.
- **Type contract**: `libs/core/src/orders/domain/types/mapping-option.types.ts` — `MappingOption { value, label }`. Both required strings. The mirror FE type is `apps/web/src/features/mappings/api/mappings.types.ts`.
- **Test gap**: no `MappingPanel.test.tsx` exists today (only `AllegroCategorySearch.test.tsx` and the hooks tests). This change is a natural place to add one alongside the visual update — covers acceptance bullet #5 (Vitest on dropdown rendering) directly.
- **Hooks test**: `use-mapping-options.test.tsx` already covers the source-options query hook (also acceptance bullet #5).

## 3. Design

### Visual treatment

Render mappings with two pieces of information when `value !== label`:

```
Allegro Paczkomaty InPost  1fa56f79-…
^^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^
primary text               muted, smaller, monospace
```

When `value === label` (rare — happens when the Allegro adapter falls back to using id-as-name because the rate-table row had no `method.name`), render the value once and skip the muted hint. This keeps the surface clean for degraded data without forcing the operator to read the same string twice.

### Surfaces

Two render sites in `MappingPanel`:

1. **Saved-rows table cells** (line 140 / 141). Real DOM, can carry styled `<span>`s. Render `{label}` + a `<span class="mapping-panel__id-hint mono-text">{truncatedValue}</span>` when `value !== label`.
2. **Dropdown `<option>` elements** (line 167 / 178). Native `<select>` doesn't accept styled children — browsers strip everything but text. Render `{label} ({truncatedValue})` as plain text when `value !== label`. The visual "fade" treatment isn't possible inside a native option, but the operator still gets both pieces of information.

### Truncation

Allegro UUIDs are 36 characters and would dominate the row visually if rendered in full. Truncate to first 8 chars + `…` (matching the issue's example: `1fa56f79-…`). Helper:

```ts
function shortValue(value: string): string {
  return value.length <= 9 ? value : `${value.slice(0, 8)}…`;
}
```

Length check guards against truncating short values like PrestaShop carrier ids (`5`, `12`) — those render as-is.

The truncated id is supplementary, not the primary disambiguator. Allegro method names are already self-disambiguating in operator language ("Allegro Paczkomaty InPost" vs "Allegro Kurier24 InPost"); the id chip exists so an operator can confirm a saved row matches the underlying UUID without leaving the page, not so they can distinguish two near-identical methods by id. Collision odds on 8 hex chars within a seller's 10–15 methods are negligible.

### Helper function

Extract a single helper inside `MappingPanel.tsx`:

```ts
function renderOptionLabel(option: MappingOption): ReactNode {
  if (option.label === option.value) {
    return option.label;
  }
  return (
    <>
      {option.label}{' '}
      <span className="mapping-panel__id-hint mono-text">{shortValue(option.value)}</span>
    </>
  );
}

function optionPlainText(option: MappingOption): string {
  return option.label === option.value
    ? option.label
    : `${option.label} (${shortValue(option.value)})`;
}
```

`renderOptionLabel` returns ReactNode for the table; `optionPlainText` returns string for `<option>` text. The two helpers stay tight (4 + 4 lines) and live next to the existing `labelFor`.

The existing `labelFor(options, value)` keeps its current behaviour (used to resolve a saved row value back to its option). Update its call sites in the table to `renderOptionLabel(option)` once the option is found.

### Why `MappingPanel` (shared) and not `CarrierMappingPanel` (carrier-only)

The issue title is carrier-specific, but `MappingPanel` is shared across all 3 mapping tabs (statuses / carriers / payments). The `value !== label` polish is universally useful: PS carrier rows become `Carrier Name (5)`, Allegro status rows stay clean (`SENT === SENT`, treated as the degraded case → no hint). Adding it generically is no extra work and avoids forking the panel into 3 variants. Aligns with frontend-architecture's "shared components must remain generic enough to be reused across features".

## 4. Step-by-step plan

### Step 1 — Update `MappingPanel`

**File:** `apps/web/src/features/mappings/components/MappingPanel.tsx` (edit)

- Add `shortValue(value)` helper (top of file, after imports).
- Add `renderOptionLabel(option)` (returns `ReactNode`) and `optionPlainText(option)` (returns `string`) helpers.
- Replace `labelFor` with `optionByValue(options, value): MappingOption | null` — straight `Array.find`, returns the full option. Lists are tiny (3 panels × ≤20 items) so a Map is overkill; `Array.find` matches the existing tone of the file.
- In the saved-rows `<td>` cells: call `optionByValue` and pass the result to `renderOptionLabel`. When the option is **not** found (saved value no longer in the live source list — e.g., seller deleted the cennik), fall back to rendering the raw `row.sourceValue` in a single mono span. Preserves today's graceful degradation.
- In the `<option>` elements, render `optionPlainText(option)`.

**Acceptance:** existing usage continues to work — `connection-mappings-page.tsx` doesn't change at all; pure internal refactor of the rendering helpers. Compilation green.

### Step 2 — CSS

**File:** `apps/web/src/index.css` (edit)

- Add `.mapping-panel__id-hint` rule using `var(--text-muted)`, `0.75rem` font-size, slightly reduced letter-spacing for the dense look. Combined with `.mono-text` (already exists) for the monospace treatment.

**Acceptance:** tokens-only, no raw hex; selector follows BEM convention; lint passes.

### Step 3 — Add `MappingPanel.test.tsx`

**File:** `apps/web/src/features/mappings/components/MappingPanel.test.tsx` (new)

Cover the rendering states and the new label+id behaviour:

- **Mapped row with distinct value/label**: renders `{label}` + truncated value (`1fa56f79-…` shape) in the table cell.
- **Mapped row with value === label**: renders a single label, no id-hint span.
- **Mapped row with short value**: a 1–2 char value (e.g., PS carrier id `5`) renders verbatim with no ellipsis (asserts `shortValue` short-circuits on `length <= 9`).
- **Dropdown options**: distinct value/label produces `Label (1fa56f79-…)` plain text; matching value/label produces just the label.
- **Loading state**: renders `LoadingState`.
- **Options error**: renders `ErrorState` with the error message.
- **Empty saved rows**: renders the "No mappings configured yet" copy.
- **Duplicate-source guard**: tries to add a second mapping for an already-mapped source, expects the inline error and no row added.
- **Save flow**: clicking Save calls `onSave` with the current `localRows` snapshot.

**Acceptance:** 8 tests, all pass against the updated component. Existing FE test suite total grows by exactly these 8.

### Step 4 — Quality gate

```
pnpm --filter @openlinker/web lint
pnpm --filter @openlinker/web type-check
pnpm --filter @openlinker/web test
```

**Acceptance:** zero new errors; pre-existing warnings unchanged.

## 5. Validation

- **Architecture:** pure FE feature, dep direction `pages → features → shared` preserved (no dep changes — this is an internal-rendering polish). No CORE / Integration touch.
- **Naming:** kebab-class CSS, helper functions camelCase, test file matches `*.test.tsx` convention.
- **Type safety:** strict — all helpers fully typed; `renderOptionLabel` returns `ReactNode`; `optionPlainText` returns `string`. No `any`.
- **Accessibility:** the muted span is decorative supplementary text alongside the primary label; the `<option>` plain text already conveys both name and id to screen readers; no `aria-` changes needed. The Remove button's `aria-label` already includes the resolved label — that path keeps working unchanged.
- **Testing:** acceptance bullet #5 (Vitest on dropdown rendering + on source-options query hook) — query hook covered by existing `use-mapping-options.test.tsx`, dropdown rendering covered by the new `MappingPanel.test.tsx` cases.
- **Security:** no user input rendered as HTML; React text-node escapes the value string.

## 6. Risks & open questions

- **`<option>` styling fundamentally limited**: Native `<select>` doesn't render styled children. The "faded UUID in the dropdown" the issue mentions is realistically only achievable in the saved-rows table (real DOM). Plain text `Label (1fa56f79-…)` in dropdown options is the closest native approximation — flagging in PR description so it's a deliberate constraint, not an oversight. Replacing the native `<select>` with a styled `Select` primitive (Radix-wrapped, already in `shared/ui/select.tsx`) is a larger refactor and out of scope for this PR.
- **Truncation length**: 8 chars handles UUID disambiguation in 99% of cases (UUID v4 has near-zero collision in the first 8 hex chars within a single seller's 10–15 methods). If two methods share the same first 8 chars, the operator can still recover by hovering the table row (full UUID is preserved as the underlying `value`) — but this is a degenerate case I'm not going to solve unless it shows up in real data.
- **No new shared primitive**: the `__id-hint` span is a one-off helper class for `MappingPanel`. If a second mapping-style surface needs the same treatment, promote to a `<MutedIdHint>` primitive in `shared/ui/`. Don't pre-build it.
