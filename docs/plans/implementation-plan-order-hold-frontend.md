# Implementation Plan: Order hold badge, place/release dialogs, reason filter and timeline (#2342)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Issue**: #2342 (`W2-5`), last child of body A — #2338 → #2339 → #2340 → #2341 → **#2342**

---

## 1. Task Summary

**Objective**: give order holds an operator surface. Until now a hold is an API:
`OrderHoldService` refuses to provision and refuses to dispatch a held order
(#2339), `order_records.activeHoldReason` caches the open reason (#2340), and
`POST /orders/:id/holds` + `POST /orders/:id/holds/:holdId/release` write it
(#2341) — and nothing in `apps/web` says any of that happened.

**Context**: Story L4 requires the operator to see *why* an order is held and
*who* held it, wherever they already are — the orders list, the order detail
page, and the activity timeline.

**Classification**: Frontend (Interface layer), plus one small, additive API
filter parameter (see § 5, decision D2).

---

## 2. Scope & Non-Goals

### In Scope

1. `OrderHoldBadge` — `On hold — {reason}` on the orders list, rendered by ONE
   component used by both the desktop row and the mobile card.
2. A `?hold=<reason>` narrowing filter that round-trips through the URL and
   resets the paging offset.
3. `Place hold` / `Release hold` actions on the order detail page, gated so a
   non-admin never sees an action that would 403.
4. RHF + Zod dialogs for both writes, with the conditional release-note rule.
5. `held` / `released` entries in `OrderActivityTimeline`, carrying the placer.
6. Component tests for the badge, both dialogs, the copy map and the filter
   round-trip; every surface usable at 375 px.

### Out of Scope

- Any migration. The columns and the table already exist (#2338/#2340).
- A hold-count chip. `?phase=held` (#2310) already ships one, with a real count
  from `lifecycleSummary`; a second chip meaning the same thing is a duplicate
  control, not a feature. See decision D2.
- Bulk hold / bulk release.
- Placing a hold from the list row. The list DISPLAYS and the detail page ACTS
  (#2081 rule 3, the rule `OrderPackedControl` already follows).
- Free-text reasons. The vocabulary is closed by ADR-059 ("actions yes, states
  no") and short enough for a select.
- A desktop-only treatment. The hold dialogs are **not** "complex editors" under
  `frontend-ui-style-guide.md` § Responsive's parity matrix — a reason select
  plus a note is not a category mapping — so they stay fully interactive below
  1024 px and never show the "open on a desktop screen to edit" affordance. The
  precedent is `GenerateLabelForm` and `BulkDispatchDialog`, both mobile-live.

### Constraints

- `apps/web` may not import `@openlinker/core` (#591). `HoldReasonValues` is
  therefore mirrored, and the mirror is guarded (D4).
- Dependency direction `app → pages → features → shared`; `shared` imports
  neither `features` nor `pages`.
- Server state via TanStack Query, form state via RHF + Zod, URL state via
  search params. No global store.
- Operator copy avoids the banned vocabulary (`authority`, `phase`, `holder`, …).
  `features/orders` is not a `check-ui-vocabulary.mjs` scan root, so this is
  honoured by hand rather than by the gate.

---

## 3. Architecture Mapping

**Target layer**: Interface (`apps/web/src/features/orders/**`, `pages/orders/**`),
plus one additive filter through `apps/api` → `libs/core/src/orders` (D2).

**Existing components reused**:

| Reused | Where from | Why |
|---|---|---|
| `OrderPhaseBadge` shape | `features/orders/components/order-phase-badge.tsx` | the badge is one `StatusBadge` used by row + card; nothing new is needed |
| `OrderPackedControl` shape | `features/orders/components/order-packed-control.tsx` | the exact detail-page write-affordance precedent: `useWriteAccess` + `ReadOnlyLock` + toast |
| `invoicingBlockedBadge` copy-table shape | `features/orders/lib/order-row.ts` | `satisfies Record<Union, …>` so a new reason is a compile error, not an unlabelled row |
| `Dialog`, `Select`, `Button`, `Alert`, `StatusBadge`, `TimeDisplay` | `shared/ui` | no new primitive |
| `useMarkPackedMutation` shape | `features/orders/hooks` | invalidate `ordersQueryKeys.all`, no optimistic update |

**New components**: `order-hold.types.ts` (mirror + copy), `order-hold-badge.tsx`,
`place-order-hold-dialog.tsx` + `.schema.ts`, `release-order-hold-dialog.tsx` +
`.schema.ts`, `order-hold-panel.tsx`, `use-place-order-hold-mutation.ts`,
`use-release-order-hold-mutation.ts`.

---

## 4. Contract consumed (from #2341)

| Field | Where | Shape | Note |
|---|---|---|---|
| `activeHoldReason` | **every** row (list + detail) | `HoldReason \| null` | free — the column is already loaded. Badge source. |
| `activeHold` | detail only | `OrderHoldDto \| null` | **optional on the wire** |
| `holdHistory` | detail only | `OrderHoldDto[]` | **optional on the wire** |
| `POST /orders/:id/holds` | 201 | `{ hold }` | 409 `ORDER_ALREADY_ON_HOLD`, 400 unknown reason |
| `POST /orders/:id/holds/:holdId/release` | 200 | `{ hold, provisioningResume }` | 409 `HOLD_ALREADY_RELEASED`, 400 note required |

`provisioningResume`: `{ status: 'enqueued' \| 'skipped' \| 'failed'; jobId; reason }`
where `reason ∈ ProvisioningResumeSkipReasonValues ∪ {'enqueue-failed'}`.

Both routes are `@Roles('admin')`.

---

## 5. Decisions

### D1 — `.nullish()`, never `.optional()`, on the two detail-only fields

`activeHold` / `holdHistory` are declared optional on `OrderRecordResponseDto`,
and OL snapshots serialise an absent optional field as JSON `null`. Under
`.optional()` a `null` sub-field drops the whole section and blanks the cell
(#939). The orders feature parses list/detail records as plain TS types rather
than through a Zod schema (`orders.types.ts`), so the concrete obligation is:
declare both as `?: X | null` and treat `undefined` and `null` identically at
every read. Where a Zod schema is introduced (the dialog forms), `.nullish()`.

### D2 — the filter is `?hold=<reason>`, reason-scoped, and adds one API param

The issue asks for a `?hold=` chip "following the `salesDocumentBlockReason`
treatment exactly". Followed literally that yields a boolean `?hold=true` chip —
which is **exactly what `?phase=held` already does** (#2310 ships the chip, the
count from `lifecycleSummary.held`, the offset reset and the SQL predicate
`rec."activeHoldReason" IS NOT NULL`). Shipping it would put two controls with
one meaning in the same filter bar.

The axis `?phase=held` genuinely cannot express is the **reason**. So:

- `?hold=<HoldReason>` narrows to one reason. No `any` value — that is
  `?phase=held`. The FE field is `OrderFilters.holdReason` (not `hold`), so the
  reason sense is visible at the call site and it cannot read as a boolean; the
  URL param stays the short `hold`, and the core field is `activeHoldReason`.
  Param-vs-core divergence is established precedent (`?invoicing=` →
  `salesDocumentBlocked`, `?phase=` → `lifecyclePhase`).
- It composes with `phase`, `health` and every other axis, like every other
  filter on this page.
- Rendered as one `Select` in the filter bar ("Hold reason"), not as eight
  chips: eight chips for a state most installs rarely hit is noise, and the
  chip row is reserved for partitions that carry counts.

**API cost**: `OrderRecordFilters.activeHoldReason?: HoldReason` in
`libs/core/src/orders/domain/types/order-record.types.ts`, one `andWhere` in
`OrderRecordRepository`, one validated query field in `ListOrdersQueryDto`, one
pass-through in `OrdersController`. Additive; no migration; no default change.

**Reading `activeHoldReason` for a filter is allowed.** The #2340 rule is that
no *gate* may read the projection — it is a display cache with an hourly repair
window. A filter is a display query, and the repository's own `?phase=held`
predicate already reads the same column for the same reason.

### D3 — the write actions are gated on `role === 'admin'` AND `orders:write`

`useWriteAccess('orders:write', demoMode)` alone is wrong here: `ROLE_PERMISSIONS.operator`
includes `orders:write`, but both routes are `@Roles('admin')`. An operator would
be shown a button that 403s. The panel therefore gates on
`session.user?.role === 'admin'` as well, and a non-admin sees the badge, the
active hold and the full history with no action — which is the AC.

`demoReadOnly` keeps its usual meaning (visible-but-disabled under
`ReadOnlyLock`), and is only ever reached by a demo admin.

### D4 — the `HoldReason` mirror is guarded

`apps/web` cannot import `@openlinker/core`, so `HoldReasonValues` is copied into
`features/orders/lib/order-hold.types.ts`. A drifted copy silently drops a reason
from the select and renders an unlabelled badge, so `scripts/check-hold-reason-mirror.mjs`
compares the two arrays (order-sensitive, like `check-authority-kind-mirror`) and
runs under `pnpm check:invariants`. The copy table is
`satisfies Record<HoldReason, HoldReasonCopy>` so a reason added to the mirror
without copy is a compile error.

### D5 — `provisioningResume.failed` is reported, never swallowed

A release that answers `failed` means the hold is gone AND the order is still
un-provisioned, with no cron backstop for that one order. A flat success toast
would assert something the backend explicitly declined to assert (the wave's
standing #2336/#2367 rule). So:

| `status` | Surface |
|---|---|
| `enqueued` | success toast — "Hold released. Provisioning restarted." |
| `skipped` | success toast — "Hold released." plus the skip reason as plain copy; a skipped order is healthy (it has no source-side job to run). |
| `failed` | **warning** toast, and a **session-local** `Alert` on the hold panel naming the remedy: the existing per-destination **Retry** action. The dialog closes — the release DID happen and re-submitting would 409. |

`provisioningResume` is persisted by **nothing** — it is returned once by the release response, and by then the hold is closed and the panel renders "Not on hold". The alert is therefore component-local `useState` on the detail page and is **gone on reload or navigation**; calling it "persistent" would assert a durability the UI cannot deliver, which is the wave's own standing rule (#2336/#2367) turned inward. The toast is the primary signal; the alert is a session-local echo that keeps the remedy on screen while the operator acts on it.

`reason` is switched on exhaustively via a `satisfies Record<…>` copy map.

### D6 — the release note is conditionally required, in the schema

The DTO does not require `note`; the domain does, only when a USER releases a
SERVICE-placed hold. The dialog knows the placer (`activeHold.placedByService`),
so the Zod schema is built per-open with `superRefine`, and the submit button is
disabled until a non-whitespace note is entered *for that case only*. A
user-placed hold releases with no note, exactly as the backend allows.

### D7 — 409s branch on `code`, never on message

Both conflicts carry a distinguishable `error` code in the body. The API client
must surface it. `ApiError` is checked for a `code`/`error` field; if the shared
client does not already expose the body, the two mutation hooks map the raw body
themselves. Copy: `ORDER_ALREADY_ON_HOLD` → "This order is already on hold —
reload to see the current one."; `HOLD_ALREADY_RELEASED` → "This hold was
already released."; both refresh the order query so the surface self-corrects.

---

## 6. Implementation Plan

### Phase 1 — contract + vocabulary

1. **`features/orders/lib/order-hold.types.ts`**
   `HoldReasonValues` mirror + `isHoldReason` + `HOLD_REASON_COPY`
   (`{ label, hint }` per reason, `satisfies Record<HoldReason, …>`) +
   `PROVISIONING_RESUME_COPY`. Pure; falls under the `*.types.ts` pure-rule
   exception (`engineering-standards.md`), same shape as `order-lifecycle-phase.types.ts`.
   *Acceptance*: unit test asserts every reason has copy and `isHoldReason`
   rejects an unknown string.

2. **`scripts/check-hold-reason-mirror.mjs`** + wire into `check:invariants`.
   *Acceptance*: script fails when a value is added to core only.

3. **`features/orders/api/orders.types.ts`** — add `OrderHold`,
   `ProvisioningResume`, `activeHoldReason?: HoldReason | null`,
   `activeHold?: OrderHold | null`, `holdHistory?: OrderHold[] | null`,
   and `OrderFilters.holdReason?: HoldReason`.

4. **`features/orders/api/orders.api.ts`** — `placeHold`, `releaseHold`,
   `if (filters?.holdReason) params.set('hold', filters.holdReason)`.

   **Nothing new is exported from `features/orders/index.ts`.** `orders` is the
   most cross-imported barrel in the app, so the silence is deliberate rather
   than an oversight: no other feature consumes a hold surface. An export is one
   line when the first consumer appears.

5. **Backend filter (D2)** — `OrderRecordFilters.activeHoldReason`,
   repository `andWhere`, `ListOrdersQueryDto.hold` (`@IsIn(HoldReasonValues)`,
   optional), controller pass-through. Unit tests on the DTO + repository.

### Phase 2 — read surfaces

6. **`features/orders/components/order-hold-badge.tsx`** — one `StatusBadge`,
   `compact` prop, `title` carrying the reason hint. Renders nothing for
   `null`/`undefined`/unrecognised (the `OrderPhaseBadge` contract).
   **It mounts in the STATUS semantic group** — desktop cell and mobile card —
   never Shipment or Money. `frontend-ui-style-guide.md` § Order-row signal
   placement rule 2 makes an exception a badge (a workflow position is a tick),
   and puts exceptions in Status beside the failure reasons; a hold is exactly
   that shape of fact, and the open-return badge is its precedent. One component
   serves both surfaces; only the surrounding `<dd>` is the page's business.

7. **`pages/orders/orders-list-page.tsx`** — the `Hold reason` select bound to
   `?hold=`, added to `NARROWING_FILTER_URL_PARAM` under the `holdReason` key
   (the exhaustive `Record` makes this a compile error if forgotten, which is
   also what resets offset).

8. **`features/orders/components/order-activity-timeline.tsx`** — one `held`
   entry per `holdHistory` row (dated `placedAt`, actor = the user id or the
   service name, tone `warning`) and one `released` entry per released row
   (dated `releasedAt`, actor = releasing user, tone `default` — a release is
   not a failure), each carrying its note. `buildEvents` already takes 15
   positional parameters; a 16th is not acceptable, so the new data is passed
   as a single trailing `holds` array and a follow-up to convert the whole
   signature to an options object is noted, not attempted here.

### Phase 3 — write surfaces

9. **`features/orders/hooks/use-place-order-hold-mutation.ts`** and
   **`use-release-order-hold-mutation.ts`** — invalidate `ordersQueryKeys.all`;
   no optimistic update (the instant and actor are stamped server-side).

10. **`place-order-hold-dialog.tsx` + `.schema.ts`** — reason `Select`
    (required, from the mirror) + optional note (`max(2000)`), RHF + Zod.

11. **`release-order-hold-dialog.tsx` + `.schema.ts`** — shows what is being
    released (reason, placer, when, note), note field required per D6,
    `provisioningResume` handling per D5.

12. **`order-hold-panel.tsx`** — mounted on the order detail page beside
    `OrderPackedControl`. Renders: the active hold (reason, placer, when, note)
    or "Not on hold"; the released history; the `Place hold` / `Release hold`
    button per D3; the persistent `failed`-resume `Alert` per D5.

### Phase 4 — tests

13. `order-hold.types.test.ts`, `order-hold-badge.test.tsx`,
    `place-order-hold-dialog.test.tsx`, `release-order-hold-dialog.test.tsx`,
    `order-hold-panel.test.tsx`, plus assertions added to
    `orders-list-page.test.tsx` (filter round-trip + offset reset) and
    `order-activity-timeline.test.tsx`.

    Named cases the ACs demand: badge identical from one renderer; filter
    round-trip resets offset; release of a service-placed hold blocks submit
    until a note is entered; a non-admin sees badge + history and no action;
    `provisioningResume.failed` renders the retry remedy.

---

## 7. Alternatives Considered

**A1 — boolean `?hold=true` chip, literal reading of the issue.** Rejected:
duplicates `?phase=held` exactly (D2). A second control with one meaning is the
defect this wave keeps removing, not a feature.

**A2 — eight reason chips in the chip row.** Rejected: the chip row carries
counts, and there is no per-reason count endpoint; eight countless chips for a
rare state is noise. A `Select` says "narrow" without promising a number.

**A3 — gate the write actions on `orders:write` alone.** Rejected: operator
holds that permission and the routes are admin-only, so the button would 403 —
the issue's own AC forbids it (D3).

**A4 — place a hold from the list row.** Rejected: the list displays, the detail
page acts (#2081 rule 3), and a hold needs a reason the row cannot collect.

**A5 — treat a `failed` resume as success.** Rejected outright: it asserts a
fact the backend deliberately declined to assert, and leaves an un-provisioned
order looking healthy (D5).

---

## 8. Risks & Edge Cases

| Risk | Handling |
|---|---|
| `activeHoldReason` is stale (hourly repair window) | badge only; every gate and both writes go through the API, which reads `order_holds`. Stated in the component header. |
| Mirror drift | D4 guard script. |
| A `holdHistory` row carries a reason this build does not know | badge renders nothing, timeline still renders the entry with the raw value — a hold the operator cannot see is worse than one labelled awkwardly (the `describeAmendment` precedent). |
| Concurrent release from two tabs | 409 `HOLD_ALREADY_RELEASED` → copy + refetch (D7). |
| `provisioningResume` absent on an older API | treated as `undefined` ⇒ plain success toast; never invented as `enqueued`. |
| 375 px | dialogs are `shared/ui/dialog` (already responsive); the panel stacks; the badge is `compact` on the card. Every interactive element clears the **≥ 44 px tap-target floor** `frontend-ui-style-guide.md` § Responsive requires on mobile — the action button, the reason select and the dialog's submit/cancel pair. Asserted by test. |

**Backward compatibility**: every new field is optional; the new query param is
optional and omitted by default. An older API and a newer UI both work.

---

## 9. Alignment Checklist

- [x] Hexagonal architecture respected (Interface layer only, plus one additive
      filter that flows domain → repository → controller in the existing shape)
- [x] No CORE ↔ Integration boundary touched
- [x] Existing patterns reused (`OrderPhaseBadge`, `OrderPackedControl`,
      `invoicingBlockedBadge`, `useMarkPackedMutation`)
- [x] No migration
- [x] `apps/web` imports no `@openlinker/core`; the mirror is guarded
- [x] Server/URL/form state ownership per `frontend-architecture.md`
- [x] Responsive in scope
- [x] Error handling: both 409 codes, the 400 note case, and the three
      `provisioningResume` arms
- [x] Testing strategy covers every acceptance criterion
- [x] Execution-ready

---

## Related Documentation

- `docs/specs/product-spec-oms-wave2-operator-experience.md`
- `DESIGN-oms-authority-model.md` § 6.3 / § 6.4
- `docs/architecture/adrs/059-order-lifecycle-derived-phase.md`
- `docs/frontend-architecture.md`, `docs/frontend-ui-style-guide.md`
