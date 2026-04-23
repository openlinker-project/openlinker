# Implementation Plan — #331 + #316 Test cleanup & Allegro "Before you start" callout

## Scope

Two small frontend polish issues bundled into one PR:

- **#331** (tech-debt) — Add `afterEach(cleanup)` to the 8 page test files that are missing it.
- **#316** (enhancement) — Add a "Before you start" info `Alert` to Step 1 of the Allegro setup wizard, matching the pattern used on the PrestaShop wizard.

Both changes are interface-layer frontend only (no backend, no API, no DB). Classification:
- Layer: Frontend — Interface (page composition) + Frontend — Test infrastructure
- Files: 1 component + 1 component test for #316, 8 page tests for #331

## Non-goals

- **Not** moving `afterEach(cleanup)` into a shared `test-setup.ts` via Vitest `setupFiles`. The optional follow-up in #331 is explicitly called out as out-of-scope for the mechanical fix.
- **Not** changing the sibling PrestaShop callout copy.
- **Not** introducing a new style for the callout — reuse `<Alert tone="info">` and `.mono-text` primitives already in use on Step 3 of the same wizard.
- **Not** touching the two canonical files (`sync-jobs-page.test.tsx`, `webhook-deliveries-page.test.tsx`) — they already have `afterEach(cleanup)`.

## Step 1 — Extend Allegro wizard Step 1 with "Before you start" callout

**File:** `apps/web/src/features/allegro/components/AllegroSetupForm.tsx`

Insert an `<Alert tone="info" title="Before you start">` block at the very top of the `stepIndex === 0` branch, above the "Connection name" `FormField`. Content covers the three onboarding prerequisites listed in #316.

**Copy pattern:** match the PrestaShop sibling (`prestashop-setup-form.tsx:148-152`) — **prose with inline `<strong>` and `.mono-text`**, no `<ol>`. No existing `tone="info"` Alert in `apps/web/src/features/**` uses a list child; `.alert__description` isn't audited for list spacing and introducing one risks the callout looking off against the cockpit baseline. Two short sentences cover the three steps cleanly.

`redirectUri` is already computed at component scope and is available to the Step 1 branch — no new variable.

Link opens in a new tab (`target="_blank" rel="noreferrer noopener"`).

**Acceptance:**
- On load (Step 1), an Alert with title "Before you start" appears above the form fields.
- The alert names the Allegro developer portal (linked), shows the exact redirect URI in a monospaced span, and points to where Client ID / Client Secret come from.
- Steps 2 and 3 callouts remain unchanged.

## Step 2 — Add test for the new callout + opportunistic cleanup

**File:** `apps/web/src/features/allegro/components/AllegroSetupForm.test.tsx`

1. Add a single test inside the existing `describe('AllegroSetupForm', ...)`:

   ```ts
   it('renders the "Before you start" info callout on step 1', () => {
     const { container } = renderWithProviders(<AllegroSetupForm />, { apiClient: defaultApiClient() });
     const scope = within(container);

     expect(scope.getByText(/before you start/i)).toBeInTheDocument();
     expect(scope.getByText(/allegro developer portal/i)).toBeInTheDocument();
     // Redirect URI is rendered across an inline .mono-text span; simplest
     // cross-node substring assertion is on container.textContent.
     expect(container.textContent).toContain('/integrations/allegro/connect/callback');
   });
   ```

2. **Opportunistic cleanup** (addresses the same failure mode as #331): this file is out of #331's scope (it's a feature test, not a page test), but since the file is already being edited and every test here uses `renderWithProviders`, add `afterEach(cleanup);` alongside the existing `afterEach(() => { vi.unstubAllGlobals(); })`. Vitest runs all registered hooks. Add `cleanup` to the `@testing-library/react` import.

**Acceptance:** new test passes; the 6 existing tests continue to pass unchanged; the new cleanup hook prevents future tests in this file from inheriting leaked DOMs.

## Step 3 — Add `afterEach(cleanup)` to the 8 page tests

**Files (each gets the same mechanical change):**
- `apps/web/src/pages/settings/settings-page.test.tsx`
- `apps/web/src/pages/products/product-detail-page.test.tsx`
- `apps/web/src/pages/products/products-list-page.test.tsx`
- `apps/web/src/pages/adapters/adapters-catalog-page.test.tsx`
- `apps/web/src/pages/integrations/allegro-connect-callback-page.test.tsx`
- `apps/web/src/pages/orders/failed-orders-page.test.tsx`
- `apps/web/src/pages/inventory/inventory-detail-page.test.tsx`
- `apps/web/src/pages/inventory/inventory-list-page.test.tsx`

For each file:

1. Add `cleanup` to the existing `@testing-library/react` import.
2. Add `afterEach` to the existing `vitest` import.
3. Inside the top-level `describe(...)` block, register `afterEach(cleanup);` as the first statement, matching the canonical form in `sync-jobs-page.test.tsx`:

```ts
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

describe('SomePage', () => {
  afterEach(cleanup);
  // …tests…
});
```

If a file already has a different `afterEach(...)` (e.g. for `vi.unstubAllGlobals()`), add `afterEach(cleanup);` as an additional call. Vitest runs all registered `afterEach` callbacks.

**Acceptance:**
- `grep -rL "afterEach(cleanup)" apps/web/src/pages --include="*.test.tsx"` returns zero results.
- `pnpm test` still passes.

## Step 4 — Quality gate

Run in sequence from repo root:

```bash
pnpm lint
pnpm type-check
pnpm test
```

All three must pass with zero errors before commit.

## Validation

- **Architecture compliance:** no cross-boundary changes; no new shared primitives; no new CSS; no backend edits. Frontend dependency direction preserved — edits stay inside `pages/**` tests and a single `features/allegro` component.
- **Naming conventions:** no file renames; `AllegroSetupForm.tsx` keeps its existing PascalCase name (pre-existing; not in scope to rename per kebab-case rule).
- **Testing:** #316 adds one passing test; #331 preserves all existing tests while immunising them against a real failure mode (multiple elements matched across leaked DOMs).
- **Security:** no new input handling; the external link uses `rel="noreferrer noopener"`.
- **Risk:** Very low. The 8-file `afterEach(cleanup)` change is mechanical and idempotent — if any test was secretly relying on cross-test DOM leakage it will surface as a broken test on first run.

## Commit plan

Two commits on the same branch — types reflect the nature of each change (per Conventional Commits and recent history):

```
test(web): add afterEach(cleanup) to page and feature tests

Prevent cross-test DOM leakage by registering afterEach(cleanup) in the
8 page test files that were missing it, plus the AllegroSetupForm feature
test (opportunistic, since #316 touches it in a follow-up commit).

Closes #331
```

```
fix(web): add "Before you start" callout to Allegro wizard step 1

Align Allegro connection wizard with the PrestaShop sibling: render an
info Alert above the credentials fields telling operators to register a
developer app, register the redirect URI, and copy Client ID/Secret.

Closes #316
```

## Out of scope / follow-up

- `AllegroSetupForm.tsx` and `AllegroSetupForm.test.tsx` use PascalCase filenames, while `docs/frontend-architecture.md` § *Components And Pages* mandates kebab-case (`allegro-setup-form.tsx`). Sibling `prestashop-setup-form.tsx` already follows the rule. Pre-existing — handle in a dedicated rename issue.
