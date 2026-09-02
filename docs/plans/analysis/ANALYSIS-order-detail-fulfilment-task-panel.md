# Readiness Gate: Order-detail fulfilment-task panel

**Plan**: `docs/plans/implementation-plan-order-detail-fulfilment-task-panel.md`
**Issue**: #2411 (`W3a-21`), epic #2412 (Wave 3a, stream S3)
**Date**: 2026-09-01
**Gate**: `/pre-implement` — read-only. No source or plan file was edited.

---

## Verdict: **NEEDS-REVISION**

One **Critical** finding: Phase 1 step 1 and Phase 3 step 6, as written, declare symbols that
`scripts/check-no-supported-actions-mirror.mjs` is built to reject, so `pnpm lint` fails before a
single test runs. The fix is a rename plus a narrowed typing decision — roughly ten minutes of plan
edit, not a redesign. Everything else in the plan checks out against the live tree, and several of
its riskier assumptions (the 409 discrimination, `ApiError.details`, the barrel gap, the two ESLint
groups) are **confirmed correct**.

---

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `apps/web/src/features/fulfillment/` slice | **NEW (confirmed absent)** | No such directory; 33 sibling slices exist, incl. `fulfillment-authority` |
| FE consumer of `GET /fulfillment/works` | **NEW** | `grep -rn "fulfillment/works" apps/web/src` → no hits. Only two prose mentions of `FulfillmentWork` (`connections/components/router-readiness-panel.tsx:43`, `orders/lib/order-lifecycle-phase.ts:18`), both vocabulary-gate comments |
| `holdReasonLabel`, `HoldReasonValues` on the orders barrel | **PARTIAL (re-export only)** | Both exist in `features/orders/lib/order-hold.types.ts` (:29, :104) but neither is in `features/orders/index.ts`. D4's "are added" is accurate; precedent is the `REFUND_*` block (#2382) |
| Backend routes + DTOs | **ALREADY EXISTS → consume** | `apps/api/src/fulfillment/http/fulfillment-work.controller.ts`; `.../dto/fulfillment-work-response.dto.ts` |
| Both 409 codes | **ALREADY EXISTS** | `fulfillment-work.controller.ts:201,214` — each `ConflictException` body carries `code` **and** refreshed `supportedActions`. D6 is exactly right, incl. "no second GET needed" |
| `ApiError.details` carries the parsed body | **CONFIRMED** | `shared/api/api-error.ts:36-46`; body comes from `readResponseBody` → `response.json()`. Working precedent for reading `details.code`: `shared/api/analytics-consent-error.ts:24-29` |
| api-client registration pattern | **ALREADY EXISTS → copy** | `app/api/api-client.ts:73` (import), `:197` (interface member), `:420` (factory call) — a three-line addition |
| ESLint slug groups | **CONFIRMED (two)** | `.eslintrc.js:259-263` (features group) and `:502-506` (plugins group). Plan step 12 is accurate |
| `fulfillment:write` permission | **DOES NOT EXIST** | Absent from `PermissionValues` in both `libs/core/src/users/domain/types/role.types.ts` and `apps/web/src/shared/auth/session.types.ts` |
| `useWriteAccess` / `useIsAdmin` / `ReadOnlyLock` | **ALREADY EXISTS → reuse** | `shared/auth/use-permission.ts`; `shared/ui/read-only-lock.tsx`; precedent `features/orders/components/order-hold-panel.tsx:60,124` |
| `OPERATOR_INVOCABLE_ACTIONS` excludes `submit`/`request_cancellation` | **CONFIRMED** | `libs/core/src/fulfillment/application/types/fulfillment-work-view.types.ts:129` — §2's "cannot offer them by construction" holds |

No reuse collisions. The slice is genuinely new and correctly placed.

---

## Backward-compatibility findings

### CRITICAL — C1: Phase 1 step 1 trips `check-no-supported-actions-mirror.mjs`

The guard walks **all of `apps/web/src`** (`.ts/.tsx/.js/.jsx`, minus `node_modules`/`dist`), strips
comments, and fails on either matcher. The second one is the problem:

```js
/(?:const|let|var|enum|type)\s+FulfillmentWorkAction(?:Values)?\b/
```

The plan proposes, verbatim:

- Phase 1.1 — "the closed vocabularies as `as const` + union (`FulfillmentWorkActionValues`, …)"
  → `export const FulfillmentWorkActionValues = […] as const;` **matches**.
- Phase 1.1 acceptance — "`supportedActions` is typed as … `FulfillmentWorkAction | (string & {})`"
  → requires `export type FulfillmentWorkAction = …` **matches**.
- Phase 3.6 — `FULFILLMENT_ACTION_COPY` `satisfies Record<action, …>` needs that same union.

There is **no allowlist** in the script and no per-file exemption mechanism. This is a hard
`pnpm check:invariants` failure, i.e. `pnpm lint` red.

D1's own prose says the guard "catches the first shape" (the `derive*SupportedActions` matcher) —
that is a misreading. The guard has two matchers, and the second one exists precisely to stop a
frontend holding a local copy of the action vocabulary, which is what Phase 1.1 proposes.

**Suggested resolution** — the guard's intent and the plan's intent are compatible; only the naming
and the closedness are wrong:

1. **Do not declare a closed action vocabulary at all.** Type `supportedActions` as `string[]`. The
   plan already commits (D1) to rendering from the array with a raw-name fallback for unknown
   entries, so nothing downstream needs the union to be exhaustive.
2. Key the copy table as `Record<string, ActionCopy>` (a plain lookup with a fallback), **not**
   `satisfies Record<FulfillmentWorkAction, …>`. Note that the `satisfies` form is actively
   undesirable here: it makes the build fail when the backend adds a seventh action, which is the
   opposite of D1's stated "still invokable" degradation.
3. If a named type is wanted for readability, avoid the matched prefix — `WorkAction` /
   `WorkActionName` is clear and does not match (the regex anchors on `FulfillmentWorkAction`).
   Confirmed safe by the guard's own self-check: `import type { FulfillmentWorkAction } from …` does
   not match, but there is nothing importable here (the browser bundle cannot depend on
   `@openlinker/core`, #591).

Note the same rename discipline applies to test files — the guard scans `.test.tsx` too.

### WARNING — W1: D8's permission does not exist; the gate must be `orders:write` alone

D8 says "gated on `fulfillment:write`-equivalent". No `fulfillment:*` permission exists. Q3
anticipates this, so this is a resolve-before-coding rather than a design error, but the resolution
should be pinned in the plan because getting it wrong is silent:

- The action route is `@Roles('admin', 'operator')`.
- `ROLE_PERMISSIONS` grants `orders:write` to exactly `admin` + `operator` — an exact match.
- Therefore the gate is `useWriteAccess('orders:write', demoMode)` **without** `useIsAdmin()`.

Copying `OrderHoldPanel` verbatim would be wrong: it ANDs in `useIsAdmin()` because *its* route is
admin-only. Copying that line would hide every fulfilment action from operators — the role the panel
mainly exists for, failing silently with no error.

Adding a real `fulfillment:write` permission is possible but costs a two-file, order-sensitive
change policed by `scripts/check-permission-mirror.mjs` (`role.types.ts` +
`shared/auth/session.types.ts`, identical membership **and order**). Out of scope for this issue;
`orders:write` is the right call.

### WARNING — W2: two 409s carry no `code` at all

Beyond the two discriminated codes, `toHttp` maps `FulfillmentHoldLimitExceededError` and
`FulfillmentHoldAlreadyReleasedError` to a `ConflictException` with a **plain string message and no
`code` field**. D6's final clause ("a 409 with no recognised `code` falls through to the generic
error toast — never silently treated as retryable") already handles this correctly.

Worth stating explicitly in the plan, though, because the hold-limit case is reachable from the
panel's own primary action: an operator placing one hold too many gets the generic toast, not a
tailored message. Recommend the generic branch surface `ApiError.message` (which `fromResponse`
populates from the body's `message`) rather than a fixed string, so the server's sentence reaches
the operator. Add a test for the no-`code` 409.

### WARNING — W3: `features/fulfillment` is outside the UI-vocabulary gate's scan roots

`scripts/check-ui-vocabulary.mjs` bans `FulfillmentWork` (exact) and the alternate `fulfillment work`
in operator-facing copy, but `SCAN_ROOTS` lists only `fulfillment-authority`, `automation`,
`returns`, `orders`. A new `features/fulfillment` folder is **not scanned**, so the plan's own copy
discipline would be unenforced there. The plan's visible copy ("fulfilment tasks", "No fulfilment
tasks…") is already compliant. Recommend adding the slice to `SCAN_ROOTS` in the same PR — the gate
fails an existing root with nothing scannable, so add it only once the folder has real `.tsx`.

### WARNING — W4: `docs/frontend-architecture.md` update is mandated, not optional

The ESLint Group A comment states: *"Adding a new cross-imported feature: extend the slug list below
and update docs/frontend-architecture.md."* Plan step 12 covers the two ESLint groups but not the
doc. Same commit.

### Not a break

- Adding `holdReasonLabel` / `HoldReasonValues` to the orders barrel does **not** trip
  `check-hold-reason-mirror.mjs` — it reads only the `export const HoldReasonValues = [` declaration
  in two fixed files and never looks at `index.ts`. D4 is safe.
- No ORM entity, port signature, DTO shape, or Symbol token is changed. **No migration required.**
- No cross-context import concern: `apps/web` does not import `@openlinker/core`.

---

## Open questions

1. **Q1 (explanation surface) — endorsed.** Verified: `routing_decisions` has an entity + repository
   port and no service interface, controller or DTO, and `GET /fulfillment/works` carries no
   explanation field. Deferring is correct. The AC should be marked *deferred with reason* rather
   than *vacuously satisfied* — a checked box on an unbuilt surface reads as done to anyone
   auditing the epic later.
2. **Q2 (hold actor) — endorsed.** `FulfillmentHoldResponseDto` is `{ id, reason, note, placedAt }`.
   Widening a projection merged hours ago from a downstream consumer is the wrong direction.
3. **Q3 (permission) — now resolved**; see W1. Fold the answer into D8 before coding.
4. **Q4 (limit) — low risk.** `ListFulfillmentWorksQueryDto` accepts `limit`/`offset` and the page
   response reports the post-clamp `limit`; rendering all rows and noting `total > works.length` is
   fine.
5. **New, unresolved: what does `release_hold` send?** Plan step 9 renders it per active hold
   (correct — it needs a `holdId`), but the body DTO carries both `note` and `releaseNote`. Confirm
   which field the release path reads before wiring the dialog; sending the wrong one loses the
   operator's note silently.

---

## Required before implementation

1. **C1** — drop the closed action vocabulary; type `supportedActions` as `string[]`, key the copy
   table by `string`, and avoid any `FulfillmentWorkAction[Values]` declaration in `apps/web/src`
   (production and test files alike).
2. **W1** — pin D8 to `useWriteAccess('orders:write', demoMode)` with no `useIsAdmin()` conjunct.
3. **W2** — state the no-`code` 409 branch and surface `ApiError.message` in it; add a test.
4. **W3 / W4** — add the slice to `check-ui-vocabulary.mjs` `SCAN_ROOTS` and update
   `docs/frontend-architecture.md` alongside the two ESLint groups.

Once C1 is resolved the plan is sound: the architecture placement, the 409 handling, the
heldness-over-status rule, and the barrel strategy are all confirmed correct against the live tree.
