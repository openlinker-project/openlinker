# Implementation Plan — Remove dead topbar search input (#220)

## 1. Task restatement

The `AppShell` topbar renders a search `<Input type="search" placeholder="Search orders, products, jobs…" />` with no `onChange`, no routing, and no results UI. It is visibly interactive but functionally dead — typing does nothing, `Enter` does nothing. Issue #220 proposes two resolutions and explicitly recommends **Option A** for MVP: remove the input so the UI stops lying about a feature that doesn't exist. A keyboard shortcut hint (⌘K) can be added later when real search is wired.

**Layer:** Frontend (FE) shell only. No API, no feature module, no routing change.

**Non-goals (deliberately out of scope):**
- Implementing real global search (Option B). Filed as a future issue; when wired, the UI comes back.
- Adding a `⌘K` keyboard-shortcut skeleton without a handler — that just recreates the same "UI implies a feature that doesn't exist" problem at smaller scale.
- Changing `AppShell`'s layout model or breakpoints. The `shell-topbar__spacer` already eats the empty space the search used to occupy; no layout jitter expected.

## 2. Fix

Remove the search `<label>` block and the now-unused `Input` import from `app-shell.tsx`, drop the three `.shell-search` CSS blocks from `index.css`, and add a regression test that asserts no `role="searchbox"` control is rendered in the shell.

Leave a one-line JSX comment at the former location (`{/* Global search — planned. See #220. */}`) as the "marker" the issue's acceptance criteria calls for.

## 3. Step-by-step plan

### Step 1 — `apps/web/src/shared/ui/app-shell.tsx`

- Remove the `<label className="shell-search">…<Input type="search" …/></label>` block (currently lines 280–283).
- Remove `import { Input } from './input';` on line 12 (this is the only use of `Input` in the file — confirmed via grep).
- Leave a JSX comment at the removed location so future readers can find the trail: `{/* Global search — planned. See #220. */}`.

### Step 2 — `apps/web/src/index.css`

- Delete the three `.shell-search` rules (base `display: none` + the `@media (min-width: 768px)` block + the nested `.shell-search .control / input` rule, currently lines 610–627).
- No other rule references `.shell-search` — verified via grep.

### Step 3 — `apps/web/src/shared/ui/app-shell.test.tsx`

- Add one regression test: `it('does not render a dead global search input in the topbar', …)` that asserts `screen.queryByRole('searchbox')` returns `null`. This locks in the removal and will fail loudly if anyone adds an input back without wiring it.
- Use the existing `renderShell('/')` helper already at the top of the file.

## 4. Acceptance criteria (map to issue)

- [x] Dead input removed → **no silent dead UI**.
- [x] Marker left at the removed location (`{/* Global search — planned. See #220. */}`) per the issue's "if removed: `<!-- planned -->` comment or `planned` badge" rule.
- [x] Regression test added — any future re-introduction without wiring will break CI.
- [x] No `⌘K` / `/` shortcut added — intentionally deferred (bullet in the issue's acceptance is conditional on `input is kept`, which it isn't).

## 5. Validation

- `pnpm lint` — expected clean. Removing the `Input` import clears the only risk (strict `noUnusedLocals`).
- `pnpm type-check` — expected clean.
- `pnpm test` — expected clean; the new test should pass, and no other test currently references the search input.

## 6. Risks / trade-offs

- **Visual jitter at desktop width.** The `.shell-search` rule only displays the input at ≥ 768 px with `flex: 0 1 320px`. After removal, the topbar's `shell-topbar__spacer` (currently `flex: 1`, to its left) will absorb the 320 px + gap. Alerts button stays right-aligned; no layout change on mobile. Verified by reading the flex declarations; no visual QA artifact attached to this PR because there's nothing to compare — the "before" was a fake affordance.
- **"Operators expect search".** Accepted in the issue itself: better to have no search than a lying one. Real search returns when #220 is reopened for Option B (or a successor issue).
