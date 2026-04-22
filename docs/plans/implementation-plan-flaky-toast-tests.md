# Implementation Plan — Flaky toast tests (#309)

## 1. Task restatement

Two tests fail ~25% of full-suite runs and 0% in isolation:

1. `apps/web/src/pages/dashboard/dashboard-page.test.tsx` → `DashboardPage > "What's broken right now" triage surface > shows an honest "nothing re-queued" toast when the bulk endpoint returns count=0`
   - Failure: `Found multiple elements with the text: /no dead jobs remain/i` on line 443.
2. `apps/web/src/features/listings/components/EditOfferDrawer.test.tsx` → `EditOfferDrawer > should show success toast and close drawer on successful submit`
   - Failure: `Found multiple elements with the text: /update dispatched/i` on line 119.

**Layer:** Frontend (FE) — test-only.

**Non-goals:**
- No changes to `apps/web/src/shared/ui/toast-provider.tsx`.
- No changes to Radix Toast usage or app behavior.
- No changes to `renderWithProviders` shape.

## 2. Root cause

`@radix-ui/react-toast@1.2.15` renders **two DOM nodes per toast**:

1. The **visible toast** — rendered into `<RadixToast.Viewport>` (our `.toast-region`) via `ReactDOM.createPortal`, containing `.toast__title` and `.toast__description`.
2. A **screen-reader announce portal** (`ToastAnnounce`) — a separate `@radix-ui/react-portal` wrapping a `VisuallyHidden` span whose text is `context.label + " " + announceTextContent`. `announceTextContent` is populated from the visible toast's DOM by a `useEffect` **after** the first render, and the announce hides itself (`isAnnounced=true → return null`) **1000ms** after mount.

Key source references (`@radix-ui/react-toast@1.2.15/dist/index.js`):
- `ToastImpl` renders `<ToastAnnounce>` + `createPortal(visibleToast)` as siblings (line ~414–423).
- `ToastAnnounce` uses `Portal` + `VisuallyHidden` (line ~529).
- `setIsAnnounced` fires after 1000ms (line ~525).

So any `getByText(...)` that matches the toast body text will intermittently match **both** the visible `.toast__title`/`.toast__description` and the VisuallyHidden announce span. The flake window is the ~1s during which both exist.

For the two failing tests specifically:
- `findByText(/…/)` polls — it returns once exactly one match exists. It typically wins the race because `announceTextContent` is populated in a `useEffect` **after** the first visible render, so for one or two animation frames only the visible toast is in the DOM.
- The very next `screen.getByText(/…/)` line runs synchronously after `findByText` resolves. Under parallel-worker load, the microtask/scheduler gap is long enough for React to commit the announce update — resulting in 2 matches → `getByText` throws.

This matches the observed "fails ~25%, isolated 0%" profile and the specific failure line in both tests.

An existing precedent already applies the fix in `apps/web/src/features/sync-jobs/components/TriggerSyncDialog.test.tsx:235-260` — with a comment explaining the duplicate.

## 3. Fix

Scope text queries to the **visible** toast elements using the existing class selectors `.toast__title` and `.toast__description`. This bypasses the a11y announce portal entirely. No retries, no waitFor padding, no timing assumptions, no production changes.

Rather than scatter the `{ selector: '.toast__title' }` idiom (plus its explanatory comment) across every new call site, **extract four test helpers into `apps/web/src/test/test-utils.tsx`** — the file that already owns `renderWithProviders`:

```tsx
// test/test-utils.tsx (new)
export function findToastTitle(text: string | RegExp): Promise<HTMLElement> { ... }
export function getToastTitle(text: string | RegExp): HTMLElement { ... }
export function findToastDescription(text: string | RegExp): Promise<HTMLElement> { ... }
export function getToastDescription(text: string | RegExp): HTMLElement { ... }
```

One JSDoc block at the top of the helpers explains the Radix `ToastAnnounce` race once, so future toast-asserting tests don't have to rediscover it.

Apply by replacing call sites with the helpers in:
1. `apps/web/src/pages/dashboard/dashboard-page.test.tsx` — four toast-body assertions in the triage surface describe block (success, skipped, nothing-requeued).
2. `apps/web/src/features/listings/components/EditOfferDrawer.test.tsx` — one toast-title assertion.
3. `apps/web/src/features/connections/components/create-connection-form.test.tsx` — proactive: two assertions in "shows a success toast after creating a connection".
4. `apps/web/src/features/sync-jobs/components/TriggerSyncDialog.test.tsx` — fold the existing `{ selector: … }` pattern (lines 251-259) into the new helpers so the entire codebase converges on one shape.

## 4. Step-by-step plan

### Step 1 — Fix `dashboard-page.test.tsx`

Scope the four toast-text assertions in the `"What's broken right now" triage surface` describe block:

- Line 378: `screen.findByText(/Re-queued 3 jobs/i)` → scope to `.toast__title`.
- Line 409-410: `screen.findByText(/skipped 2 already running/i)` → scope to `.toast__description`.
- Line 442: `screen.findByText(/Nothing re-queued/i)` → scope to `.toast__title`.
- Line 443: `screen.getByText(/no dead jobs remain/i)` → scope to `.toast__description`.

Add a one-line explanatory comment above the block (same as `TriggerSyncDialog.test.tsx`) so future readers don't re-introduce the flake.

**Acceptance:** The affected test file passes 20/20 in a loop.

### Step 2 — Fix `EditOfferDrawer.test.tsx`

- Line 119: `screen.findByText(/update dispatched/i)` → scope to `.toast__title`.

**Acceptance:** File passes 20/20 in a loop.

### Step 3 — Fix `create-connection-form.test.tsx`

- Line 57: `screen.findByText('Connection created')` → scope to `.toast__title`.
- Line 59: `screen.getByText('Connection "Main PrestaShop Store" was created.')` → scope to `.toast__description`.

**Acceptance:** File passes 20/20 in a loop.

### Step 4 — Stability validation

Run `pnpm --filter @openlinker/web test` 20 consecutive times. All must pass.

Final pre-push quality gate (matches CI, repo-wide):
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`

### Step 5 — Ship

Self-review, commit (`test(web): scope toast-text assertions past Radix a11y announce portal`), push, PR with `Closes #309`.

## 5. Risks / trade-offs

- **Coupling tests to CSS class names.** `.toast__title` and `.toast__description` are already structurally stable (used across `toast-provider.tsx` and CSS tokens in `index.css`). If someone later restructures the toast markup, the failure mode is a loud test miss (`getByText` throws immediately), never a production regression. Cheap risk, contained by the helpers.
- **Not fixing the Radix announce portal globally.** Tempting to add a teardown hook or wrapper to `ToastProvider`, but the task explicitly forbids production changes. The test-only fix is the cheapest and most targeted.
- **Scope widened beyond the two failing tests.** Fixing the success/skipped assertions in the same dashboard test file (and proactively touching `create-connection-form.test.tsx`) is intentional: the latent race exists everywhere we assert toast text, and whack-a-mole is its own antipattern. Called out in the PR description so reviewers don't read it as scope creep.
- **PR #303 wizard tests not touched.** The acceptance says they must still pass 20/20 — they don't use toast-text assertions today, so unaffected.
