# Implementation Plan — #796 Bulk wizard Resolve-step timeout downgrade fix

## Phase 1 — Understand the task

**Goal.** Stop the bulk-create wizard's Resolve step (`apps/web/src/features/listings/components/bulk/bulk-resolve-step.tsx`) from silently downgrading already-settled rows to `pending-after-timeout` 15 seconds after mount, even when the resolve loop completed long before.

**Layer.** Frontend (`features/listings/components/bulk/`).

**Non-goals.**
- Rearchitecting the Resolve step around the batch capability (`EanCategoryMatcher.resolveCategoriesForBatchByEan`) — that's #795.
- Fixing the upstream Allegro endpoint correctness — already landed (#794, PR #797).
- Touching `useResolveCategoryQuery` stale-time or `pAllLimit` concurrency.

## Phase 2 — Research

**Root cause** (from issue #796 + code at `bulk-resolve-step.tsx:154-164`):

```ts
useEffect(() => {
  const timeoutId = window.setTimeout(() => {
    onComplete(buildOutcomes(rows, resolved, true));   // ← stale `resolved` from closure
  }, BULK_RESOLVE_TIMEOUT_MS);
  return () => { window.clearTimeout(timeoutId); };
}, []);  // ← `[]` deps: closes over seed-time `resolved`
```

Two compounding problems:
1. **Stale closure.** `[]` deps captures `rows` + `resolved` from the first render. `resolved` is the seed map (only `no-ean` / `no-variant` rows). EAN-bearing rows are absent.
2. **Unconditional fire.** Resolve loop success path at `bulk-resolve-step.tsx:138-139` calls `setResolved` + `onComplete` but leaves the timer running. At T+15s it fires again with the stale map → `buildOutcomes` returns `pending-after-timeout` for every EAN-bearing row → parent wizard overwrites their settled statuses.

**Parent guard is partial** (`bulk-wizard.tsx:91-96`):

```ts
if (row.status === 'matched' && o.status === 'pending-after-timeout') {
  return row;
}
```

Only `matched` rows are protected. `no-match` / `no-ean` / `no-variant` rows get downgraded.

**No existing tests** for `bulk-resolve-step.tsx` or `bulk-wizard.tsx` (verified with `find apps/web/src/features/listings -name "*.test.*"`). Test infrastructure available: `renderWithProviders()` + `createMockApiClient()` from `apps/web/src/test/test-utils.tsx`; pattern reference in `AllegroCreateOfferWizard.test.tsx`. Vitest is the runner; `vi.useFakeTimers()` is the standard for time-dependent specs.

## Phase 3 — Design

Three localised changes, no behaviour change in the happy path.

### 3a. `bulk-resolve-step.tsx` — refs

Three refs in module body:
- `resolvedRef` — mirrors `resolved` state. Synced in a small `useEffect` keyed on `[resolved]`.
- `completedRef` — boolean. Set to `true` in the resolve-loop success path before calling `onComplete`.
- `timerRef` — `number | null`. Holds the timeout id so the success path can `clearTimeout` it.

Timeout effect changes:
- Stores the timer in `timerRef.current`.
- Callback short-circuits with `if (completedRef.current) return;`.
- Reads `resolvedRef.current` instead of the closure-captured `resolved`.
- Cleanup uses the ref.

Resolve-loop success path changes:
- Sets `completedRef.current = true`.
- Clears `timerRef.current` via `window.clearTimeout` before `onComplete`.

The `cancelled` flag stays — it guards against React unmount mid-await of the resolve loop.

### 3b. `bulk-wizard.tsx` — guard widening

Replace the narrow `matched`-only guard with:

```ts
if (
  o.status === 'pending-after-timeout' &&
  row.status !== 'resolving' &&
  row.status !== 'pending-after-timeout'
) {
  return row;
}
```

Reads: "Any `pending-after-timeout` outcome arriving for a row that's already in a terminal state is ignored." Defence in depth — the resolve-step fix should prevent the stale `onComplete` from firing in the first place; this guard protects against any future regression.

### 3c. New component test: `bulk-resolve-step.test.tsx`

Two test cases under `describe('BulkResolveStep')`:

1. **`should not overwrite settled outcomes when the 15s timeout fires after resolves complete`**
   - Mock `resolveCategory` to resolve immediately with `{ allegroCategoryId: 'cat-A', method: 'auto_detect' }` for one row.
   - Mount with `vi.useFakeTimers()`.
   - `await vi.runOnlyPendingTimersAsync()` (or `act` + `vi.advanceTimersByTime(0)` to drain microtasks) to let the resolve loop settle.
   - Assert `onComplete` called with row status = `matched`.
   - Advance timers by 16 s.
   - Assert `onComplete` was NOT called a second time, OR the second call (if any) carries the same `matched` status.
   - Implementation note: with `completedRef`, the second call is suppressed entirely — assert `mockOnComplete.mock.calls.length === 1`.

2. **`should flag only unsettled rows as pending-after-timeout when the 15s deadline hits before resolves complete`**
   - Two rows: one resolves immediately, one resolves after a controllable delay (use `new Promise<never>(() => {})` for the slow one OR `vi.advanceTimersByTime` to control).
   - Mount with `vi.useFakeTimers()`.
   - Advance timers past the resolve of the fast row but before the slow one settles.
   - Advance timers by full `BULK_RESOLVE_TIMEOUT_MS`.
   - Assert `onComplete` was called with: fast row = `matched`, slow row = `pending-after-timeout`.

Tests use `renderWithProviders` + `createMockApiClient`. Standard vitest pattern: `vi.useFakeTimers({ shouldAdvanceTime: true })` to allow `act`/Testing Library async helpers to coexist with the fake clock; `vi.useRealTimers()` in `afterEach`.

### Why not also test `bulk-wizard.tsx`?

The wizard guard widening is a small in-place change; the resolve-step tests already exercise the *spirit* of the regression (no overwrite on settled rows). Adding a `bulk-wizard.test.tsx` would test internals of `handleResolveComplete` — the natural test of the wizard's downgrade resistance is the resolve-step test, since the wizard is purely a downstream consumer. Skip the dedicated wizard test for now; revisit if the guard widens further in a future PR.

## Phase 4 — Step-by-step plan

### Step 1 — Add the three refs to `bulk-resolve-step.tsx`

Add `import { useRef }` (already imported), declare `resolvedRef` / `completedRef` / `timerRef` after the existing `startedRef`. Add a small `useEffect([resolved])` to mirror state to the ref.

**Acceptance:** Refs declared with correct initial values (`resolvedRef.current = resolved` initial, `completedRef.current = false`, `timerRef.current = null`).

### Step 2 — Wire the resolve-loop success path

Before `setResolved(next)` + `onComplete(...)`:

```ts
completedRef.current = true;
if (timerRef.current !== null) {
  window.clearTimeout(timerRef.current);
  timerRef.current = null;
}
```

**Acceptance:** Success path explicitly cancels the timer and flips the completion flag before notifying the parent.

### Step 3 — Rewrite the timeout effect

```ts
useEffect(() => {
  timerRef.current = window.setTimeout(() => {
    if (completedRef.current) return;
    onComplete(buildOutcomes(rows, resolvedRef.current, true));
  }, BULK_RESOLVE_TIMEOUT_MS);
  return () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
}, []);
```

**Acceptance:** Timer fires only if resolves haven't completed; reads through `resolvedRef` so partial-settle state survives.

### Step 4 — Widen the wizard guard in `bulk-wizard.tsx`

Replace the narrow `matched`-only guard with the broader check from § 3b.

**Acceptance:** Any `pending-after-timeout` outcome for a row already in a terminal state is rejected.

### Step 5 — Add `bulk-resolve-step.test.tsx`

Two cases per § 3c. Use `renderWithProviders` + `createMockApiClient` + `vi.useFakeTimers`. Mock `apiClient.listings.resolveCategory`.

**Acceptance:** Both tests pass; regression test fails against the pre-fix code (verify by temporarily reverting Step 1-3 and re-running).

### Step 6 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
```

All green. No integration tests touched.

## Phase 5 — Validate

**Architecture compliance.**
- All changes inside `features/listings/components/bulk/` — same feature module.
- No new cross-boundary imports.
- State ownership unchanged: resolve outcomes stay local to the wizard subtree.

**Naming.** No new files outside the canonical feature structure. Test file: `bulk-resolve-step.test.tsx` colocated with source per project convention.

**Testing strategy.** Two tests cover both branches of the bug (success-path-then-timeout, and slow-resolves-legitimately-timing-out). Mocking strategy uses the documented `createMockApiClient` boundary — no internal-state inspection.

**Risks.**
- Fake-timer interactions with TanStack Query's `fetchQuery` need care. Using `vi.useFakeTimers({ shouldAdvanceTime: true })` keeps real timers running underneath where the test runner needs them. If this turns out fragile, fall back to `vi.useFakeTimers()` with explicit `vi.advanceTimersByTimeAsync(...)` calls.
- The wizard guard widening is broader than the original. The only legitimate path that produces a `pending-after-timeout` outcome is the timeout effect — which post-fix only fires when resolves haven't completed. So broadening can't suppress a real signal.

**Open questions.** None.
