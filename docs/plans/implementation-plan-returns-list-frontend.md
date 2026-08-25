# Implementation Plan: Returns list with the orphan bucket (#2335)

**Date**: 2026-08-25
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Issue**: #2335 (`W1c-8`), Wave 1c, stream S3. Depends on #2334 (returns read API, landed).
**Sibling in flight**: #2336 (return detail) — shares the feature folder.

---

## 1. Task Summary

**Objective**: ship `/returns` — a paged, filterable operator list over the return aggregate,
with the orphan bucket first-class, honest empty states, and tablet/mobile layouts.

**Context**: ADR-060 puts the returns screen in the OMS. Without it the aggregate #2334
persists is invisible and the orphan bucket — returns for orders OpenLinker has never seen,
from which *nothing* is triggered — has no remediation path.

**Classification**: Frontend / Interface.

---

## 2. Scope & Non-Goals

### In Scope
- `features/returns` (new vertical slice + public `index.ts` barrel).
- `pages/returns/returns-list-page.tsx`, `app/routes/returns.route.tsx`, nav entry, breadcrumb.
- Both `.eslintrc.js` `no-restricted-imports` pattern groups gain the `returns` slug.
- `scripts/check-ui-vocabulary.mjs`: retire the `features/returns` **pending** scan root so the
  gate genuinely scans the new folder.
- Zod parse of the list projection with `.nullish()` (#939).
- Component tests.

### Out of Scope (with reasons)
- **The derived return *stage*** (spec §3.2) and its `check-return-stage-mirror.mjs` invariant.
  Owned outright by **W2-40**. Wave 1c persists no custody/money movement, and the list DTO
  carries **no `lines[]`**, so a stage rendered here would be derived from columns nothing
  writes — a label asserting something OL cannot know.
- **Money rollup chip, restock-blocked / ambiguity badges, counters** — same reason: no line
  data on a list item.
- **`Match to order` affordance** — no re-attribution write exists in Wave 1c.
- **Return detail route** — #2336.
- **Operator-authored return creation** — no such write exists yet; the "not configured"
  empty state therefore states the fact without offering an action it cannot perform.

### Constraints
- Node 22 for `apps/web`.
- Server state via TanStack Query; filters/paging in search params; no global store.
- `shared` must not import `features`/`pages`.

---

## 3. Architecture Mapping

**Target layer**: App (`apps/web`) — Interface tier only. No backend change.

**Consumed contract** (landed in #2334, not re-derived):

| Endpoint | Shape |
|---|---|
| `GET /returns` | `{ items, total, limit, offset, counts: { total, orphan, attributed } }` |
| `GET /returns/ingestion-availability` | `{ configured: boolean, connectionIds: string[] }` |

Query params: `sourceConnectionId` (UUID), `bucket` (`orphan` \| `attributed`),
`createdFrom` / `createdTo` (ISO), `limit` (1–100, default 20), `offset`.

List item fields: `id, sourceConnectionId, externalReturnId, internalOrderId, externalOrderId,
origin, bucket, rawStatus, openedAt, authorizedAt, declinedAt, closedAt, createdAt, updatedAt`.

**New components**: `features/returns/{api,hooks,lib,components}`, one page, one route module.

**Reused**: `PageLayout`, `DataTable` (+ `cardView`, `hideBelow`), `DataTableSkeleton`,
`EmptyState` / `ErrorState`, `Chip`, `StatusBadge`, `TimeDisplay`, `Button`, `Select`,
`ConnectionEntityLabel` (from the `connections` barrel), `useApiClient`.

**Import form matters** (pre-implement F7): `Chip`, `DataTableSkeleton` are **not** on the
`shared/ui` barrel and are deep-imported by path, per every existing list page. `PageLayout`,
`DataTable`, `TimeDisplay`, `StatusBadge`, `EmptyState`/`ErrorState` are on the barrel.

**`useTableSort` is deliberately NOT reused** (tech-review B2): `ListReturnsQueryDto` exposes no
sort parameter, and the repository pins `createdAt DESC, id ASC`. A sort header would reorder the
20 rows in hand and silently misreport ordering across pages — D2's argument applied to sort.
Columns ship `sortable: false`; spec §4.2's "Opened, default desc" is satisfied by the server's
fixed order, stated in the table caption. Interactive sort is deferred until the API takes a
sort param.

---

## 4. Design decisions this plan owns

### D1 — The two totals are used for different jobs, and never swapped
`total` is **bucket-applied**: it is the only number pagination may use, because it counts the
rows the current page is drawn from. `counts` is **bucket-less**, computed over the same filters
with `bucket` removed: it is the only number the chips may use, because a chip must stay truthful
about the bucket you are *not* looking at. Using `total` on a chip would make the unselected chip
read `0` whenever a bucket filter is active — a false statement about the operator's data.
One helper each, and a test that pins the split.

### D2 — Chips are All / Orphan / Attributed, **not** All / Orphan / Declined
The issue body says "all / orphan / declined". The shipped API partitions on
`orphan | attributed` and offers **no** declined filter. A `Declined` chip would either have to
paginate against a count the server does not compute, or filter the current page client-side —
which silently lies about how many declined returns exist beyond page 1. The declined fact is a
real, per-row fact (`declinedAt`), so it renders **as a row badge** where it is true, and is not
offered as a filter until the API can count it. Recorded here rather than silently deviating.

### D3 — Four empty branches, each answering a different question
Conflating them is the #2075 defect this wave keeps correcting. Evaluated **in this order**:

| # | State | Condition | Copy |
|---|---|---|---|
| 1 | **Past the end** | `items` empty, `offset > 0`, `total > 0` | "This page is past the end of the results." + `Back to first page` |
| 2 | **No matches** | `items` empty **and** any filter active | "No returns match these filters." + `Clear filters` |
| 3 | **Not configured** | `items` empty, no filters, availability settled with `configured === false` | "None of your connected channels report returns to OpenLinker yet." — informational, never an error: it is a configuration fact. |
| 4 | **No returns** | `items` empty, no filters, availability settled otherwise | "No returns recorded yet." |

Branch 1 exists because **`offset` is paging, not a filter** (tech-review B1). Without it,
`?offset=999` on a deployment with 47 returns falls through to branch 3 or 4 and tells the
operator they have no returns — a false claim about their own data, produced by the URL bar.

**Availability must be SETTLED before branch 3 or 4 renders** (tech-review I3). Fetched
unconditionally, but while it is still in flight the skeleton stays: otherwise the list resolves
first, "No returns recorded yet." paints, and a second later it swaps to "not configured" — the
operator reads two contradictory facts about their deployment in one second. A *failed*
availability query is settled and degrades to branch 4, never to branch 3: `configured: false`
is a positive claim OL would not have verified.

### D4 — `rawStatus` renders verbatim, attributed, and never translated
`Source: {rawStatus}` with a title of "Reported by the source channel. OpenLinker does not
interpret this value." No tone mapping, no sorting on it, no lookup table. `null` renders as
"Not reported", never as a status.

### D5 — Independent parts, never one ternary (#2100 post-mortem)
The Order cell renders the orphan badge and the order link as **siblings**, and the row's
`Declined` badge is a third independent part. A three-way ternary is what made #2100's badge
unreachable behind any record.

### D6 — Raw search params are narrowed by a guard, never cast
`isReturnBucket` (FE-local, mirroring `ReturnBucketValues`) coerces the raw param; an
unrecognised value is **ignored**, never thrown and never forwarded to the API (which would
400 the whole page over a hand-edited URL).

### D7 — Zod, and why `.nullish()`
The projection serialises absent optional fields as JSON `null` (#939). A `.optional()` would
reject `null` and fail the whole row. Every nullable field uses `.nullish()`. The parse is
**per-row and non-fatal**: an unparseable row is dropped and counted, and the page reports
"N rows could not be read" rather than blanking the list — the `order-snapshot.schema.ts`
precedent. `counts`/`total` still come from the server, so the pagination arithmetic is
unaffected by a dropped row.

---

## 5. Questions & Assumptions

**Assumptions**
- Returns is a top-level `Operations` nav entry (issue §Assumptions), breadcrumb handle
  `{ group: 'Operations', title: 'Returns' }`.
- No `returns:*` permission ships (adjudicated on #2336); the list is a read, so it needs none.
- `sourceConnectionId` filter is populated from the existing `useConnectionsQuery`.

**Open questions (non-blocking)**
- Whether W1c-4B (#2331) scope B lands a completeness caveat for the empty state. If it does,
  the copy is a one-line addition to the "no returns" branch; the branch already exists.

---

## 6. Implementation Plan

### Phase 1 — Feature slice
1. `features/returns/api/returns.types.ts` — transport types + `ReturnBucketValues` /
   `isReturnBucket` + `RETURNS_PAGE_SIZE` / `RETURNS_MAX_LIMIT`.
2. `features/returns/api/returns.schema.ts` — Zod, `.nullish()` throughout,
   `parseReturnListItems(raw) -> { items, droppedCount }`.
3. `features/returns/api/returns.api.ts` — `createReturnsApi(request)` with `list` +
   `getIngestionAvailability`; query-string built from defined filters only.
4. `features/returns/api/returns.query-keys.ts`.
5. `features/returns/hooks/use-returns-query.ts`, `use-return-ingestion-availability-query.ts`.
6. `features/returns/lib/returns-filters.ts` — `FILTER_PARAMS`, `readReturnFilters(params)`,
   `hasActiveReturnFilters`, `clearReturnFilters` (pure, unit-tested).
7. `features/returns/lib/returns-list.copy.ts` — every operator string in one place (this is
   also what the vocabulary gate scans most precisely).
8. `features/returns/components/return-bucket-badge.tsx`,
   `return-source-status.tsx`, `return-order-cell.tsx`.
9. `features/returns/index.ts` — public barrel.

### Phase 2 — Page + wiring
10. `pages/returns/returns-list-page.tsx` — chips from `counts`, pagination from `total`,
    filters in search params (any change resets `offset`).

    **Columns** (tech-review I6). `cardView` is **mobile-only** — `DataTable` gates it on
    `isMobile` — so **tablet is covered by `hideBelow`, not by cards** (tech-review I4):

    | Column | Content | `hideBelow` |
    |---|---|---|
    | **Return** | `externalReturnId`, falling back to the OL `id` when the source minted none; + `Recorded by you` chip when `origin === 'operator_authored'` | — |
    | **Order** | `Orphan` badge **and** the order link as independent siblings (D5); `externalOrderId` shown verbatim when present | — |
    | **Source** | `ConnectionEntityLabel`, name resolved from the one connections read the filter already makes (#1996 — no per-row fetch) | 1024 |
    | **Opened** | `TimeDisplay` relative on `openedAt`, falling back to `createdAt` **labelled as recorded**, never silently | 768 |
    | **Source status** | verbatim, attributed (D4) | 768 |
    | **Status** | `Declined` badge when `declinedAt !== null` — a third independent part (D5) | — |

    **Card mapping** reuses the *same* renderer functions as the columns (#2091), so the two
    cannot drift: `title` = Return, `subtitle` = Order cell, `meta` = Declined badge,
    `detail` = Source + Opened + Source status.
11. `app/routes/returns.route.tsx` (lazy, crumb handle); register in `root.route.tsx`;
    bump `EXPECTED_LAZY_ROUTE_COUNT` 53 → 54.
12. `app/nav-registry.ts` — `{ to: '/returns', label: 'Returns' }` in `Operations`.
13. `app/api/api-client.ts` — `returns: ReturnsApi` namespace; `test/test-utils.tsx` mock.

### Phase 3 — Gates
14. `.eslintrc.js` — `returns` slug in **both** pattern groups × five canonical subdirectories.
15. `scripts/check-ui-vocabulary.mjs` — **split the conflated field** (tech-review I5).

    Two corrections to the plan's first reading. (a) The root is scanned the moment the folder
    exists — Z2 keys on `isDirectory()`, and `pending` only feeds the pending-notes line. So
    dropping it unlocks nothing; what it does is stop the gate *reporting a gap that has closed*.
    (b) Relaxing the self-check to "every **pending** root names its issue" would make the
    assertion vacuous for every live root and for any future root added without an owner.

    So the field is split into `owner` (always required, always asserted) and `pending`
    (a boolean). `features/returns` flips to `pending: false`.

    The attributions are also **crossed** in the shipped script: `features/returns` is declared
    pending `W2-27 (#2364)` while `features/fulfillment-authority` is declared pending
    `W1c-8 (#2335)` — the folder this issue does *not* create. `returns`' owner is corrected to
    #2335 (which is what actually created it, ahead of #2364). `fulfillment-authority`'s owner
    is **not** re-pointed at a number this issue cannot verify: its false claim on #2335 is
    replaced with an explicit "owner to be confirmed" note, and flagged as a follow-up rather
    than silently reassigned.

### Phase 4 — Tests
16. `returns-filters.test.ts` — param narrowing, unknown bucket ignored, offset reset.
17. `returns.schema.test.ts` — `null` optional fields survive; a malformed row is dropped, not fatal.
18. `returns-list-page.test.tsx` — chips read `counts` while a bucket filter is active;
    pagination reads `total`; **all four** empty branches incl. past-the-end; the unfiltered-empty
    branch does not paint before availability settles (I3); orphan badge; verbatim `rawStatus`;
    `rawStatus: null` reads "not reported"; a dropped row is reported, not hidden.

---

## 6b. Deviations from the returns spec §4.2, stated rather than left as apparent oversights

A reviewer holding `docs/specs/product-spec-oms-returns-operator-ux.md` will find four §4.2
elements absent. Each is absent for a reason, not by omission:

- **Derived stage + counters** — W2-40 owns them; no `lines[]` on a list item (§2).
- **Money rollup chip / `Restock blocked` / `Authority ambiguous`** — same: no line data, and
  Wave 1c drives neither custody nor money.
- **Buyer name in the Order cell** — **not on the list DTO at all**. There is no join, and
  adding one is a backend change to a controller that landed in #2334. Out of scope here.
- **`Match to order` affordance** — no re-attribution write exists in Wave 1c.

---

## 7. Alternatives Considered

- **Client-side `Declined` filtering** — rejected: it misreports beyond page 1 (D2).
- **A single `counts.total` used for pagination too** — rejected: it over-paginates a filtered
  bucket, producing empty trailing pages (D1).
- **Skipping Zod and trusting the DTO** — rejected: the AC requires it, and #939's failure mode
  (a `null` sub-field blanking a whole section) is exactly what a hand-rolled cast reintroduces.
- **Rendering the derived stage now** — rejected: W2-40 owns it and Wave 1c has nothing to
  derive it from.

---

## 8. Validation & Risks

- **Risk — merge collision with #2336.** Both touch `features/returns/index.ts`,
  `api-client.ts`, `test-utils.tsx`, `root.route.tsx`, `route-lazy.test.ts`, `.eslintrc.js`.
  Mitigation: keep every addition additive and in its own file; report the full touched list.
- **Risk — Z3 in the vocabulary gate.** Once `pending` is dropped, a scan root that exists but
  yields no scannable file **fails**. The folder ships `.tsx` and a `.copy.ts`, so it is live.
- **Edge — `limit` > 100** is a server 400; the page pins `RETURNS_PAGE_SIZE = 20`.
- **Edge — hand-edited `offset` beyond `total`**: covered by D3 branch 1 (past-the-end),
  because `offset` is paging and not a filter. Do **not** let it fall through to the
  unfiltered-empty branches.
- **Edge — a dropped row makes the range label over-count** (tech-review S7): "Showing 1–20 of
  47" with 19 rows visible. The "N rows could not be read" line renders immediately adjacent to
  the range label so the two are read together.
- **No shared pagination primitive exists** (pre-implement F10): every list page inlines its own
  Prev/Next. This one does the same — matching precedent, not duplicating a helper.
- **`createMockApiClient` must gain a `returns` default** (pre-implement F9): adding
  `returns: ReturnsApi` to `CoreApiClient` makes the literal in `test-utils.tsx` structurally
  incomplete, so this is a type-check requirement, not an optional convenience.
- **`route-handle.test.ts`** additionally asserts every lazy leaf carries an `isCrumbHandle`
  handle (pre-implement F4) — the crumb must be nested under `handle.crumb`.
- **Backward compatibility**: additive only.

---

## 9. Acceptance Criteria

- [ ] `/returns` registered as an `Operations` nav entry with the correct crumb handle
- [ ] Paginates against `total`; chips render `counts`
- [ ] Four empty branches distinguished, incl. past-the-end
- [ ] Responsive: **mobile** via `cardView`, **tablet** via per-column `hideBelow`
- [ ] TanStack Query owns server state; no global store
- [ ] Zod uses `.nullish()` throughout
- [ ] Barrel shipped; slug in both `.eslintrc.js` groups
- [ ] Vocabulary gate scans `features/returns` and passes
- [ ] `pnpm lint`, `type-check`, `test`, `check:invariants` green

---

## 10. Alignment Checklist

- [x] `app → pages → features → shared` respected; `shared` untouched
- [x] Uses existing primitives; no new abstraction
- [x] Naming: `use-*.ts`, `*.route.tsx`, `*.test.tsx`, kebab components
- [x] Error / loading / empty states deliberate
- [x] No `any`, no `console.log`
- [x] Execution-ready
