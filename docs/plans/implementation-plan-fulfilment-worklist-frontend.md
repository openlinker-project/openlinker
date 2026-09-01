# Implementation Plan: Fulfilment worklist (frontend)

**Date**: 2026-09-01
**Status**: Ready for Review — planning only, implementation gated on PR #2793
**Issue**: #2410 (`W3a-20`), epic #2412, stream S3 — consumes #2406 (merged), **shares a feature slice with #2411 (PR #2793, in review)**
**Branch**: `2410-fulfillment-worklist-fe`, cut from `origin/oms-programme-wave-3a`
**Estimated Effort**: ~1 day of implementation once #2793 merges (down from ~1.5 — roughly 40% of the originally-planned surface already exists in #2411)

---

## 1. Task Summary

**Objective**: ship the standalone operator worklist in `apps/web` over the #2406 read model — a
filtered, paginated list of fulfilment tasks grouped by location and delivery method, showing
per-line counters and work-grain hold chips, with the manual write actions the *server* says are
legal, guarded by the optimistic token.

**Context**: REVIEW D10 cuts Wave 3a at a desktop worklist — enough to light the 3PL story with no
floor UI, deferring the scan-scale wizard to 3b. #2406 was shaped for this consumer:
`supportedActions` and `version` ride with every row so no client-side state machine has anywhere
to live.

**The defining constraint of this body is that it is the SECOND consumer of a slice #2411 built.**
#2411 (PR #2793) creates `apps/web/src/features/fulfillment/` with the api client, the boundary
schema, the query keys, the conflict reader, the copy table, the action-controls component, the
task card, the action dialog and the action mutation. #2410 does not re-create any of that. It adds
the *list* axis — filters, paging, grouping, a route, a page — and consumes the rest unchanged.
§ 3 is the file-by-file reuse map and is the substance of this plan.

**Classification**: Frontend / Interface. No backend change, no core change, no migration.

---

## 2. Scope & Non-Goals

### In scope
- Route `/fulfillment` + nav entry, page under `apps/web/src/pages/fulfillment/`.
- Filtered list read (`GET /fulfillment/works`) with URL-carried filters and **server-reported** paging.
- Grouping by location + delivery method, with line counters and hold chips per task.
- Actions rendered **only** from `supportedActions`, posted with `expectedVersion`.
- Both 409 codes handled distinctly and non-destructively.
- Desktop table-ish layout, tablet and mobile card layouts.
- A rendered-output copy audit covering the page.

### Out of scope / non-goals
- **Any file `features/fulfillment/**` already carries from #2411 is not rewritten.** Where an
  extension is needed it is stated in § 3 as an additive change that leaves #2411's consumer
  byte-compatible.
- **No status / requestStatus filter control.** See § 7 Alternative 1 — the two vocabularies are
  closed unions in `libs/core` exposed by no endpoint, and `scripts/check-no-supported-actions-mirror.mjs`
  plus the reasoning in #2411's `fulfillment.types.ts` docblock forbid retyping them in `apps/web`.
  Filtering is by the two free-string server params (`orderId`, `locationId`).
- `submit` / `request_cancellation` — not in `OPERATOR_INVOCABLE_ACTIONS`; they can never appear in
  `supportedActions`, and the FE never names them.
- Line-level progress recording — no HTTP surface; counters are display-only.
- The order-detail panel — that is #2411.
- Scan / barcode surfaces — Wave 3b.

### Constraints
- `apps/web` may not import `@openlinker/*`.
- Zod over the projection uses `.nullish()`, never `.optional()` (#939) — **already satisfied by
  #2411's `fulfillment.schema.ts`, which this body reuses rather than re-derives.**
- `scripts/check-no-supported-actions-mirror.mjs` fails the build on a `derive*SupportedActions`
  declaration or a `FulfillmentWorkAction[Values]` declaration under `apps/web/src`.
- Banned user-visible vocabulary (nine terms, `check-ui-vocabulary.mjs`): notably **authority**,
  **posture**, **FulfillmentWork** / "fulfillment work", **holder**, **phase**. Copy says
  *"fulfilment tasks"*, and questions read *"Who decides X?"*.

---

## 3. Reuse map against #2411 (PR #2793) — file by file

Read from `origin/2411-order-detail-task-panel` at plan time. Three columns of outcome: **reuse
unchanged**, **extend additively**, **new**.

### 3a. Consumed UNCHANGED — not touched by this body

| File (on #2411) | What #2410 uses it for |
|---|---|
| `features/fulfillment/api/fulfillment.schema.ts` | The whole boundary parse. `fulfillmentTaskPageSchema` already models `{works,total,limit,offset}` — the exact list response #2410 needs — and `parseFulfillmentTaskPage` is already the page parser. Every nullable field is already `.nullish()`, so the #939 AC is inherited, not re-satisfied. |
| `features/fulfillment/api/fulfillment.types.ts` | `FulfillmentTask`, `FulfillmentTaskLine`, `FulfillmentTaskHold`, `FulfillmentTaskPage`, `ApplyFulfillmentTaskActionRequest`. Also the *reasoning* the docblock records — three vocabularies stay `string`. |
| `features/fulfillment/lib/fulfillment-conflict.ts` | `readFulfillmentConflict` (409 discrimination by `details.code`, never message prose) and `describeFulfillmentActionError`. The worklist's 409 path is this function plus a toast. |
| `features/fulfillment/lib/fulfillment-task-copy.ts` | `fulfillmentActionLabel/Tone/Hint`, `FULFILLMENT_ACTIONS_NEEDING_A_FORM`, `fulfillmentStatusLabel`, `fulfillmentRequestStatusLabel`. This is also the file the vocabulary gate scans, so the worklist's action/status copy is already gated. |
| `features/fulfillment/components/fulfillment-task-actions.tsx` | The action control strip, verbatim. Its props are `task, visible, readOnly, busy, onInvoke, onHold, onReleaseHold, onForceCancel`; it reads nothing off the task but `supportedActions` and `activeHolds`. `visible` / `readOnly` are a **permission decision the calling page makes** — see D6. This is the single most important reuse: **the AC "no client-side state machine" is satisfied by using #2411's component rather than writing a second one that could drift.** |
| `features/fulfillment/components/fulfillment-task-card.tsx` | The mobile/tablet card. Already renders heldness-from-`activeHolds`, the status/handshake facts, location, delivery method, the counters and the display-only caveat, and accepts an `actions` slot. |
| `features/fulfillment/components/fulfillment-task-action-dialog.tsx` + `.schema.ts` | The three form-bearing actions (`hold`, `release_hold`, `force_cancel`). Prop-driven `mode`, never inferred from state. |
| `app/api/api-client.ts` | The `fulfillment` namespace is **already registered** by #2411. #2410 makes **zero** edits to this file. |
| `.eslintrc.js` | The `**/fulfillment/{api,hooks,components,lib,types}/**` entries are **already present in both `no-restricted-imports` pattern groups** (#2411). #2410 makes **zero** edits to this file. The standing S3 rule is satisfied by inheritance; a verification step, not an edit (§ 6 step 0). |
| `scripts/check-ui-vocabulary.mjs` | `features/fulfillment` is **already a scan root** (owner `W3a-21 (#2411)`). #2410 makes **zero** edits to this file — see § 5 D1 for why the page is covered without one. |

### 3b. EXTENDED — additive, #2411's consumer unaffected

| File | Extension | Why it cannot break #2411 |
|---|---|---|
| `features/fulfillment/api/fulfillment.api.ts` | Add `list(filters): Promise<FulfillmentTaskPage>` and `get(workId): Promise<FulfillmentTask>` to `FulfillmentApi`. `listByOrder` is **kept and re-expressed as `list({ orderId })`** — identical signature, identical URL, one query-string builder. | Purely additive interface members; `listByOrder`'s signature, return type and emitted URL are unchanged. A test pins that `listByOrder('x')` still requests `/fulfillment/works?orderId=x`. |
| `features/fulfillment/api/fulfillment.query-keys.ts` | Add `list(filters)` and `detail(workId)`. `all` and `worksByOrder` untouched. | Additive. Both new keys are prefixed `['fulfillment', …]`, so `all` remains a valid invalidation ancestor of every key in the slice. |
| `features/fulfillment/index.ts` | Add the worklist exports the page needs: `useFulfillmentTasksQuery`, `FulfillmentTaskActions`, `FulfillmentTaskCard`, `FulfillmentTaskActionDialog`, `useFulfillmentTaskActionMutation`, `readFulfillmentConflict`, the copy helpers, the filter helpers, and the `FulfillmentTaskFilters` type. | Additive exports only; #2411's four exports stay. The docblock's own words — *"#2410's standalone worklist is the second consumer of this slice's api/hooks/lib; those stay internal until it needs them"* — anticipate exactly this edit. |
| `features/fulfillment/hooks/use-fulfillment-task-action-mutation.ts` | **One line**: invalidate `fulfillmentQueryKeys.all` instead of `fulfillmentQueryKeys.worksByOrder(orderId)`, on both the success and the conflict path. `orderId` stays on the input (it is not otherwise load-bearing, and removing it would be a breaking change for no gain). | Strictly widens what is refreshed. #2411's panel is a descendant of `all`, so it still refetches. **See § 5 O1 — this is the one item flagged to the orchestrator.** |
| `apps/web/src/index.css` | Append a `.fulfilment-worklist*` block. `.fulfilment-task*` (#2411) is reused as-is for the card. | Appended after #2411's block; no existing selector is edited. Textual-merge risk only — see § 5 O2. |
| `apps/web/src/test/test-utils.tsx` | Add `list` and `get` to the `fulfillment` entry of `createMockApiClient`. #2411's default answers `listByOrder` + `applyAction` only, so **every page-level test in § 9 would otherwise call `apiClient.fulfillment.list(…)` on `undefined`.** The default `list` returns a page object (`{ works: [], total: 0, limit: 25, offset: 0 }`), never a bare array, for the reason #2411's own comment gives. | Additive members on the same object literal; `listByOrder` and `applyAction` untouched. |

### 3c. NEW to this body

| File | Purpose |
|---|---|
| `features/fulfillment/lib/fulfillment-filters.ts` | Read/write `orderId`, `locationId`, `offset` search params. `offset` is paging, not a filter, so it is excluded from `hasActiveFilters` (the `returns-filters.ts` rule) — an empty page from paging past the end is a different operator situation from an empty page from a filter. |
| `features/fulfillment/lib/fulfillment-lanes.ts` | Pure `groupTasksIntoLanes(tasks)` → ordered groups keyed by `locationId` + `deliveryMethod`, stable "No location" / "No delivery method" labels for `null`. |
| `features/fulfillment/lib/fulfillment-worklist.copy.ts` | Every user-visible worklist string (headings, empty states, filter labels, toasts). A `*.copy.ts` under an already-scanned root, so the vocabulary gate covers it with no script change. |
| `features/fulfillment/hooks/use-fulfillment-tasks-query.ts` | The filtered/paged list query, keyed `fulfillmentQueryKeys.list(filters)`. |
| `features/fulfillment/components/fulfillment-worklist-row.tsx` | The desktop row. Composes the same `FulfillmentTaskActions` and the same hold/line renderings as the card, so the two surfaces cannot disagree about what a task is. |
| `features/fulfillment/components/fulfillment-lane-section.tsx` | One lane heading + its rows/cards. |
| `features/fulfillment/fulfilment-worklist-styles.test.ts` | The CSS gate. Placed **inside the feature folder**, beside the `who-decides-styles.test.ts` precedent it reuses structurally, reading both the feature dir and the page file from there. |
| `pages/fulfillment/fulfillment-worklist-page.tsx` | Filters, lanes, paging, four distinct states, and the one `useWriteAccess('orders:write', useDemoMode())` call (D6). **Contains no string literals of its own** — all copy comes from the feature's `*.copy.ts`, which is what keeps it inside the vocabulary gate's reach (§ 5 D1). |
| `app/routes/fulfillment.route.tsx` | Lazy route + `handle.crumb` `{ group: 'Operations', title: 'Fulfilment' }`. Bumps `EXPECTED_LAZY_ROUTE_COUNT` (61 → 62) in `app/routes/route-lazy.test.ts`. |
| `app/nav-registry.ts` | Nav entry under Operations. |

### 3d. On #2411 and deliberately NOT used

| File | Why not |
|---|---|
| `features/fulfillment/hooks/use-order-fulfillment-tasks-query.ts` | Order-scoped (`listByOrder`), keyed `worksByOrder`. The worklist is filter-scoped and paged, so it gets its own hook (§ 3c). The hook is left untouched — but it is the **owner of the key O1 talks about**: after O1 the action mutation invalidates `all`, which is this hook's key's ancestor, so this panel still refetches. |
| `features/fulfillment/components/order-fulfillment-tasks-panel.tsx` | The order-detail panel itself. The worklist is a different surface with filters, lanes and paging; nothing about the panel's shell is reusable, and its parts (card, actions, dialog) are consumed directly instead. |
| `features/orders/index.ts` (the four hold exports #2411 adds) | Not imported by #2410 directly. Consumed **transitively** — #2411's card and dialog import `holdReasonLabel` / `HOLD_REASON_COPY` / `HoldReasonValues` through the orders barrel. A second reason #2410 cannot precede #2793 (they are absent from `wave-3a`). |

---

## 4. Research — the #2406 contract, read from source

`GET /fulfillment/works` → `{ works, total, limit, offset }`. `limit`/`offset` in the response are
**what the server applied after clamping** (`FULFILLMENT_WORKLIST_DEFAULT_LIMIT = 25`,
`FULFILLMENT_WORKLIST_MAX_LIMIT`), so the pager reads them and never the values it requested.
Query params: `status[]`, `requestStatus[]`, `locationId`, `orderId`, `limit`, `offset`; the DTO
accepts both `?status=a&status=b` and `?status=a,b`.

`POST /fulfillment/works/:workId/actions/:action` body:
`{ expectedVersion (required), holdReason?, cancellationReason?, holdId?, note?, releaseNote? }`.
Responds `201` with the refreshed task.

Refusals, from `FulfillmentWorkController.toHttp`:

| Status | `code` | Meaning for the client |
|---|---|---|
| 409 | `version_conflict` | Someone moved it first. Retryable **after the operator re-reads** — never automatically. |
| 409 | `action_not_legal` | Token was current; the state refused. Not retryable. |
| 409 | *(none)* | Hold limit exceeded / hold already released. The **server's own message** is used verbatim. |
| 400 | — | Not invocable, or a missing per-action field. Server message used. |
| 404 | — | No such task or hold. |

`OPERATOR_INVOCABLE_ACTIONS = ['schedule','hold','release_hold','mark_in_progress','close','force_cancel']`.
The issue title's "mark-picked / mark-shipped" map onto `mark_in_progress` and `close` in the
shipped vocabulary. **The FE labels the ids the server sends and never assumes this set** —
#2411's copy table is a lookup with a humanising fallback, not a declaration of legality.

Two facts the contract states that the UI must obey, both already honoured by the #2411 components
this body reuses:

1. **Heldness is `activeHolds`, not `status`.** Nothing writes `status = 'on_hold'`.
2. **Line counters are display-only.** `recordLineProgress` does not bump `version`, so a counter
   can move under a valid token. No action may be gated on one.

---

## 5. Decisions, assumptions, and the items for the orchestrator

### For the orchestrator

- **O1 — `use-fulfillment-task-action-mutation.ts` invalidates an ORDER-scoped key, which is the
  wrong grain for two consumers.** #2411 invalidates `fulfillmentQueryKeys.worksByOrder(orderId)`.
  The worklist's rows are keyed `list(filters)`, so an action taken from the worklist would leave
  the worklist itself showing the pre-action task — including a stale `version`, which turns the
  operator's *next* click into a `version_conflict` the UI itself caused. Invalidating
  `fulfillmentQueryKeys.all` fixes it, still refreshes #2411's panel (its key is a descendant), and
  is a one-line change. **Preferred: #2793 makes this change before merging** — it is strictly
  more correct for #2411 too, since a task can also be moved from the worklist while the panel is
  open. **Fallback if #2793 merges first**: #2410 makes the one-line change, which is then an edit
  to a merged file rather than a cross-PR reach. *This is NOT a blocking defect in #2793 —
  #2411's panel is correct in isolation.*
- **O2 — three shared files are appended to by both bodies and will need a textual merge**:
  `apps/web/src/index.css` (both append a block at EOF), `features/fulfillment/index.ts` (both add
  exports), and `features/fulfillment/api/fulfillment.query-keys.ts`. All three are additive on
  both sides, so resolution is "keep both", but the merge must be resolved *by intent* and the
  invariant re-grepped afterwards. #2410 makes **zero** edits to `.eslintrc.js`,
  `apps/web/src/app/api/api-client.ts` and `scripts/check-ui-vocabulary.mjs`, so those three
  collision points are removed entirely.
- **O3 — no shaping defect found in #2411 beyond O1.** `FulfillmentTaskActions`,
  `FulfillmentTaskCard`, `FulfillmentTaskActionDialog`, `readFulfillmentConflict` and the copy
  table are all already prop-driven and order-agnostic; every one is consumable by the worklist
  with no change.

### Decisions

- **D1 — the page carries no string literals; all worklist copy lives in
  `features/fulfillment/lib/fulfillment-worklist.copy.ts`.** `check-ui-vocabulary.mjs` asserts
  `SCAN_ROOT_PARENT === apps/web/src/features`, so `pages/fulfillment` **cannot** be added as a
  scan root without restructuring a shared gate that #2793 is concurrently editing. Putting the
  copy where the gate already looks is better than widening the gate: it needs no script change, no
  cross-PR file, and it is where the copy belongs anyway. The AC's copy-audit test is then a
  *rendered-output* audit (§ 9), which is strictly stronger than a source scan because it also
  catches the gate's own documented blind spot #2 (runtime-assembled strings).
- **D2 — a `supportedActions` entry with no copy is rendered with a humanised raw label**, per
  #2411's already-shipped behaviour. Hiding it would silently conceal a legal operation the moment
  the backend grows one. The worklist inherits this by reusing the component; it does not restate
  the policy.
- **D3 — a `version_conflict` is never auto-retried.** "Retryable" means the operator may retry
  after seeing refreshed state. Silently re-posting `close` against state the operator has not seen
  is exactly the double-ship the token exists to prevent.
- **D4 — grouping groups the rows on the CURRENT PAGE.** Stated in the lane caption so a lane is
  never read as complete.
- **D5 — the pager reads `page.limit` / `page.offset` from the response**, never the requested
  values, because the server clamps.
- **D6 — write access is `useWriteAccess('orders:write', useDemoMode())`, the same permission
  #2411's panel uses, and the page owns that decision.** `FulfillmentTaskActions` takes `visible`
  and `readOnly` as props precisely so the permission is resolved once per surface rather than
  inside a component that is rendered per row. `orders:write` is reused rather than a new
  `fulfillment:write` minted, for two reasons: the backend route is `@Roles('admin','operator')` —
  the same roles the order write routes carry, so a new permission would not narrow anything real —
  and a permission that exists in `apps/web` and is granted to nobody would hide the whole worklist's
  controls on every deployment. Introducing one is a session/RBAC change, not a frontend body's
  decision. Consequences that must be honoured: `visible === false` (a genuinely unauthorized
  non-demo session) renders **no** action controls, and `demoReadOnly === true` renders them
  **disabled inside a `ReadOnlyLock`** rather than hidden — the #1615 split — so a public demo still
  advertises the capability. Both are asserted (§ 9 AC1) and the read-only render is one of the
  states the copy audit covers (§ 9 AC4).

### Open questions (recorded, not blocking)

- **Q1** — a status filter needs a server-supplied facet list; see § 7 Alternative 1. Recorded in
  the PR body as a follow-up.
- **Q2** — the hold cap (10 active) is enforced server-side and answers a bare 409. The FE surfaces
  the server's sentence and does not pre-count.

---

## 6. Implementation Plan

**Step 0 (gating)** — rebase onto `oms-programme-wave-3a` *after* #2793 merges, and verify by
grep, not by assumption: `.eslintrc.js` carries `**/fulfillment/api/**` in both pattern groups;
`api-client.ts` carries the `fulfillment` namespace; `check-ui-vocabulary.mjs` lists
`features/fulfillment` as a scan root. If any is absent, the corresponding edit moves back into
this body's scope and the plan's "zero edits" claims are revised in the PR body.

**Phase 1 — data layer (extensions)**
1. `api/fulfillment.api.ts` — add `list` / `get`; re-express `listByOrder` through `list`.
2. `api/fulfillment.query-keys.ts` — add `list(filters)` / `detail(workId)`.
3. `hooks/use-fulfillment-task-action-mutation.ts` — the O1 one-liner, if not already done by #2793.
4. `apps/web/src/test/test-utils.tsx` — add `list` / `get` to the `fulfillment` mock. **Done in
   Phase 1, not when a test first needs it**: every page-level test in § 9 depends on it, and a
   default that answers `undefined` fails as an inscrutable render crash rather than as a missing mock.

**Phase 2 — pure logic (all in `lib/`, all unit-tested)**
5. `lib/fulfillment-filters.ts` — search-param read/write; `offset` excluded from `hasActiveFilters`.
6. `lib/fulfillment-lanes.ts` — `groupTasksIntoLanes`.
7. `lib/fulfillment-worklist.copy.ts` — every user-visible worklist string.

**Phase 3 — hooks**
8. `hooks/use-fulfillment-tasks-query.ts` — the filtered/paged list.

**Phase 4 — components**
9. `components/fulfillment-worklist-row.tsx` — desktop row, composing `FulfillmentTaskActions`.
10. `components/fulfillment-lane-section.tsx` — lane heading + rows (desktop) / cards (below the
   breakpoint), the card being #2411's `FulfillmentTaskCard`.

**Phase 5 — page, route, nav**
11. `pages/fulfillment/fulfillment-worklist-page.tsx` — filters, lanes, paging, and four **distinct**
    states: loading (skeleton, never "no tasks"), error (retry), empty-because-filtered,
    empty-because-nothing-to-do. Resolves write access once via `useWriteAccess('orders:write',
    useDemoMode())` (D6), owns the dialog state, and passes `expectedVersion` from the task it
    rendered.
12. `app/routes/fulfillment.route.tsx` + `EXPECTED_LAZY_ROUTE_COUNT` 61 → 62.
13. `app/nav-registry.ts` — Operations entry.
14. `features/fulfillment/index.ts` — additive exports.
15. `apps/web/src/index.css` — `.fulfilment-worklist*` block.
16. `features/fulfillment/fulfilment-worklist-styles.test.ts` — the CSS gate, **inside the feature
    folder** beside its `who-decides-styles.test.ts` precedent rather than under `pages/`, reading
    both the feature dir and the page file from there (§ 9 AC3).

---

## 7. Alternatives Considered

**Alternative 1 — ship a status / requestStatus filter. Rejected.** Both vocabularies are closed
unions in `libs/core` exposed by no endpoint. Three substitutes were considered and each is worse:
deriving options from the rows on the current page traps the operator the moment they filter (the
other statuses are no longer in the data); a second unfiltered "facet" query is an extra request
that is still incomplete past the first page; forwarding an unvalidated URL value 400s the whole
page on a typo. The honest fix is a server-supplied facet list — a contract change to a just-merged
shared surface. Deferred and recorded rather than approximated. Lane grouping gives the operator
the structure a status filter would have.

**Alternative 2 — build the worklist's own components rather than reusing #2411's. Rejected.** Two
components rendering `supportedActions` is two places the "no client-side state machine" rule can be
broken, and only one of them would be under the eye of the reviewer who wrote the rule. Reuse makes
the AC structurally true rather than separately re-argued.

**Alternative 3 — add `pages/fulfillment` as a vocabulary scan root. Rejected** — see D1. It
requires changing `SCAN_ROOT_PARENT` on a shared gate #2793 is editing concurrently, to buy
something D1 achieves with no shared-file edit at all.

**Alternative 4 — auto-retry on `version_conflict`. Rejected** — see D3.

**Alternative 5 — a second FE mirror of `HoldReasonValues` in `features/fulfillment`. Rejected.**
`features/orders/lib/order-hold.types.ts` holds one and `scripts/check-hold-reason-mirror.mjs`
guards it; #2411 already imports it through the orders barrel. A second copy would be unguarded.

---

## 8. Validation & Risks

| Risk | Mitigation |
|---|---|
| A worklist component slips in an `if (status === …)` — the drift the static guard admits it cannot catch | The worklist renders actions **only** through #2411's `FulfillmentTaskActions`, and a test asserts two rows with identical `supportedActions` but different `status` render identical controls (§ 9 AC1). |
| An action gated on a display-only counter | A test asserts two rows differing only in `fulfilledQuantity` render identical controls. |
| An action taken from the worklist leaves the worklist stale, manufacturing the next 409 | O1 — invalidate `fulfillmentQueryKeys.all`. Asserted by a test, not by inspection. |
| Pager disagrees with the server's clamp | Paging reads `page.limit` / `page.offset` from the response; a test feeds `limit: 100` requested / `25` returned and asserts the pager uses 25. |
| "Nothing to do" rendered over an unresolved query | Loading and error are their own states; a test asserts the loading render contains neither empty-state sentence. |
| A banned term ships in copy | All copy lives under the already-scanned feature root, plus the rendered-output audit (§ 9 AC4), whose term list is read from the fenced spec table rather than restated. |
| Write controls ship to a read-only or unauthorized session | D6 — the page resolves `useWriteAccess('orders:write', useDemoMode())` once and passes `visible` / `readOnly` down; § 9 AC1(d) asserts both arms, including that demo read-only DISABLES rather than hides (#1615). |
| A page-level test crashes on an incomplete api mock rather than on its subject | `test-utils.tsx`'s `fulfillment` mock gains `list` / `get` in Phase 1, before any test needs them. |
| Textual merge with #2793 on three shared files | O2 — resolve by intent, then re-grep the invariants of step 0. |

**Backward compatibility**: additive throughout. New route, new page, new modules in an existing
feature slice, additive members on an existing api/query-key/barrel.

---

## 9. Testing strategy — and how each acceptance criterion is proven able to FAIL

The programme's recurring defect is **a check that cannot fail**. For each AC below: what already
covers it, the specific new assertion, whether that assertion touches code this body changes, and
the concrete break that must turn it red. Where a property is already asserted on both sides and a
new assertion would be vacuous, that is stated rather than a ceremonial test added.

---

**AC1 — "No client-side state machine: every action originates from `supportedActions`."**

*Already covered elsewhere*: partially. `scripts/check-no-supported-actions-mirror.mjs` catches a
`derive*SupportedActions` or `FulfillmentWorkAction[Values]` declaration under `apps/web/src`, and
says in its own docblock that it cannot catch an inline `if (status === 'open')`. #2411 has a spec
over `FulfillmentTaskActions` itself, and that component provably reads nothing but
`supportedActions` and `activeHolds`. **So the property is already true of the component; what is
NOT covered is what the worklist row SELECTS TO HAND DOWN**, which is the only place in this body a
legality decision could be reintroduced. The assertions are written against the row for that reason,
not against the component.

*New assertions*, in `components/fulfillment-worklist-row.test.tsx`:
- **(a) status-independence** — two tasks identical except for `status` (`'open'` vs `'in_progress'`)
  and `requestStatus`, both `supportedActions: ['hold','close']`, render the same control labels.
- **(b) counter-independence** — two tasks differing only in `lines[0].fulfilledQuantity`.
- **(c) hold-independence** — one task with `supportedActions: ['hold','close']` and a **non-empty**
  `activeHolds`; both controls still render. This is the plausible row-level defect the first two
  miss (a row that suppresses `hold` because the task is already held is a legality decision, and
  the server is the one that decides that — it simply does not offer `hold` when it is not legal).
- **(d) permission** (D6) — `visible: false` renders zero controls; `readOnly: true` renders the
  same control set, disabled, inside a `ReadOnlyLock`. Hiding on demo read-only is the #1615
  regression this pins.

*Does it touch code under change?* Yes — the row is new here and is the only place these decisions
can live.

*Red-first proof*: (a) add `if (task.status !== 'open') return null;` around the row's action strip
→ the `'in_progress'` case renders zero controls, comparison fails. (c) add
`supportedActions.filter(a => a !== 'hold' || task.activeHolds.length === 0)` → the held case loses
a control. (d) change `readOnly` to hide rather than disable → the disabled-control assertion fails.
Each run recorded in the PR body with its observed output.

*Vacuity guard*: every case first asserts the baseline render produced a **non-empty** control list.
Comparing two empty arrays is exactly the shape of a check that cannot fail, and is what a
`supportedActions: []` fixture — or a `visible: false` typo'd into the shared fixture — would
silently produce.

---

**AC2 — "The 409 path is covered by a test and produces a refreshed, non-destructive UI."**

*Already covered elsewhere*: `lib/fulfillment-conflict.ts` and its spec are #2411's and classify
both codes. **This body adds no assertion there** — re-testing a pure function over an in-memory
object from a second file would pass with this entire body reverted, which is precisely the vacuous
assertion the brief warns against. What is not covered is the worklist's own behaviour on a 409.

*New assertion*, in `pages/fulfillment/fulfillment-worklist-page.test.tsx`, with a mocked api client:
1. `list` resolves one task, `supportedActions: ['close']`, `version: 3`;
2. the operator clicks the *Close* control; `applyAction` rejects with
   `ApiError(409, { code: 'version_conflict', currentVersion: 4, supportedActions: ['hold'] })`;
3. the next `list` resolves the same task with `version: 4`, `supportedActions: ['hold']`.

Assert, in order: **(a)** `applyAction` was called **exactly once**, with `expectedVersion: 3` — no
auto-retry, and the rendered token was sent rather than a fresher one; **(b)** `list` was called
**exactly twice** — the refresh happened; **(c)** the row is still in the DOM — non-destructive;
**(d)** after the refetch the visible control is the one labelled by
`FULFILLMENT_ACTION_COPY['hold'].label` and the `['close']` label is gone. **(d) reads the label
out of #2411's copy table rather than hardcoding "Put on hold"**, so a copy edit cannot make the
assertion silently stop asserting anything about which action is offered. The `action_not_legal`
case repeats (a)–(c) with the not-retryable copy.

*Does it touch code under change?* Yes — the list query key, the page's mutation wiring and the O1
invalidation grain are all this body's.

*Red-first proof*: three independent breaks, each run and recorded.
- Delete the mutation's `onError` conflict branch, or revert O1 to `worksByOrder`, → **(b)** fails,
  because the list key is never invalidated. **This is the break a naive 409 test survives**, and is
  the whole reason (b) counts calls.
- Make the mutation read `version` out of the cache instead of the rendered task → (a) fails on the
  `expectedVersion` argument.
- Remove the row on error → (c) fails.

*Vacuity guard*: (b) asserts the call count is exactly 2, never `>= 1` and never merely "the promise
settled" — React Query settles either way, so an await-only test passes with the handler deleted.

---

**AC3 — "Desktop + tablet + mobile layouts verified."**

*Already covered elsewhere*: no. `.fulfilment-task*` is #2411's; the lane and row layout is new.

*New assertions*, three parts, because a JSDOM test cannot compute CSS and a text scan over CSS is
where this programme has already shipped a check that could not fail.

1. **Both surfaces agree** (`fulfillment-worklist-page.test.tsx`): the desktop container and the card
   list both render — the breakpoint switch is CSS, the house pattern — and the set of task ids in
   the card path equals the set in the desktop path. Two surfaces showing different tasks is the
   real defect; that they are both present is incidental.
2. **Class coverage** (`features/fulfillment/fulfilment-worklist-styles.test.ts`): **structurally
   reuses `who-decides-styles.test.ts` rather than re-deriving a matcher.** That means: collect the
   `.fulfilment-worklist*` class names the feature `.tsx` files and the page emit (both the
   `className="…"` form and the `'…'` array form); build the set of **declared selectors** with
   `css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)` and test **membership**, never `css.includes('.'+name)`;
   exempt a BEM **block root** via `css.includes('.'+name+'__') || css.includes('.'+name+'--')`, so a
   namespace-only `.fulfilment-worklist` root does not fail spuriously and invite loosening the
   matcher, while a **leaf** with no rule still fails; assert `used.size > 0`; and carry the
   precedent's **guard of the guard** — a fabricated leaf name (a truncation of a real class) is
   asserted to be absent from `declared`, absent from `isBlockRoot`, and **present** under the old
   substring test, which is the standing proof that the matcher is stronger than the one that
   shipped the defect. The precedent's second and third `it()`s (undeclared custom properties;
   two parts sharing one grid area) are adopted verbatim in shape for the new classes.
3. **The breakpoint itself** — same file. `display:none` on the desktop container must live **inside**
   a `@media` block, or the desktop table renders on a phone. A regex for `display:none` near the
   class name passes on a match inside a comment, inside an unrelated `@media`, or on a rule a later
   block overrides — so the test **extracts media blocks by brace counting** (find `@media`, walk to
   its matching close brace) and asserts: the `.fulfilment-worklist__desktop { display: none }`
   declaration occurs **only** inside a media block whose condition contains `max-width`, and the
   `.fulfilment-worklist__cards` `display:none` only inside one containing `min-width`. Comments are
   stripped (`/\/\*[\s\S]*?\*\//g`) before any matching, since a commented-out rule is the exact
   vector the brief names.

*Does it touch code under change?* Yes — the markup, the classes and the CSS block are all new here.

*Red-first proof*, four runs, all recorded: delete the `.fulfilment-worklist__cards` rule → part 2
red. Rename that class in the CSS only → part 2 red **(a substring matcher would stay green; this is
the run that proves the matcher, and the fabricated-leaf guard asserts the same thing statically)**.
**Move the desktop `display:none` rule OUT of its `@media` block** → part 3 red. Make the card path
render a different subset of tasks → part 1 red.

*Manual verification*: 390 / 834 / 1440 in the browser, recorded in the PR body. The automated part
proves the rules exist, are inside the right media blocks, and that the two surfaces agree — not
that the result looks right, and the plan does not claim otherwise.

---

**AC4 — "Copy audit test: none of the three banned words appears in user-visible strings."**

*Already covered elsewhere*: partially, and the boundary is the point.
`check-ui-vocabulary.mjs` already scans `features/fulfillment` (#2411's scan root, verified), so
every `*.copy.ts` and `.tsx` this body adds **under that folder** is gated with no script change —
which is why D1 puts all worklist copy there. The script's own documented blind spots are `pages/`,
runtime-assembled strings, and backend-sourced messages; this body renders a backend-sourced message
on the un-coded 409 path and humanises raw vocabulary values, so it lands in two of the three.

*New assertion*, `pages/fulfillment/fulfillment-copy-audit.test.tsx`: render the page across every
state it can reach — loading, error, empty-filtered, empty-unfiltered, populated with a held task, a
task with an unrecognised `status`, a task with an unrecognised action id, **and the demo read-only
render (D6)** — and assert `document.body.textContent` matches none of the banned terms. A
**rendered-output** audit, not a source scan.

**The banned terms are READ, not restated.** The test parses the fenced `<!-- ui-vocabulary:start -->`
table in `docs/specs/product-spec-oms-wave2-operator-experience.md` with the same fence constants the
script uses — the script already treats that table as the single source under its Rule A, and a
hand-copied list here would be a **second, ungated mirror of a nine-term vocabulary**, drifting the
day a tenth term or a mode change lands. (The draft of this plan had already drifted: it enumerated
the modes and omitted `atpEffect`'s `'ATP'` alternate.) Match modes come from the same rows, so
whole-word vs case-sensitive-substring cannot diverge either. If the fence parses to zero rows the
test **fails** — the script's own Z1 rule, because a scan with an empty deny-list cannot fire.

*Does it touch code under change?* Yes — it renders this body's page and copy module.

*Red-first proof*: two breaks. **(i)** plant `posture` in a `fulfillment-worklist.copy.ts` empty-state
sentence → red. **(ii)** plant it in a **fixture's** `status` value, so it reaches the screen only
through the humanising fallback and appears in no source literal → red **while the shared script
stays green** — which is the evidence that this test is not a duplicate of the script but covers its
blind spot.

*Vacuity guard, and the one that matters most here*: each state's assertion first asserts the render
produced **non-empty** text and contains a sentinel string known to be in that state's copy. A
banned-word scan over an empty render passes trivially. Each state is its own `it()` so one throwing
render cannot silently skip the other seven.

---

**AC5 — "Tests added or updated for non-trivial logic."**

Covered by the above plus: `lib/fulfillment-lanes.test.ts` (ordering, `null` location and `null`
delivery method get their stable labels, two tasks with the same pair land in one lane),
`lib/fulfillment-filters.test.ts` (round-trip; `offset` excluded from `hasActiveFilters` — proved red
by adding `offset` to the predicate and watching the "paged past the end is not filtered" case fail),
`api/fulfillment.api.test.ts` (`list` emits only defined params; `listByOrder` still emits
`/fulfillment/works?orderId=x` after the § 3b re-expression — the regression guard for the one
existing method this body rewrites).

**AC6 — "`shared` imports no `features`/`pages`."**

*Already covered elsewhere*: **yes, fully and on both sides.** `.eslintrc.js` carries the
`no-restricted-imports` pattern groups, and #2411 has already registered the `fulfillment/**`
patterns in both. This body adds no file under `shared/` and edits no ESLint config. **No new
assertion is added**: a test that re-states an existing lint rule over code this body does not touch
would pass with the entire change reverted — the manufactured-check shape the brief warns against.
Verification is step 0's grep plus `pnpm lint`, and the PR body records that this AC is satisfied by
inheritance rather than by new coverage.

---

## 10. Alignment Checklist

- [x] `app → pages → features → shared` respected; `shared/` untouched
- [x] Feature barrel extended; both ESLint pattern groups already carry the slug (#2411) — verified, not re-added
- [x] `.nullish()` over the projection (#939) — inherited from #2411's schema
- [x] No `supportedActions` derivation; no action / status / requestStatus vocabulary retyped
- [x] Every #2411 primitive consumed rather than duplicated; every extension additive and pinned by a regression test
- [x] No backend change, no core change, no migration
- [x] Loading / empty-filtered / empty-unfiltered / error states all distinct and deliberate
- [x] Write access resolved once, at the page, through the existing `orders:write` permission (D6)
- [x] The CSS gate reuses the shipped `who-decides-styles.test.ts` matcher, fabricated-leaf guard included — no re-derived substring check
- [x] The copy audit reads its banned terms from the fenced spec table — no second ungated mirror
- [x] Each acceptance criterion has a named assertion, a stated red-first break, and a vacuity guard — or a stated reason it needs no new assertion
- [x] Execution-ready once #2793 merges
