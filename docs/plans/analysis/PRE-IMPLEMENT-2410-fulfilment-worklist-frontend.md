# Pre-implement readiness gate — #2410 fulfilment worklist (frontend)

**Date**: 2026-09-01
**Plan**: `docs/plans/implementation-plan-fulfilment-worklist-frontend.md`
**Base**: `origin/oms-programme-wave-3a` @ `5f7586cae`
**Sibling under review**: PR #2793 / `origin/2411-order-detail-task-panel` @ `be1071c36`
**Verdict**: **CONDITIONAL GO** — plan is execution-ready; implementation is **gated on PR #2793 merging**. One coordination item (O1) is best resolved inside #2793.

Read-only. Every claim below was verified by grep or `git show` against the two branches named
above; nothing is asserted from the issue body or from the plan's own prose.

---

## 1. Reuse-collision sweep

The whole risk profile of this body is that it is the second consumer of a slice another open PR
creates. Each collision was resolved to one of three outcomes: *inherited* (#2410 makes no edit),
*additive* (#2410 appends, #2793's consumer unaffected), or *conflict* (needs a decision).

| # | Surface | On `wave-3a` | On `#2411` | Outcome |
|---|---|---|---|---|
| C1 | `apps/web/src/features/fulfillment/` | **absent** | 12 files | The slice does not exist on the base. #2410 cannot start until #2793 merges. **HARD GATE.** |
| C2 | `.eslintrc.js` `no-restricted-imports` | 0 `fulfillment/api/**` matches | present in **both** pattern groups | **Inherited.** #2410 edits this file zero times. The standing S3 rule is satisfied; step 0 verifies by grep rather than assuming. |
| C3 | `app/api/api-client.ts` `fulfillment` namespace | 0 matches | registered | **Inherited.** Zero edits. |
| C4 | `scripts/check-ui-vocabulary.mjs` `SCAN_ROOTS` | 4 roots, no `fulfillment` | 5 roots, `features/fulfillment` owner `W3a-21 (#2411)` | **Inherited.** Zero edits — see § 3 D1. |
| C5 | `SCAN_ROOT_PARENT` | `apps/web/src/features` (line 192) | unchanged | **Structural constraint confirmed.** A `pages/` scan root is impossible without editing this constant. The plan's D1 is correct and is not a rationalisation. |
| C6 | `features/orders/index.ts` hold exports | **absent** | adds `HOLD_REASON_COPY`, `HoldReasonValues`, `holdReasonLabel`, `isHoldReason`, `type HoldReason` | **Inherited transitively.** #2410 does not import them directly; #2411's card and dialog do. A second reason #2410 cannot precede #2793. |
| C7 | `apps/web/src/test/test-utils.tsx` `createMockApiClient` | no `fulfillment` mock | adds one with `listByOrder` + `applyAction` **only** | **Additive, and load-bearing.** Every page-level test in the plan's § 9 calls `apiClient.fulfillment.list(…)`, which is `undefined` on that default. #2410 adds `list` / `get` in Phase 1. Fifth shared file in the merge set. |
| C14 | Write permission / demo read-only | `useWriteAccess(permission, demoMode)` + `useDemoMode()` exist in `shared/auth` | panel uses `useWriteAccess('orders:write', demoMode)`, passes `visible` / `readOnly` into `FulfillmentTaskActions` | **Decision required of #2410, now recorded as D6.** `FulfillmentTaskActions` takes the decision as props, so the worklist page must make it. `orders:write` is reused; the backend route is `@Roles('admin','operator')`. |
| C8 | `apps/web/src/index.css` | no `.fulfilment-*` | appends a `.fulfilment-task*` block at EOF | **Additive**, both sides append at EOF. Textual merge, resolvable as "keep both". |
| C9 | `features/fulfillment/index.ts` | n/a | 4 exports, docblock explicitly anticipates #2410 as the second consumer | **Additive.** |
| C10 | `features/fulfillment/api/fulfillment.query-keys.ts` | n/a | `all`, `worksByOrder` | **Additive**; both new keys stay under the `all` prefix. |
| C11 | `features/fulfillment/api/fulfillment.api.ts` | n/a | `listByOrder`, `applyAction` | **Additive + one re-expression** (`listByOrder` routed through the new `list`). Pinned by a regression test on the emitted URL. |
| C12 | `hooks/use-fulfillment-task-action-mutation.ts` invalidation grain | n/a | `worksByOrder(orderId)` | **CONFLICT — see § 2 O1.** Not a defect in #2411; wrong grain for two consumers. |
| C13 | Route / nav / page slug `fulfillment` | no route, no nav entry, no `pages/fulfillment` | #2411 adds **no route** (`git diff --stat -- app/routes/` is empty) | **Clear.** `EXPECTED_LAZY_ROUTE_COUNT` is 61 on the base and #2411 does not move it, so #2410's bump to 62 is uncontested. |

Also verified present on the base, so no hidden dependency on #2793 for them:
`ApiError.isConflict/isForbidden/isNotFound/details`; `shared/ui` `read-only-lock`, `status-badge`,
`time-display`, `alert`, `button`, `dialog`, `select`, `textarea`, `form-field`, `data-table`;
`DEMO_READ_ONLY_ACTION_MESSAGE`. The cited precedents exist:
`features/returns/lib/returns-filters.ts` (whose docblock states the `offset`-is-not-a-filter rule
the plan reuses, exported as `hasActiveReturnFilters` — #2410's will be
`hasActiveFulfillmentFilters`, matching the convention) and
`features/fulfillment-authority/who-decides-styles.test.ts` (the CSS-assertion precedent).

**No file is stubbed, forked or reached across.** #2410's only edits to another live PR's files are
appends to five shared files (§ 2 O2), each of which #2793 also only appends to.

---

## 2. Contract-surface findings

### O1 — `use-fulfillment-task-action-mutation` invalidates an order-scoped key (COORDINATION, not blocking)

`#2411`'s hook invalidates `fulfillmentQueryKeys.worksByOrder(variables.orderId)` on success and on
a recognised conflict. The worklist's rows live under `fulfillmentQueryKeys.list(filters)`, which is
a sibling, not a descendant — so an action taken from the worklist would refresh #2411's panel and
**not the worklist that issued it**. The row would keep its pre-action `version`, which makes the
operator's *next* click a `version_conflict` that the UI itself manufactured — a self-inflicted
instance of exactly the failure the optimistic token exists to report.

Invalidating `fulfillmentQueryKeys.all` fixes it in one line, still refreshes #2411's panel
(`worksByOrder` is a descendant of `all`), and is **more correct for #2411 too**: a task can be moved
from the worklist while an order-detail panel is open on the same order.

- **Preferred**: #2793 makes the change before merging.
- **Fallback**: #2410 makes it, as an edit to a then-merged file.

Not blocking either PR: #2411 is correct in isolation, and #2410 has a working fallback.

### O2 — five shared files are appended to by both bodies

`apps/web/src/index.css`, `features/fulfillment/index.ts`,
`features/fulfillment/api/fulfillment.query-keys.ts`,
`features/fulfillment/api/fulfillment.api.ts`, `apps/web/src/test/test-utils.tsx`.

All additive on both sides; resolution is "keep both", but per the repo's own lesson the merge is
resolved **by intent and then re-grepped**, not accepted textually. The plan deliberately removes
three further collision points (`.eslintrc.js`, `api-client.ts`, `check-ui-vocabulary.mjs`) by
inheriting them instead of re-editing.

### O3 — no shaping defect in #2411 beyond O1

`FulfillmentTaskActions` takes `task` + callbacks and reads only `supportedActions` / `activeHolds`;
`FulfillmentTaskCard` takes an `actions` slot; `FulfillmentTaskActionDialog` takes `mode` as a prop
rather than inferring it; `readFulfillmentConflict` is a pure reader over `ApiError`. Every one is
consumable by the worklist unchanged. The slice was built to be shared and the barrel docblock says
so in as many words.

### O4 — the plan does NOT duplicate #2406's contract

`fulfillmentTaskPageSchema` already models `{works,total,limit,offset}`, i.e. exactly the list
response, because #2411's panel calls the same list endpoint filtered by `orderId`. So #2410 adds no
schema at all. This is the single largest scope reduction the reuse map buys, and it also means the
**#939 `.nullish()` rule is inherited rather than re-satisfied** — verified: every nullable field in
`fulfillment.schema.ts` is `.nullish()` with a `?? null` transform, and there is no `.optional()` in
the file.

---

## 3. Vacuity review of the proposed checks

The programme's recurring defect is a check that cannot fail. Each AC's proposed assertion was
tested against two questions: *is the property already covered elsewhere?* and *does the assertion
touch code this body changes?*

| AC | Already covered? | Touches changed code? | Verdict |
|---|---|---|---|
| AC1 no client-side state machine | Partially — the static guard catches two declaration shapes and **says in its own docblock** it cannot catch an inline `if (status === …)`; #2411 specs its own component | Yes — the worklist **row** is new and is where such a condition would appear | **Sound.** Non-empty-control-list precondition is the right vacuity guard. |
| AC2 the 409 path | `fulfillment-conflict.ts` + its spec are #2411's | Yes — the list query key, the page's mutation wiring and the O1 grain are this body's | **Sound, and the plan correctly declines to re-test the pure classifier**, which would pass with this entire body reverted. The "`list` called exactly twice" assertion is the one that fails when the handler is deleted; without it the test would survive that deletion. |
| AC3 responsive | No | Yes | **Sound**, and the plan names the real prior defect (`css.includes('.' + name)`) and requires the rule-opener match plus a rename-only red run. |
| AC4 copy audit | Partially — the shared gate already scans `features/fulfillment`; its blind spots are `pages/`, runtime-assembled strings, backend messages | Yes | **Sound.** The rendered-output audit is not a duplicate of the script: the humanised-raw-value red run proves the script stays green while the test goes red. The non-empty-render precondition and per-state `it()` split are required, not optional. |
| AC5 tests for non-trivial logic | No | Yes | Sound. |
| AC6 `shared` imports no `features`/`pages` | **Yes, fully — the ESLint rule exists and #2411 already registered the slug in both groups; this body adds no file under `shared/`** | **No** | **Correctly declines to add an assertion.** A test restating an existing lint rule over untouched code is the manufactured check the brief warns against. Verified by grep (C2) and by `pnpm lint`. |

No proposed assertion was found to be vacuous or to duplicate existing coverage.

---

## 3b. Review pass

A `/tech-review` of this plan (adversarial, run against both branches) returned **three BLOCKING
findings**, all of which are corrections to the PLAN and none of which is a defect in #2793 or in
#2406:

1. `test/test-utils.tsx` was missing from the plan's reuse map, its O2 count and its steps, while
   this gate's own C7 named it — the two documents disagreed. Fixed: § 3b row, Phase-1 step, O2
   corrected from three files to five.
2. Write permission and demo read-only were absent from the plan entirely, although
   `FulfillmentTaskActions` takes `visible` / `readOnly` as required props. As written the page
   would not compile, or would ship write controls to a read-only session. Fixed: D6, a step-11
   change, an AC1(d) assertion and a risk row.
3. AC3's breakpoint assertion named a claim with no mechanism and no red-first break — the shape of a
   check that cannot fail. Fixed: comment-stripped, brace-counted media-block extraction with its own
   named break (move the rule out of the `@media` → red).

Four IMPORTANT findings were also applied: the CSS matcher now reuses `who-decides-styles.test.ts`
structurally (declared-selector membership, BEM block-root exemption, fabricated-leaf guard-of-the-guard)
instead of a re-derived rule-opener regex; the copy audit reads its banned terms from the fenced
spec table instead of restating them (the draft had already drifted — it omitted `atpEffect`'s
`'ATP'` alternate); the reuse map gained § 3d for the three #2411 files deliberately not used; and
AC1 gained a hold-independence case, which is the row-level defect the status/counter cases miss.
Both SUGGESTIONs were taken (AC2 reads its label from `FULFILLMENT_ACTION_COPY`; the styles test
moved into the feature folder beside its precedent).

The review independently re-verified and confirmed every factual claim in § 1 of this document.

---

## 4. Verdict

**CONDITIONAL GO.**

Blocking condition, and only one: **PR #2793 must merge first.** It is not a preference — the
feature slice, the `fulfillment` api-client namespace, both ESLint pattern groups, the vocabulary
scan root and the four `features/orders` hold exports are all absent from `oms-programme-wave-3a`
and all present on #2411. Starting #2410 before then means creating the folder twice.

Non-blocking, for the orchestrator: **O1** (preferably fixed inside #2793) and **O2** (a five-file
additive merge, resolved by intent).

Scope: reduced from the pre-reuse estimate by roughly 40% — no schema, no types, no api-client
wiring, no ESLint edit, no vocabulary-script edit, no conflict reader, no copy table, no action
component, no card, no dialog, no mutation hook. What remains is the list axis: filters, lanes,
paging, one query hook, a desktop row, a page, a route and a nav entry.
