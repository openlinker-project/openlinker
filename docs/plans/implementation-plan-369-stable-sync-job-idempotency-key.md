# Implementation plan — #369 Stable idempotency key for manual sync job triggers

## 1. Goal

The `TriggerSyncDialog` client-generates its idempotency key by embedding `Date.now()` into the suffix. Because `Date.now()` changes on every call, the backend dedup infrastructure (Redis `SET NX` on `idempotencyKey`, Postgres unique index on `sync_jobs.idempotency_key`) cannot ever collapse rapid double-submits into a single `sync_jobs` row. A fast double-click or a retry-after-failure currently produces N distinct keys → N distinct jobs.

Fix: generate **one stable idempotency key per dialog open cycle** and reuse it across every submit attempt inside that cycle (including retries after a failed enqueue). A fresh key is minted each time the dialog is reopened, so genuinely distinct user intents remain distinct.

## 2. Classification

- **Type**: Frontend (bug fix)
- **Layer**: `features/sync-jobs` — feature component + colocated test
- **Surface area**: 1 component file + 1 test file
- **Scope size**: tiny. Roughly 10 lines changed + 2 new tests.

## 3. Non-goals

- **No backend changes.** `sync.controller.ts`, `redis-streams-job-enqueue.service.ts`, `sync-job.repository.ts` all work correctly when given a stable key; the broken contract is entirely on the client.
- **No server-side enforcement** of "only server may generate idempotency keys." The issue mentions this as a possible future second-line defence; it's out of scope for this PR.
- **No changes to the `isPending` disable guard** on the Trigger button. That guard is correct — the bug is the timing window where the state flip isn't instantaneous. The stable key fixes that window directly at the key layer.
- **No changes to `useEnqueueSyncJobMutation`** — the hook is fine; the bug is at the call site.
- **No changes to the idempotency key format beyond the suffix.** Still `manual:{connectionId}:{jobType}:{stable-suffix}` per the issue's explicit readability request.

## 4. Files in scope

| File | Change |
|---|---|
| `apps/web/src/features/sync-jobs/components/TriggerSyncDialog.tsx` | Add `intentKey` state, mint via `crypto.randomUUID()` in the existing `useEffect(open)`, use it in `handleSubmit` instead of `Date.now()`. |
| `apps/web/src/features/sync-jobs/components/TriggerSyncDialog.test.tsx` | Add two tests: (a) retry-after-failure reuses the key; (b) reopening the dialog mints a fresh key. |

## 5. Design

### 5.1 Why "per dialog open cycle" is the right scoping unit

Three candidate scopings for "one intent":

1. **Per mutateAsync call** — current, broken. Defeats dedup.
2. **Per dialog open cycle** — mint on open, reset on close. What I'm proposing.
3. **Per (dialog open + job type) tuple** — mint on open, re-mint when user switches job type.

Option 3 is slightly more conservative: if the user opens the dialog, picks job A, submits (succeeds), then picks job B and submits, you want those to be distinct jobs. But in practice, option 2 already handles that correctly because the idempotency key is `manual:{connId}:{jobType}:{uuid}` — the `jobType` segment changes when the user switches, so the full key changes even with a stable UUID. So option 2 is sufficient and simpler.

Option 2 collapses:
- Rapid double-click on the Trigger button → same key, one job
- Retry after network failure → same key, backend returns existing job
- Keyboard enter-mashing → same key, one job

Option 2 keeps distinct:
- Submit job A → close dialog → reopen → submit job A again → new UUID, new key, new job
- Submit job A → switch to B → submit → different `jobType` segment, different key, new job

### 5.2 Mint timing

The component already has a `useEffect(() => { if (open) { ... } }, [open])` that resets `selectedJobType`, `payloadValues`, `fieldErrors`, and the mutation state on open. The `intentKey` belongs in that same effect — it's part of the "fresh dialog session" initialization.

```tsx
const [intentKey, setIntentKey] = useState<string | null>(null);

useEffect(() => {
  if (open) {
    // ... existing resets
    setIntentKey(crypto.randomUUID());
  }
}, [open]);
```

Setting to `null` on close is unnecessary — the next open always overwrites, and reading `intentKey` only happens inside `handleSubmit` which is only reachable when the dialog is open.

### 5.3 Consumption

```tsx
// handleSubmit
if (!selectedJob || !validate() || intentKey === null) return;
// ...
await enqueueSyncJob.mutateAsync({
  connectionId: connection.id,
  jobType: selectedJob.jobType,
  payload,
  idempotencyKey: `manual:${connection.id}:${selectedJob.jobType}:${intentKey}`,
});
```

The `intentKey === null` guard is defensive — it should never hold when the dialog is visible, since the effect runs synchronously when `open` flips to `true`. But the type is `string | null`, and narrowing at the use site keeps TypeScript happy without a non-null assertion.

### 5.4 `crypto.randomUUID()` availability

- Browsers: shipped in all evergreen browsers since 2022.
- `happy-dom` (the vitest environment for `apps/web`, see `apps/web/vite.config.ts`): `crypto.randomUUID()` is supported since happy-dom v6; the repo is on v19 at time of writing. Safe.
- No polyfill needed.

### 5.5 Key format preserved

Issue explicitly asked for readability: `manual:{connId}:{jobType}:{stable-suffix}`. The new format matches: only the suffix changes from a mutable epoch millisecond to a stable UUID. Job-log readers still see `manual:ol_connection_...:master.product.syncAll:f47ac10b-...`.

## 6. Step-by-step implementation

### Step 1 — `TriggerSyncDialog.tsx` component change

1. Add `intentKey` state after the existing `fieldErrors` state (line ~158):

   ```tsx
   const [intentKey, setIntentKey] = useState<string | null>(null);
   ```

2. Extend the existing `useEffect(() => { if (open) { ... } }, [open])` (line ~164) to also mint the key:

   ```tsx
   setIntentKey(crypto.randomUUID());
   ```

3. In `handleSubmit` (line ~196), add `intentKey === null` to the early-return guard, and replace the inline `Date.now()` with `intentKey`:

   ```tsx
   if (!selectedJob || !validate() || intentKey === null) return;
   // ...
   idempotencyKey: `manual:${connection.id}:${selectedJob.jobType}:${intentKey}`,
   ```

Acceptance: diff touches only three regions of the file; no other behaviour changed.

### Step 2 — `TriggerSyncDialog.test.tsx` test additions

Add two new `it()` blocks under the existing `describe` that covers submission:

**Test A — "reuses the same idempotency key when resubmitting after a failed enqueue"**

```tsx
it('reuses the same idempotency key across retries after a failed submit', async () => {
  const enqueue = vi
    .fn()
    .mockRejectedValueOnce(new Error('enqueue failed'))
    .mockResolvedValueOnce({ jobId: 'job-123', isExisting: false });
  const apiClient = createMockApiClient({ syncJobs: { enqueue } });

  renderWithProviders(<TriggerSyncDialog {...baseProps} />, { apiClient });

  // First click → fails
  await userEvent.click(screen.getByRole('button', { name: /trigger/i }));
  await screen.findByText(/failed to enqueue job/i);

  // Second click (user retries) → succeeds
  await userEvent.click(screen.getByRole('button', { name: /trigger/i }));

  expect(enqueue).toHaveBeenCalledTimes(2);
  const firstKey = enqueue.mock.calls[0][0].idempotencyKey;
  const secondKey = enqueue.mock.calls[1][0].idempotencyKey;
  expect(firstKey).toBe(secondKey); // stable across retries within the same dialog open cycle
  expect(firstKey).toMatch(/^manual:[^:]+:[^:]+:[0-9a-f]{8}-[0-9a-f]{4}/); // format guard
});
```

**Test B — "mints a fresh idempotency key when the dialog is closed and reopened"**

```tsx
it('mints a fresh idempotency key on each dialog open cycle', async () => {
  const enqueue = vi.fn().mockResolvedValue({ jobId: 'job-123', isExisting: false });
  const apiClient = createMockApiClient({ syncJobs: { enqueue } });

  const { rerender } = renderWithProviders(
    <TriggerSyncDialog {...baseProps} open={true} />,
    { apiClient },
  );
  await userEvent.click(screen.getByRole('button', { name: /trigger/i }));

  // Close
  rerender(<TriggerSyncDialog {...baseProps} open={false} />);
  // Reopen
  rerender(<TriggerSyncDialog {...baseProps} open={true} />);

  await userEvent.click(screen.getByRole('button', { name: /trigger/i }));

  expect(enqueue).toHaveBeenCalledTimes(2);
  const firstKey = enqueue.mock.calls[0][0].idempotencyKey;
  const secondKey = enqueue.mock.calls[1][0].idempotencyKey;
  expect(firstKey).not.toBe(secondKey); // distinct intents across dialog sessions
});
```

Acceptance: both tests pass with the patched component; at least one fails against the unpatched component (the pre-fix `Date.now()` would let both keys differ even within one open cycle, breaking Test A).

### Step 3 — Quality gate

```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # all tests pass
```

Pre-commit hook runs the same gate.

## 7. Validation

- **Architecture**: pure FE component change, no new abstractions, state ownership rules unchanged (local component state for `intentKey` is correct per `docs/frontend-architecture.md` — "short-lived interaction state" lives in component-local `useState`).
- **Naming / conventions**: `intentKey` matches `camelCase`; no new files; no new exports.
- **No `any`, no `console.log`, no secrets**: change is one `useState<string | null>` and a `crypto.randomUUID()` call.
- **Accessibility**: no markup change, no a11y impact.
- **Security**: idempotency keys are not authentication tokens; the random UUID is just a dedup nonce. No risk introduced.
- **Testing strategy**: two new focused component tests in the existing spec file; mocks use the established `createMockApiClient()` + `renderWithProviders()` pattern per `.claude/rules/fe-pages.md`.

## 8. Risks & open questions

- **Risk — none material.** Worst case if `crypto.randomUUID()` were unavailable (it isn't, but hypothetically): a static fallback like `String(Math.random()).slice(2) + String(Date.now())` would still give a stable per-intent key. Not implementing a fallback because happy-dom v19 and all supported browsers cover it.
- **Open question — none.** The issue is prescriptive about scope, the fix is single-call-site, and there's no ambiguity about what "one intent" means for this dialog (= one open cycle).

## 9. Acceptance checklist (from the issue)

- [ ] Rapid double-click on the *Trigger* button produces at most one `sync_jobs` row (via backend dedup on the stable key).
- [ ] Unit/component test covering duplicate-submit prevention (Test A — retry reuses key).
- [ ] No regression for genuinely distinct triggers (Test B — reopen mints a fresh key).
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` pass.
