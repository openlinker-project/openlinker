# Implementation Plan: Order-detail fulfilment-task panel (work-grain holds)

**Date**: 2026-09-01
**Issue**: #2411 (`W3a-21`), epic #2412 (Wave 3a, stream S3)
**Status**: Ready for Review
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: add a panel to the existing order-detail page that lists the fulfilment tasks
(`FulfillmentWork`) covering that order — their line counters, their **work-grain holds**, and the
actions that are legal on each — rendered entirely from the read model #2406 (`W3a-19`) landed.

**Context**: DESIGN §5.2 puts work holds at the **work grain** (worklist + order-detail panel). The
orders *list* keeps rendering only the order-grain `activeHoldReason` — one projection, one
derivation input, no second contradictory surface. A work hold has no order-list surface at all
(open question §12.10, deliberately not a column).

**Classification**: Frontend / Interface.

---

## 2. Scope & Non-Goals

### In scope
- A `features/fulfillment` slice: typed API client, Zod projection schema, query keys, a per-order
  works query hook, an action mutation hook, and the operator copy for the closed vocabularies.
- `OrderFulfillmentTasksPanel` mounted on `/orders/:internalOrderId`.
- Heldness rendered from `activeHolds`, never from `status`.
- Actions rendered **only** from `supportedActions[]`, sent with the `version` that was rendered.
- Both 409 codes told apart by `code` and handled differently.
- Hold / release-hold / force-cancel dialogs for the actions that need a field.
- Mobile + tablet degradation (no horizontal page scroll).

### Out of scope — and why
- **The standalone desktop worklist** (`#2410`). This issue owns the *order-detail panel* only.
- **The routing explanation** (`RoutingExplanationStep[]`). The issue's Proposed Solution names it,
  but **no read surface for it exists**: `routing_decisions` has an entity + repository port and no
  service interface, no controller, no DTO, and `GET /fulfillment/works` carries no explanation
  field. Building one means a new core read service + HTTP surface + a vendor display-label registry
  (the labels are a `libs/oms` concern) — its own issue, not a frontend slice. Recorded under
  Questions & Assumptions; AC "explanation renders vendor rule names through display labels" is
  therefore **vacuously satisfied** (no raw identifier is rendered because no explanation is
  rendered) and re-opened as follow-up work.
- **The hold's actor.** `FulfillmentHoldView` deliberately withholds `placedByService` ("internal
  actor") and carries no `placedByUserId` either. The panel therefore renders reason + note +
  `placedAt` and says nothing about who. Inventing an actor, or showing only the user arm of the
  `CHK_fulfillment_holds_actor` XOR, would be the UI asserting something it is not in a position to
  know. Recorded as a follow-up.
- **`submit` / `request_cancellation`** — withheld from `OPERATOR_INVOCABLE_ACTIONS` server-side
  (they need buyer PII the projection does not carry). Rendering from `supportedActions` means the
  panel cannot offer them by construction.
- No orders-list change of any kind.

---

## 3. Architecture Mapping

**Target layer**: `apps/web` — `features/` + one composition line in `pages/orders`.

**Backend contract consumed** (all merged, #2406 / PR #2784):

| Route | Shape |
|---|---|
| `GET /fulfillment/works?orderId=…&limit=…` | `FulfillmentWorkPageResponseDto` |
| `POST /fulfillment/works/:workId/actions/:action` | `FulfillmentWorkResponseDto`; 409 `version_conflict` \| `action_not_legal`; 400; 404 |

**New FE feature slice**: `apps/web/src/features/fulfillment/`

```
features/fulfillment/
├── api/
│   ├── fulfillment.types.ts        # transport types (mirrors the DTOs)
│   ├── fulfillment.schema.ts       # Zod, `.nullish()` throughout (#939)
│   ├── fulfillment.api.ts          # createFulfillmentApi(request)
│   └── fulfillment.query-keys.ts
├── hooks/
│   ├── use-order-fulfillment-works-query.ts
│   └── use-fulfillment-work-action-mutation.ts
├── lib/
│   ├── fulfillment-vocabulary.ts   # action / status / requestStatus copy
│   └── fulfillment-conflict.ts     # 409 discrimination + copy
├── components/
│   ├── order-fulfillment-tasks-panel.tsx
│   ├── fulfillment-work-card.tsx
│   ├── fulfillment-work-actions.tsx
│   └── place-fulfillment-hold-dialog.tsx
└── index.ts                        # public barrel
```

Sibling of the existing `features/fulfillment-authority`. **Not** `features/orders`: the resource is
`/fulfillment/works`, the vocabulary is `fulfillment`'s, and #2410 needs the same client — a second
copy inside `orders` could never be deduplicated later without a rename.

**Dependency direction**: `pages/orders` → `features/fulfillment` → `shared`. `shared` imports
nothing new. `features/fulfillment` imports `features/orders`' `holdReasonLabel`? **No** — see
Decision 4 below.

---

## 4. Key Decisions

**D1 — Actions come from `supportedActions[]` and nothing else.**
`FulfillmentWorkActions` maps each entry of the array to a control via a copy table keyed by the
action name. There is no legality predicate anywhere in `apps/web`: no
`deriveSupportedActions`-shaped function, no `if (status === 'open')`, no re-statement of the status
vocabulary as a state machine. `scripts/check-no-supported-actions-mirror.mjs` catches the first
shape; the second is on us, and the copy table's shape (a `Record<action, copy>` consumed by
`array.map`) is what makes an inline status test have nowhere natural to go.

An action name the build does not recognise is **rendered with its raw name as a fallback label and
still invokable** — the server said it is legal, and hiding it would silently remove a capability
after a backend deploy. (The *reverse* fallback — inventing an action — is impossible here.)

**D2 — Heldness is `activeHolds.length > 0`, and it outranks `status` in the UI.**
Nothing writes `status = 'on_hold'`, so a held work reads `open`. The card's headline badge is
`On hold — {reason}` whenever `activeHolds` is non-empty, and the raw `status` is demoted to a
secondary label. Pinned by a test that feeds `status: 'open'` + one hold and asserts the badge does
**not** read "Open".

**D3 — `version` is captured at render, not at click.**
The mutation sends the `version` from the work object the button was rendered from. This is what
makes `version_conflict` reachable and meaningful; reading a fresher version out of the cache at
click time would paper over exactly the race the token exists to catch.

**D4 — The hold-reason copy is imported from `features/orders`' barrel, not re-mirrored.**
`FulfillmentHoldResponseDto.reason` is `HoldReason` from `@openlinker/core/order-lifecycle` — the
*same* union `features/orders/lib/order-hold.types.ts` already mirrors and `check-hold-reason-mirror.mjs`
already guards. A second mirror would need a second guard for one union. So
`holdReasonLabel` + `HoldReasonValues` are added to the `features/orders` barrel and imported
cross-feature (the sanctioned shape, `frontend-architecture.md § Feature Public Surface`).

**D5 — Counters are display-only and gate nothing.**
`recordLineProgress` does not bump `version`, so a counter can move under a valid token. They render
as `fulfilled / total` text with a caption saying they may be behind; no action's `disabled` reads
one.

**D6 — Both 409s are handled, differently.**
`readFulfillmentConflict(error)` reads `ApiError.details.code`:
- `version_conflict` → **retryable**. Invalidate the works query, toast "somebody moved this task
  first — refreshed", and re-render from the refreshed `supportedActions` carried in the body (so no
  second GET is needed for the controls even before the refetch settles).
- `action_not_legal` → **not retryable**. Surface it as an error toast naming the action, invalidate
  so the controls re-render, and do not retry.
- Any other error, or a 409 with no recognised `code`, falls through to the generic error toast —
  never silently treated as retryable.

**D7 — An order with no fulfilment work says so plainly.**
`works.length === 0` on a *settled, successful* query renders a one-sentence empty state
("No fulfilment tasks — this order was not routed to one."), not an empty panel. A loading query
renders a skeleton; a **failed** query renders an error line with a Retry. Those three are
distinguished, because "unknown" is not "none" — the recurring defect this programme keeps hitting.

**D8 — Write affordances are gated on `fulfillment:write`-equivalent, matching the route.**
The action route is `@Roles('admin', 'operator')`; reads are open to `viewer`. The panel renders the
tasks, their holds and their counters for everyone, and gates only the buttons — the `OrderHoldPanel`
shape. Demo mode keeps the disabled-but-visible treatment (`ReadOnlyLock`).

---

## 5. Questions & Assumptions

- **Q1 (open)**: no read surface exists for `RoutingExplanationStep[]`. Assumption: out of scope for
  a frontend issue; filed as follow-up. If a reviewer disagrees the panel has a natural slot for it.
- **Q2 (open)**: the hold projection carries no actor. Assumption: honour #2406's deliberate
  exclusion rather than widening a contract merged hours ago from a downstream consumer.
- **Q3**: which permission string gates the actions. Assumption: reuse the existing
  `useWriteAccess('orders:write')` + role check shape, verified against `ROLE_PERMISSIONS` during
  implementation; if no fulfilment permission exists, gate on role (`admin` OR `operator`) directly
  via the existing primitives rather than inventing a permission.
- **Q4**: page limit. Assumption: an order's works are few; request the backend default and render
  every returned row, reporting `total > works.length` as a plain note rather than paginating.

---

## 6. Implementation Plan

### Phase 1 — Transport
1. `api/fulfillment.types.ts` — the closed vocabularies as `as const` + union
   (`FulfillmentWorkActionValues`, `FulfillmentWorkStatusValues`, `FulfillmentRequestStatusValues`,
   `FulfillmentWorkConflictCodeValues`) and the response shapes.
   *Acceptance*: `supportedActions` is typed as the union with a raw-string fallthrough
   (`FulfillmentWorkAction | (string & {})`) so an unknown action still parses.
2. `api/fulfillment.schema.ts` — Zod over the page + work + line + hold. **Every nullable field uses
   `.nullish()`**; unknown enum members are preserved via `z.string()` + a narrowing helper, never
   `z.enum` (which would drop a whole work object because one status is new).
   *Acceptance*: a spec feeds a payload with `locationId: null` and asserts the work survives.
3. `api/fulfillment.api.ts` + `fulfillment.query-keys.ts`; register the namespace in
   `app/api/api-client.ts`.

### Phase 2 — Hooks
4. `use-order-fulfillment-works-query.ts` — `enabled: Boolean(orderId)`, parses through the schema.
5. `use-fulfillment-work-action-mutation.ts` — posts `{ expectedVersion, …fields }`, invalidates the
   order's works key on success **and** on either 409 (the server holds a truth this client does
   not), leaves the cache alone on anything else.

### Phase 3 — Vocabulary + conflict
6. `lib/fulfillment-vocabulary.ts` — `FULFILLMENT_ACTION_COPY` (`satisfies Record<action, …>`), plus
   status / request-status labels and a `fulfillmentWorkActionLabel(raw)` that falls back to the raw
   name. **No legality logic.**
7. `lib/fulfillment-conflict.ts` — `readFulfillmentConflict(error): FulfillmentConflict | null`.

### Phase 4 — Components
8. `fulfillment-work-card.tsx` — identity, held badge(s) from `activeHolds`, status/request-status,
   assignment/location, lines with counters + the display-only caption.
9. `fulfillment-work-actions.tsx` — one control per `supportedActions` entry, gated per D8; `hold`
   and `force_cancel` open a dialog for their required field, `release_hold` is rendered **per active
   hold** (it needs a `holdId`), everything else fires directly.
10. `place-fulfillment-hold-dialog.tsx` — reason select (from the orders barrel's `HoldReasonValues`)
    + optional note.
11. `order-fulfillment-tasks-panel.tsx` — the four query states of D7 + the list.
12. `index.ts` barrel; add the `fulfillment` slug to **both** `no-restricted-imports` pattern groups
    in `.eslintrc.js` for every canonical subdirectory.

### Phase 5 — Composition + tests
13. Mount in `order-detail-page.tsx` as a full-width `detail-section` after the primary grid.
14. Tests: schema (`.nullish()` survival), conflict reader (both codes + unrecognised), vocabulary
    fallback, card (held-not-Open; counters not gating), actions (rendered only from the array;
    unknown action still rendered), panel (loading / empty / error distinguished), mutation
    (`expectedVersion` sent; invalidation on both 409s).
    **Each new assertion is verified to go red with its change reverted.**
15. CSS in `index.css` using existing tokens; the card grid collapses to one column under the
    existing tablet breakpoint and long ids wrap (`overflow-wrap: anywhere`) so the page never
    scrolls horizontally.

---

## 7. Alternatives Considered

- **Put everything under `features/orders`.** Matches the issue's `File(s)` hint and avoids any file
  collision with #2410. Rejected: the resource, the vocabulary and the second consumer all belong to
  `fulfillment`, so the client would have to be moved later — and until then #2410 would either
  cross-import `orders` for a fulfilment client or write a second one.
- **Derive the actions client-side from `status` + `requestStatus`.** Rejected by the design (§5.2)
  and by a lint guard. It is also wrong: the derivation depends on holds and on the assignment
  handshake, and heterogeneous executors move those independently.
- **Widen the backend hold projection to carry the actor.** Rejected: #2406 excluded
  `placedByService` deliberately, hours ago, and a downstream FE issue is the wrong place to reverse
  a documented projection decision.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| An `if (status === …)` creeping in as the panel grows | The copy table + `array.map` shape leaves no natural site; a test asserts a work with an empty `supportedActions` renders zero buttons regardless of `status` |
| Concurrent #2410 creating the same files | Re-fetch `origin/oms-programme-wave-3a` before opening the PR and merge forward; the slice is designed to be the shared one |
| A stale `version` from an optimistic update | No optimistic updates (FE-001 default); `version` is only ever what the server sent |
| Toast spam on a 409 storm | One toast per mutation settle, as with every other mutation hook |

---

## 9. Acceptance Criteria (from #2411)

- [ ] The orders list is unchanged (no new column, no work-hold chip)
- [ ] Every Zod schema over a new backend projection uses `.nullish()`
- [ ] Explanation renders vendor rule names through display labels, never raw identifiers —
      *vacuous: no explanation surface exists to read; deferred with reason (§2)*
- [ ] Tests added or updated for non-trivial logic
- [ ] `shared` imports no `features`/`pages`
- [ ] `pnpm lint && pnpm type-check && pnpm test && pnpm test:integration` green


---

## 11. Review dispositions (applied before implementation)

`/pre-implement` and `/tech-review` both ran against §1–§10 above. Everything
below was applied; the shipped code follows this section where it differs from
the sections above.

| # | Finding | Disposition |
|---|---|---|
| CRITICAL (pre-implement) | `check-no-supported-actions-mirror.mjs` has **two** matchers. The second, `/(const\|let\|var\|enum\|type)\s+FulfillmentWorkAction(Values)?/`, is tripped by Phase 1's own acceptance criterion. | **Applied, and it improved D1.** `apps/web` declares no such type. `supportedActions`, `status` and `requestStatus` are `string`; the copy tables are loose `Record<string, …>` with a humanising fallback. A `satisfies Record<Union, …>` was undesirable anyway — it would have broken the build the day a seventh action landed, the exact opposite of "still invokable". |
| BLOCKING (tech-review) | D6 asked for invalidate **and** a cache patch from the 409 body — which carries no `lines`/`activeHolds`/`orderId`, so the patched object would fail the slice's own schema. | **Applied: invalidate only.** The "no second GET" claim is withdrawn; the refetch is the re-render, per `frontend-architecture.md § Async UX Conventions`. `FulfillmentConflict.supportedActions` is still surfaced, as a reported fact, not a cache write. |
| IMPORTANT | "Unknown action still invokable" weighed only one failure mode; a future action needing a body field would 400 every time. | **Applied.** It stays rendered and invokable, and `describeFulfillmentActionError` surfaces the **server's own 400 message** — which names the unknown action or the missing field precisely — instead of a generic sentence. |
| IMPORTANT | "Mirrors the DTOs" would type timestamps `Date` while strings arrive. | **Applied.** Every instant is `z.string()`, stated in both docblocks, rendered through `TimeDisplay`. |
| IMPORTANT | Two proposed assertions could not fail for the stated reason. | **Applied and proven.** The held-badge test is a POSITIVE assertion; the counter test compares the enabled-control set across two renders differing only in counters. Four mutations were run against the finished code (heldness from `status`; a smuggled `status === 'open'` injection; `expectedVersion + 1`; an injection that fires only on an empty array) and each turned the relevant assertion red. |
| IMPORTANT | §2 promised three dialogs; the file list had one. | **Applied.** One `FulfillmentTaskActionDialog` with a caller-supplied `mode` serves all three — they differ only in copy and which of two fields renders. `force_cancel` collects no `cancellationReason`: the API defaults it to `operator_forced`, which is what the control means. |
| WARNING (pre-implement) | Copying `OrderHoldPanel`'s gate verbatim would AND in `useIsAdmin()` and silently hide every action from operators. | **Applied.** `useWriteAccess('orders:write', demoMode)` alone — it is held by exactly `admin` + `operator`, matching the route's `@Roles('admin', 'operator')`. A test pins that an operator sees the controls. |
| WARNING | Two further 409s (hold limit, already released) carry a message and no `code`. | **Applied.** An un-coded 409 is not retryable and surfaces `ApiError.message` verbatim, so "this task already has the maximum number of holds" is not replaced by "could not do that". |
| WARNING | `features/fulfillment` sits outside `check-ui-vocabulary.mjs`'s scan roots. | **Applied** — added as a scan root with the folder. It caught one real violation on the first run ("Holder reference" → "External reference"). |
| WARNING | `docs/frontend-architecture.md` is a mandated companion edit to the ESLint slug lists. | **Applied.** |
| OPEN QUESTION (pre-implement) | `release_hold` carries both `note` and `releaseNote`; sending the wrong one loses the operator's note silently. | **Applied.** The mapping is done once, in the open, in the dialog's submit; a test asserts `releaseNote` is sent and `note` is absent. |
| SUGGESTION | The routing-explanation deferral overstated the missing work — `RoutingRuleRef` already carries `displayLabel`. | **Corrected here**: what is missing is a read service + HTTP surface, not a label registry. The follow-up should be scoped to that. |
| SUGGESTION | Two ACs cannot fail as written. | **Recorded** in §9 rather than ticked as verified work. |
| SUGGESTION | No committed mockup exists for this panel. | **Stated in the PR description**, per `frontend-architecture.md § UX Mockups`. |
