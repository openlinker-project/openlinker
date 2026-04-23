# Implementation Plan — #321 Sync Jobs & Webhook Deliveries connection resolution + picker

## Scope

Two triage pages (`/jobs-logs`, `/webhook-deliveries`) currently render raw connection UUIDs in the `Connection` column and filter by a free-text `<Input>`. Operators have no way to triage without round-tripping through the Connections list to look up or copy IDs.

Mirror the pattern that already ships on `/orders/failed` (PR #357):
- Column → `<ConnectionEntityLabel>` (name + shortened ID badge + copy button + "Unknown" fallback)
- Filter → `<Select>` populated from `useConnectionsQuery()`, "All connections" as the empty option

Both changes are interface-layer frontend only. Classification:
- Layer: Frontend — Interface (page composition + feature hook reuse)
- Files: 2 pages + 2 colocated tests
- No backend, no API, no DB

## Decision log

**Column rendering — ConnectionEntityLabel (Option A) vs. Map lookup from useConnectionsQuery (Option B).**
Chose **A**. Rationale: consistency with the Failed Orders triage page (#357) — same copy-ID button, same "Unknown" fallback, same loading affordance. The cost is N+1 detail fetches (one `GET /connections/:id` per unique connectionId on-screen, bounded by TanStack Query dedup). The list query the page already issues for the filter dropdown is not shared with `useConnectionQuery`'s detail cache — different query keys. This N+1 is a pre-existing pattern Failed Orders already ships; repeating it here keeps all three triage pages consistent, and the fix (prime `useConnectionQuery` cache from `useConnectionsQuery` list results) is a small follow-up that retroactively benefits every page at once. **Follow-up commitment:** file an issue after this PR merges to prime the detail cache from the list query.

## Non-goals

- **Not** converting the Webhook Deliveries `provider` free-text filter to a `<Select>`. The issue explicitly permits this as a follow-up ("Fold into this task if trivial; otherwise leave for a follow-up"). Providers aren't a fixed enum at the FE layer today (backend can accept any string), and adding a hardcoded `['prestashop', 'allegro']` option list is a separate judgment call. Leaving free-text.
- **Not** changing the `DataTable` row-link behavior. Both pages already use `rowHref` which wraps each row in a link — so `ConnectionEntityLabel` must use `linkToDetail={false}` to avoid nested `<a>` tags (same reason Failed Orders uses `linkToDetail={false}`).
- **Not** rendering an "orphan" option when the URL contains a `connectionId` that doesn't match any active connection. Filter still fires (URL param is passed through); the `<Select>` just shows its default. Matches Failed Orders behavior. Can be addressed in a follow-up if operators report confusion.
- **Not** populating the `useConnectionQuery` (detail) cache from `useConnectionsQuery` (list) to eliminate N+1 detail fetches. Failed Orders already ships this N+1 pattern; a fix here would help all three triage pages at once and is a separate, cross-cutting concern.
- **Not** renaming `sync-jobs-page.tsx`'s URL from `/jobs-logs` (that's a separate routing cleanup).

## Step 1 — Sync Jobs: Connection column → `ConnectionEntityLabel`

**File:** `apps/web/src/pages/sync-jobs/sync-jobs-page.tsx`

1. Add imports at the top (alphabetical where relevant):
   ```ts
   import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
   import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
   ```
2. Replace the current `connectionId` column cell:
   ```ts
   // Before
   cell: (job) => (
     <span className="mono-text" title={job.connectionId}>{job.connectionId}</span>
   ),
   // After
   cell: (job) => (
     <ConnectionEntityLabel connectionId={job.connectionId} linkToDetail={false} showId />
   ),
   ```
3. Update the `cardView.subtitle` to render the same label compactly (`showId={false}` for the denser card view, matching Failed Orders' card pattern):
   ```ts
   cardView={{
     title: (job) => job.jobType,
     subtitle: (job) => (
       <ConnectionEntityLabel connectionId={job.connectionId} linkToDetail={false} showId={false} />
     ),
     meta: (job) => <SyncJobStatusBadge status={job.status} />,
   }}
   ```

**Untruncated-ID acceptance:** `EntityLabel` renders the ID inside a `<code className="entity-label__id mono-text" title={id}>` span. Hovering reveals the full ID; a Copy button copies it verbatim. Unknown-connection fallback renders `<span title={id}>Unknown</span>`. Satisfies the issue's "title attribute with the untruncated connection ID" requirement.

## Step 2 — Sync Jobs: Connection filter → `<Select>`

**File:** `apps/web/src/pages/sync-jobs/sync-jobs-page.tsx`

1. Invoke `const connectionsQuery = useConnectionsQuery();` inside the component body (after the existing `useSyncJobsQuery`). Destructure `const connections = connectionsQuery.data ?? [];`.
2. Replace the free-text connection filter:
   ```tsx
   // Before
   <Input
     aria-label="Filter by connection ID"
     placeholder="Connection ID"
     value={connectionId ?? ''}
     onChange={(e) => { setFilter('connectionId', e.target.value); }}
   />
   // After
   <Select
     aria-label="Filter by connection"
     value={connectionId ?? ''}
     onChange={(e) => { setFilter('connectionId', e.target.value); }}
   >
     <option value="">All connections</option>
     {connections.map((c) => (
       <option key={c.id} value={c.id}>{c.name}</option>
     ))}
   </Select>
   ```
3. Remove the now-unused `Input` import if no other filter uses it. (The page doesn't import `Input` for anything else on post-change state, so drop the line.)

URL param name (`connectionId`) is preserved, so existing bookmarks/deep links remain valid.

## Step 3 — Webhook Deliveries: Connection column → `ConnectionEntityLabel`

**File:** `apps/web/src/pages/webhook-deliveries/webhook-deliveries-page.tsx`

Same change as Step 1, adapted:
1. Add the two imports (`useConnectionsQuery`, `ConnectionEntityLabel`).
2. Replace the `connectionId` column cell with `<ConnectionEntityLabel connectionId={d.connectionId} linkToDetail={false} showId />`.
3. The `cardView` here does NOT currently surface the connection (subtitle is `eventType`), so no card-view change.

## Step 4 — Webhook Deliveries: Connection filter → `<Select>`

**File:** `apps/web/src/pages/webhook-deliveries/webhook-deliveries-page.tsx`

Same as Step 2, adapted: call `useConnectionsQuery()` in the component, swap the connection-filter `<Input>` for `<Select>`. Keep the separate provider `<Input>` — deferred per Non-goals. The `Input` import remains necessary for the provider filter.

## Step 5 — Tests

### `apps/web/src/pages/sync-jobs/sync-jobs-page.test.tsx`

Update the existing `createMockApiClient` calls to provide a `connections.list` mock (otherwise the new `useConnectionsQuery` call will throw a mock-missing error). Do this once near the test-setup block or per test as needed — the existing test mocks `syncJobs.list` only.

Add two new tests:

```ts
it('renders the connection name in the Connection column when a matching connection exists', async () => {
  const mockApi = createMockApiClient({
    syncJobs: { list: vi.fn().mockResolvedValue(sampleJobs) },
    connections: {
      list: vi.fn().mockResolvedValue([
        { id: 'conn_allegro_1', name: 'Allegro PL (main)', platformType: 'allegro', status: 'active',
          config: {}, credentialsBacked: true, enabledCapabilities: [], supportedCapabilities: [],
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]),
      get: vi.fn().mockResolvedValue({ /* same shape */ }),
    },
  });

  renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

  expect(await screen.findByText('Allegro PL (main)')).toBeInTheDocument();
});

it('filters sync jobs by the selected connection in the dropdown', async () => {
  const user = userEvent.setup();
  const listMock = vi.fn().mockResolvedValue(sampleJobs);
  const mockApi = createMockApiClient({
    syncJobs: { list: listMock },
    connections: {
      list: vi.fn().mockResolvedValue([
        { id: 'conn_allegro_1', name: 'Allegro PL (main)', /* ... minimal shape */ },
      ]),
    },
  });

  renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

  await screen.findByRole('option', { name: 'Allegro PL (main)' });
  await user.selectOptions(
    screen.getByRole('combobox', { name: /filter by connection/i }),
    'conn_allegro_1',
  );

  await waitFor(() => {
    const call = listMock.mock.calls.at(-1) as [SyncJobFilters, SyncJobPagination];
    expect(call[0].connectionId).toBe('conn_allegro_1');
  });
});
```

Update the existing "Clear filters" test only if it breaks due to the new connections mock — no behavior change otherwise.

### `apps/web/src/pages/webhook-deliveries/webhook-deliveries-page.test.tsx`

Same shape: connection-name render test + connection-dropdown filter test. Existing mocks only cover `webhookDeliveries.list`, so they need `connections.list` added too.

### Mirror ConnectionEntityLabel's internal fetch

`ConnectionEntityLabel` internally calls `useConnectionQuery(connectionId)` (detail fetch, different query key from list). The backing API client method is `connections.getById` (verified in `failed-orders-page.test.tsx:126`, not `connections.get`). Tests that render and assert a connection name must mock both `connections.list` and `connections.getById`. Tests that don't care about the connection label (loading, error, empty, filter-fire) only need `connections.list: () => Promise.resolve([])` to keep ConnectionEntityLabel's list-provider happy. Mirror the `makeConnection()` factory helper from `failed-orders-page.test.tsx:26-40` to avoid inline `Connection` shapes diverging from the type.

## Step 6 — Quality gate

From the worktree root:

```bash
pnpm lint
pnpm type-check
pnpm --filter @openlinker/web test -- --run
```

All three must pass with zero errors. If the backend mock shape drifts from `Connection` type (e.g., missing `adapterKey` makes type-check fail) I'll either broaden the mock or cast `as Connection` inside the test file. Pattern already used in sibling tests.

## Validation

- **Architecture compliance:** frontend dependency direction preserved — pages import from `features/connections`. No API client is imported directly; hooks use `useApiClient()` internally. No new `shared/ui/` primitives introduced.
- **Naming conventions:** no file renames. Pre-existing `ConnectionEntityLabel.tsx` filename is PascalCase (frontend rule mandates kebab-case), same pre-existing violation as the rest of `features/connections/components/` — out of scope here, same call I made on #316.
- **Testing:** two new tests per page (rendering + filtering). Existing tests remain green once `connections.list` / `connections.get` mocks are added.
- **Security:** no new input handling; URL param shape is unchanged.
- **A11y:** new `<Select>` carries an `aria-label="Filter by connection"` matching the Failed Orders pattern.
- **Risk:** Low. The only code path that risks behavior change is the mock surface in tests — a missing `connections.list` mock could break existing tests. Addressed in Step 5.

## Commit plan

Single commit, conventional format:

```
fix(web): resolve connection names and swap free-text filter for Select on triage pages

Sync Jobs and Webhook Deliveries rendered raw connection UUIDs in the
Connection column and offered a free-text connectionId filter — making
triage useless without round-tripping through the Connections list.
Align with the pattern shipped on Failed Orders (#357): render
ConnectionEntityLabel for the column, populate the filter from
useConnectionsQuery() as a Select with "All connections" as the empty
option. Untruncated IDs remain accessible via the EntityLabel copy
button and title attribute.

Closes #321
```

## Out of scope / follow-up

- Webhook Deliveries `provider` filter as `<Select>` with `['prestashop', 'allegro']` options — allowed deferral per the issue.
- Shared hook to populate `useConnectionQuery` detail cache from `useConnectionsQuery` list to remove N+1 detail fetches across all three triage pages.
- Orphan-connection option in the `<Select>` when URL `connectionId` references a deleted connection.
