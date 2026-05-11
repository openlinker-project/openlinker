# Implementation Plan — #637 FE: AI Suggest button in CreateOfferWizard

## 1. Goal

Mount the existing `SuggestionDialog` next to the description field in `CreateOfferWizard` **Step 2** (Offer details). Same UX contract as `EditOfferDrawer` (#485): when preconditions are met, an "✨ Suggest with AI" button opens the dialog; the generated copy is written into the wizard's `description` form field marked dirty + validated.

**Step indexing in this plan:** the plan uses **1-indexed visible steps** throughout (Step 1 = "Connection & Variant", Step 2 = "Offer details", …, Step 5 = "Review"). This matches the wizard's existing test-helper convention (`advanceToStep2` lands on Offer details). The underlying RHF `stepIndex` state is 0-indexed; the mapping is:

| Visible step | `STEP_LABELS[i]` | `stepIndex` |
|---|---|---|
| Step 1 | Connection & Variant | 0 |
| **Step 2** | **Offer details (← description field lives here)** | **1** |
| Step 3 | Category parameters | 2 |
| Step 4 | Policies | 3 |
| Step 5 | Review | 4 |

**Layer:** Frontend, `features/listings` (composition only — no new hooks, API, or CSS tokens).

**Non-goals:**
- No backend work — `apiClient.content.suggest` already exists and is used by `EditOfferDrawer`.
- No new prompt template — `offer.description.suggest` already serves both flows.
- No streaming/inline-completion UX — reuse the existing dialog as-is.
- No conflict resolution beyond the dialog's own "Apply to editor" confirm step (matches drawer behavior).
- No rename of the wizard's `description` form field for symmetry with the drawer's `descriptionText` — that's churn.

## 2. Diverges from the issue text — deliberate

Flagged explicitly so a post-merge reviewer doesn't think the acceptance bullets paper over the divergence.

1. **Step location.** Issue says "Step 3 description field". The description field lives in `stepIndex === 1` ("Offer details", visible Step 2). The issue's "Step 3" appears to be informal numbering; this plan implements the button next to the description regardless of label.

2. **Product id source.** Issue suggests `selectedProductId` (the *expanded* product card state on Step 1). That state is null in two normal flows: (a) operator collapses the product card after picking a variant, (b) wizard reopens with retry `initialValues` (the open effect explicitly nulls it with a comment that product id can't be derived from `ol_variant_*`). This plan adds a new `pickedProductId` state, set in `handleVariantPick` alongside the existing `pickedVariantEan` — robust to (a), still null in (b) as documented in research notes.

## 3. Research notes

### Description-field location
Step 2 (Offer details) JSX lives at `CreateOfferWizard.tsx:849-855`. The form field name is `description` (wizard) — distinct from `descriptionText` (drawer). Keep the wizard's name.

### Why `pickedProductId` and not `selectedProductId`
- `selectedProductId` is set on **expand**, not on **pick**: `setSelectedProductId(isExpanded ? null : product.id)` at line 671. Collapsing the product after picking its variant nulls it while `internalVariantId` stays in the form.
- The retry-with-`initialValues` path at line 269 explicitly does `setSelectedProductId(null)` with the comment "the variant id format is `ol_variant_*`; product id cannot be derived from it." So the operator landing on Step 2 via retry would have no usable `selectedProductId`.
- `pickedProductId` mirrors `pickedVariantEan` (line 226), which is set in `handleVariantPick` (line 470) and survives both cases for the fresh-pick flow. Retry still degrades to "missing product" hint until the operator re-picks — documented and acceptable.

### Channel resolution
`marketplaceConnections` (line 299-305) is already filtered to OfferManager-capable connections. Resolve the picked one by `find(c => c.id === currentConnectionId)`, read `platformType`, pass through `resolveSuggestChannel` (returns `'allegro' | 'prestashop' | null`).

### Reuse of `SuggestionDialog`
At `apps/web/src/features/content/components/suggestion-dialog.tsx`. Exports `SuggestionDialog` with the contract `{ productId, channel, disabled?, onApply, scopeWarning? }`. Renders its own trigger `<Button>` inside `<DialogTrigger asChild>`, so the call site just renders the component (no separate trigger button needed).

### Cross-feature import
`features/listings → features/content` is already permitted by ESLint (`EditOfferDrawer` line 24-25). No new edge.

### CSS naming
Existing wizard CSS uses flat `.create-offer-*` prefixes for sub-components: `.create-offer-form` (line 605 in source), `.create-offer-variant-picker`, `.create-offer-variant-picker__product`, `.create-offer-checkbox`. To stay consistent with that family, the new classes use `.create-offer-description*` (NOT `.create-offer-wizard__description*` — that would introduce a second prefix family for the same component).

## 4. Step-by-step implementation

### Step 1 — Track the picked product id

**File:** `apps/web/src/features/listings/components/CreateOfferWizard.tsx`

- Add `const [pickedProductId, setPickedProductId] = useState<string | null>(null);` alongside `pickedVariantEan` (~line 226).
- In `handleVariantPick(product, variant)` (~line 457): add `setPickedProductId(product.id);` near `setPickedVariantEan(...)`.
- In the open effect's reset branch (~line 280): add `setPickedProductId(null);` near `setPickedVariantEan(null);`.

### Step 2 — Imports

Add to the top-of-file imports (preserving the existing groups order — external → cross-feature → local):

```ts
// Add to React imports — useCallback is not currently imported
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

// Add to features/content cross-imports
import { SuggestionDialog } from '../../content/components/suggestion-dialog';
import { resolveSuggestChannel } from '../../content/api/content.utils';
```

### Step 3 — Derive `canSuggest` and `disabledHint`

In the component body, after `currentConnectionId` is computed but before the Step JSX. Mirror the drawer's hint precedence (drawer source: `EditOfferDrawer.tsx:80-85`).

```ts
const currentConnection = useMemo(
  () => marketplaceConnections.find((c) => c.id === currentConnectionId) ?? null,
  [marketplaceConnections, currentConnectionId],
);
const suggestChannel = currentConnection
  ? resolveSuggestChannel(currentConnection.platformType)
  : null;
const canSuggest = pickedProductId !== null && suggestChannel !== null;
const suggestDisabledHint =
  pickedProductId === null
    ? 'AI suggestions require a picked variant — go back to Step 1 and choose one.'
    : suggestChannel === null && currentConnection
      ? `AI suggestions are not available for ${currentConnection.platformType} yet.`
      : null;

const { setValue: setFormValue } = form;
const handleApplySuggestion = useCallback(
  (suggestion: string) => {
    setFormValue('description', suggestion, { shouldDirty: true, shouldValidate: true });
  },
  [setFormValue],
);
```

### Step 4 — Render the Suggest button next to the description field

Replace the existing description `FormField` (~line 849-855) with the wrapper:

```tsx
<div className="create-offer-description">
  {canSuggest || suggestDisabledHint ? (
    <div className="create-offer-description__actions">
      {canSuggest && pickedProductId !== null ? (
        <SuggestionDialog
          productId={pickedProductId}
          channel={suggestChannel}
          disabled={mutation.isPending}
          onApply={handleApplySuggestion}
        />
      ) : (
        <span
          className="create-offer-description__hint"
          aria-live="polite"
        >
          {suggestDisabledHint}
        </span>
      )}
    </div>
  ) : null}

  <FormField
    label="Description (optional)"
    name="description"
    error={form.formState.errors.description?.message}
  >
    <Textarea {...form.register('description')} rows={4} />
  </FormField>
</div>
```

**Why no `scopeWarning`:** the wizard creates a new offer; there is no "this offer only vs product master" trade-off. The warning copy is drawer-specific.

**The `canSuggest && pickedProductId !== null` redundancy** is intentional — it's the same TypeScript narrowing pattern the drawer uses (`canSuggest && linkedProductId !== null`). `SuggestionDialog`'s `productId` prop is `string` (not `string | null`); the second check narrows the type on the JSX side without a non-null assertion.

### Step 5 — CSS

Add to `apps/web/src/index.css` immediately after the `.edit-offer-drawer__description*` block (~line 6488), keeping the visual neighbourhood:

```css
/* ============================================================
   Create-offer wizard — Suggest button row above the Description
   field (#637) — mirrors the edit-offer drawer's #485 pattern.
   ============================================================ */

.create-offer-description {
  display: grid;
  gap: 0.45rem;
}

.create-offer-description__actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  min-height: 2rem;
}

.create-offer-description__hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-style: italic;
}
```

### Step 6 — Tests

Add `describe('AI suggest (#637)', ...)` block at the end of `CreateOfferWizard.test.tsx`.

Three test cases, all using **1-indexed visible step labels** in `it()` names to match the rest of the file:

1. **`renders the Suggest button on Step 2 once a variant has been picked on Step 1`**
   - Use existing `advanceToStep2()` helper (which lands on `stepIndex === 1` = visible Step 2).
   - Assert `screen.getByRole('button', { name: /suggest with ai/i })` is in the document.

2. **`writes the suggestion into the description field and marks form dirty when applied`**
   - Mock `content.suggest` per-test with the shape from `EditOfferDrawer.test.tsx:166-176`.
   - `advanceToStep2()`, then click Suggest → Generate → Apply.
   - Assert the description textarea has value `'AI copy'`.
   - Assert the form is dirty (Next button stays enabled / re-render observable).

3. **`shows a missing-variant hint on Step 2 when reopened via retry initialValues`**
   - Open wizard with `initialValues` set (use the same fixture shape the existing `retry with initialValues (#307)` describe block uses).
   - Wizard lands on `stepIndex === 1` (Step 2) with completedSteps `[0, 1]`, `pickedProductId` null.
   - Assert the "Suggest with AI" button is NOT in the document.
   - Assert the hint copy matching `/picked variant/i` is shown.

The retry-flow hint copy is generic ("go back to Step 1 and choose one"); it doesn't distinguish *first-time-on-Step-2-with-no-variant* (can't actually happen in fresh flow) from *retry-with-snapshot-lost-product-id*. Accepting the generic copy — adding case-specific copy would require threading a retry flag through and isn't worth it for a recovery-flow edge case. Flagged here for transparency.

For the suggest mock shape:
```ts
content: {
  suggest: vi.fn().mockResolvedValue({
    suggestion: 'AI copy',
    requestId: 'req-1',
    templateKey: 'offer.description.suggest',
    templateVersion: 1,
    templateChannel: 'allegro',
    modelUsed: 'fake',
    latencyMs: 0,
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  }),
}
```

## 5. Quality gate

```bash
pnpm lint        # zero errors
pnpm type-check  # clean
pnpm test        # all wizard + drawer + suggestion-dialog tests pass; +3 new tests
```

## 6. Acceptance check vs issue

- [x] Suggest button rendered next to description field on the description step (Step 2 / `stepIndex === 1`).
- [x] Enabled only when `pickedProductId !== null && suggestChannel !== null`. (Diverges from issue's `selectedProductId` — see §2.)
- [x] When disabled, hint copy explains why; precedence matches drawer.
- [x] Click opens `SuggestionDialog` with correct `productId` and `channel`.
- [x] Apply writes to `description` field with `shouldDirty: true, shouldValidate: true`.
- [x] `EditOfferDrawer` behaviour unchanged.
- [x] Vitest covers visible/enabled, disabled-with-hint, apply-populates.
- [x] No new external libraries.
- [x] Dependency direction: `features/listings → features/content` (already allowed).
