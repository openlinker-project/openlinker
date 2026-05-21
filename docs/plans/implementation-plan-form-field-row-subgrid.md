# Implementation Plan — `.form-field-row` subgrid utility (#793)

## 1. Understand the task

**Goal:** Add a reusable CSS utility class `.form-field-row` that lays sibling
`FormField`s out on a *shared* subgrid, so their label / input / description /
error rows align across columns even when only some cells carry a `description`.
Migrate the one current misalignment site — the bulk wizard Config step's
Default stock / Default price / Currency row — to use it.

**Layer:** Frontend (DX / shared UI styling). No backend, no API, no domain.

**Root cause (from #793):** `FormField` (`apps/web/src/shared/ui/form-field.tsx`)
is `display: grid` with auto-generated rows. When sibling FormFields sit in a
parent grid that knows nothing about each FormField's internal row structure,
each cell is its own grid context — a cell with a `description` grows downward
while its neighbours stop at the input, breaking the row's bottom edge.

**Explicit non-goals (from the issue's "Out of scope"):**
- No `FormFieldRow` React primitive — defer until a 3rd consumer arrives.
- No change to `FormField` itself — the primitive is correct in isolation.
- No refactor of `bulk-edit-modal.tsx`'s multi-column rows (no mixed-description
  rows there today).

## 2. Research findings

- `FormField` renders `<div class="form-field">` containing, in order: `<label>`,
  the cloned control, an optional `<p class="form-field__description">`, and a
  `<FieldError>`. `FieldError` returns **`null`** when `message` is falsy
  (`apps/web/src/shared/ui/field-error.tsx:8-11`). So each FormField contributes
  **2–4 DOM children**: label, control, [description], [error].
- `.form-field` CSS (`index.css:2114-2117`): `display: grid; gap: var(--space-2)`.
- Bug site (`bulk-config-step.tsx:186`):
  `<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>`
  with 3 FormFields; only the middle (`Default price`) carries a `description`.
  None of the three pass an `error` prop.
- **Subgrid mechanics:** with `grid-template-rows: subgrid; grid-row: span 4` on
  each child FormField, auto-placement maps child 1→row 1 (label), 2→row 2
  (input), 3→row 3 (description), 4→row 4 (error). Missing children leave their
  tracks reserved-empty. Inputs always occupy row 2 ⇒ bottom edges align; the
  description occupies row 3 in the middle cell and a reserved-empty row 3 in the
  side cells. This is exactly the desired behaviour.
- **Drift checker is safe.** `scripts/check-design-tokens.mjs` is
  *one-directional* (catalog → CSS): it fails only if a token in
  `tokens.ts` is missing from `index.css`. Orphaned CSS vars not in the catalog
  are explicitly tolerated (script header lines 12-14). The component-local
  `--cols` variable is **not** a design token, so it needs **no** `tokens.ts`
  entry and won't trip `pnpm lint`. (The `frontend.md` rule's "every CSS var must
  appear in tokens.ts" wording is misleading; `ui-components.md` and the script
  itself are authoritative.)

## 3. Design

A single utility class plus a child rule, added to `index.css` near the
`FormField` section, under a bounded section comment per the styling rule.
The parent declares the 4 logical rows once; each child FormField opts into the
parent's track template via `subgrid`.

**Refined per the tech-review** — mobile-first (single-column stack by default,
multi-column subgrid layered in at the tablet breakpoint so three side-by-side
inputs aren't unreadable < 768px), column count via a BEM modifier class
(`--cols-3`) rather than an inline custom-property style (no TS cast needed):

```css
/* ── Form layout utilities (#793) ── */
.form-field-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-3);
}
.form-field-row--cols-3 {
  --cols: 3;
}
@media (min-width: 768px) {
  .form-field-row {
    grid-template-columns: repeat(var(--cols, 2), 1fr);
    grid-template-rows: auto auto auto auto; /* label · input · description · error */
    gap: var(--space-2) var(--space-3);      /* row-gap matches FormField's internal 8px stack */
  }
  .form-field-row .form-field {
    grid-template-rows: subgrid;
    grid-row: span 4;
  }
}
```

- Column count is parameterised via `--cols` (default 2; the migration site adds
  `--cols-3`). The modifier class keeps all styling in `index.css` and avoids the
  inline-style + `CSSProperties` cast.
- Row-gap `var(--space-2)` reproduces the FormField's own internal `gap`, so the
  subgridded children keep their tight label/input/description stacking. Col-gap
  `var(--space-3)` matches the row's previous inter-column gap (no visual regression).
- Subgrid + the multi-column row template apply only ≥ 768px; below that each
  FormField stacks single-column and renders as its own standalone grid.

Browser support: subgrid is Chrome 117+ / Safari 16+ / Firefox 71+ — within
OpenLinker's targets (per #793).

## 4. Step-by-step implementation

### Step 1 — Add the utility to `index.css`
- **File:** `apps/web/src/index.css`
- Insert the CSS above immediately after the `.form-field__error` block
  (after line 2140, before `.form-error-summary__list`).
- **Acceptance:** class present under a `/* ── Form layout utilities (#793) ── */`
  bounded comment; uses `var(--space-*)` tokens, no hardcoded spacing.

### Step 2 — Migrate the Config-step row
- **File:** `apps/web/src/features/listings/components/bulk/bulk-config-step.tsx:186`
- Replace the inline-grid `<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>`
  with `<div className="form-field-row form-field-row--cols-3">`.
- No `CSSProperties` import / cast — the column count rides the `--cols-3`
  modifier class (tech-review refinement).
- The three child `FormField`s are unchanged.
- **Acceptance:** no inline `gridTemplateColumns` remains; the three FormFields
  render as before with aligned input bottom edges on ≥ 768px and stack
  single-column below it.

### Step 3 — Tests
- Per #793: **no new tests required** (pure CSS layout + className swap, no logic).
- **Guard:** check for an existing `bulk-config-step.test.tsx`; if any assertion
  keys off the old inline grid style, update it. (Expectation: none does — the
  tests assert behaviour, not inline styles.)

### Step 4 — Quality gate + visual check
- `pnpm lint && pnpm type-check && pnpm test` (web filter) green.
- Visual check is manual per the issue (the three cells' input bottom edges align;
  the description sits in a reserved row without making the middle cell taller).

## 5. Validation

- **Architecture:** shared-UI styling only; respects `app → pages → features →
  shared` (no new imports); vanilla CSS + tokens; bounded section comment.
- **Naming:** `.form-field-row` follows the flat BEM-ish convention.
- **Security:** none (presentational).
- **Risks / open questions:**
  1. **TS strictness on `--cols`** — inline custom properties need a
     `CSSProperties` cast. Mitigation: cast as above; verify existing pattern.
  2. **Existing test coupling** — Step 3 guard.
  3. **Overlap with #792 PR3** — that PR deletes this exact row, but #793 lands
     the utility for the recurring pattern elsewhere (settings/connection forms).
     Non-blocking; explicitly endorsed by the issue.

## References
- `apps/web/src/shared/ui/form-field.tsx` — FormField primitive (unchanged)
- `apps/web/src/shared/ui/field-error.tsx:8-11` — null-on-empty render
- `apps/web/src/index.css:2109-2140` — FormField CSS section
- `apps/web/src/features/listings/components/bulk/bulk-config-step.tsx:186-218` — bug site
- `scripts/check-design-tokens.mjs` — one-directional drift guard (catalog → CSS)
- #793 — this issue; #792 PR3 — replaces the bug-site row
