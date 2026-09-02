# Implementation Plan: returns events on the order timeline (#2383, `W2-45`)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~1 day (S/M — re-scoped from M)

---

## 1. Task Summary

**Objective**: an operator who starts at the order can see that a return happened, and what has been
done about it, without leaving for `/returns`.

**Classification**: Frontend (Interfaces) **plus one additive backend read**.

---

## 2. Scope, after the re-scope — and what the two ledger checks found

#2383 originally carried three surfaces. Both `docs/lessons.md` checks were run over it **before
planning**, as gate items, and **all three surfaces had a premise problem**:

| Surface | What the check found | Outcome |
|---|---|---|
| `Operations` nav item for Returns | **Already exists** — `nav-registry.ts:43`, `{ to: '/returns', label: 'Returns' }`, inside the `Operations` group (line 32). Shipped by #2335. | Dropped |
| Order-detail returns panel | **Duplicates #2640**, which was split out of #2381 and additionally carries the order-scoped returns READ that #2383 never mentioned. | Moved to #2640 |
| Returns events on `OrderActivityTimeline` | Real, unduplicated — and with **nothing supplying it**. | **This issue** |

So this plan covers the third surface only.

### Two assumptions verified rather than relied on, with OPPOSITE results

The issue's Assumption block said *"the order timeline's `TimelineEvent` shape needs no change"*, and
its solution said to reuse *"the return-timeline renderers"*. An assumption is a claim with nothing
supplying it until someone checks, so both were checked first.

**VERIFIED TRUE — `TimelineEvent` needs no field change.** It already carries
`id` / `timestamp` / `title` / `by?` / `description?` / `tone` / `footer?`
(`order-activity-timeline.tsx:29`). The AC's *"distinguish OL-owned acts from source observations via
`by`"* is precisely what `by` is documented for (*"Actor eyebrow"*). No shape change is needed and
none will be made.

**FALSE — the "return-timeline renderers" do not exist.** There is no `*timeline*` file anywhere under
`features/returns` and no `ReturnActivityTimeline` in the tree. Spec § 5 lists one in its panel order;
it was never built. So this is **new work, not reuse**, and the plan says so rather than inheriting
the word.

**Also absent — any order-scoped read of return EVENTS.** `ReturnRepositoryPort` has
`listLineEvents(lineId)` and `findOutstandingRestockEventsForReturn(returnId)`; nothing by order. And
`features/orders` has zero returns awareness — no import, nothing in `orders.types.ts`.

### Distinct from #2640's read, deliberately

#2640 needs an order-scoped list of **returns** (rows). This needs an order-scoped read of return
**events** (acts: receive, dispose, stock attestation — plus record-level facts: opened, declined,
refunded). **Neither is assumed to serve the other.** Composing #2640's filter with a per-return
event fetch would be an N+1 across a page load; if the two are ever unified that is a decision to
make explicitly, not a convenience to discover.

### Out of scope

- The nav (done) and the order-detail panel (#2640).
- Any change to `TimelineEvent`'s shape — verified unnecessary above. **If implementation shows it
  IS needed, that is a finding to report, not a change to make silently.**
- A `ReturnActivityTimeline` on the return detail page. Tempting, since this issue builds the mapper
  that would feed it — but it is a second surface on a different page and #2318 § 5 owns it.

---

## 3. Design — who maps, and who merges

**The returns feature maps its own events; the orders timeline merges an injected array.**

`buildEvents` already takes **fifteen positional parameters** (`order-activity-timeline.tsx:173`). A
sixteenth would be unreadable, and worse, it would put returns vocabulary inside the orders timeline
builder — the wrong direction. Instead:

- `features/orders` **exports `TimelineEvent`** (today a private interface). It owns the timeline, so
  it owns the type.
- `features/returns` exports a pure `mapReturnEventsToTimeline(events, sessionUserId): TimelineEvent[]`
  — `sessionUserId` is a parameter because the `by` table's first two rows compare against it, and a
  pure mapper must not reach for session state itself and a
  `useOrderReturnEventsQuery(orderId)`, importing the type as `from '../../orders'` — the #2100
  cross-feature barrel shape, and an edge that **already exists** (`return-money-panel.tsx:36`).
- `OrderActivityTimeline` gains one optional `extraEvents?: TimelineEvent[]` prop. It learns nothing
  about returns.

**The merge rule — because there is no existing sort to merge into.** The `/tech-review` gate found
that `buildEvents` ends `return events;` (`order-activity-timeline.tsx:380`) and the file's only
`.sort(` is the local one over `syncAttempts` (`:242`). The timeline's order is **authored insertion
order** — a deliberate narrative that deliberately includes undated entries
(`timestamp: salesDocumentBlockedAt ?? null`, `:350`). An earlier draft said "merged into its existing
sort"; that sort does not exist.

Appending is not acceptable either — returns events pinned to the bottom regardless of when they
happened is the dateless-entry defect one level up. So:

- **Stable insert by timestamp, never a global re-sort.** Each injected event is placed before the
  first authored event whose timestamp is strictly later than its own; ties keep the authored entry
  first. Authored entries are never compared with each other, so their relative order is untouched by
  construction.
- **An undated authored entry keeps its authored position** — it is not a comparison key and never
  floats to an end. An injected event with a null timestamp is not possible: every in-scope source
  supplies one (§ 4 Phase 1), and the mapper drops nothing, so a source that ever stopped supplying
  one is a finding, not a silent null.
- **The invariant is pinned, not assumed**: with `extraEvents` absent OR empty, the rendered order is
  identical to today's. That test is what makes the change safe and is stronger than a
  "renders identically" smoke test, because it asserts about ORDER specifically.
- **If implementation shows this cannot be expressed without moving an existing entry, STOP and
  report.** Reordering an authored narrative on someone else's surface is a product decision, not an
  implementation detail.
- **The page composes**, which is what pages are for: `order-detail-page.tsx` already imports both
  features.

**`by` is the honesty axis** — an event whose provenance is unknown must not default to either side.
The per-row rules are written out in § 4, not left to the implementer.

---

## 4. Implementation plan

### Phase 1 — the read, over FOUR sources rather than one

**The readiness gate caught this plan's own hedge.** An earlier draft described the read as *"return
events (acts … plus record-level facts)"* and then designed a single query over
`return_line_events`. That ledger has exactly four kinds — `receive | dispose | stock_attestation |
not_returned` — so it supplies the custody acts and nothing else. The parenthetical made it read as
covered. **Naming a thing is not sourcing it**, and the audit is per SOURCE, not per step.

Where the seven events actually live:

| Timeline event | Source |
|---|---|
| received, disposed, restock blocked, not returned | `return_line_events` (`restockState` distinguishes the blocked case) |
| **opened**, **declined** | header COLUMNS on `returns` — `openedAt`, `declinedAt` |
| **refund confirmed** | `RefundRecord` (`recordedAt`, linked by `returnId`) — **not** `moneyState`, see below |
| ~~credit note issued~~ | **OUT OF SCOPE — see below** |

1. **`findEventsForOrder(internalOrderId)`** on `ReturnRepositoryPort` + repository — the custody
   acts, joined from `return_line_events` through `returns.internalOrderId`.
2. **The record-level facts ride the SAME read.** `openedAt` / `declinedAt` are columns on the very
   `returns` rows the join already touches, so sourcing them costs one wider projection rather than a
   second query. The service assembles one ordered list from both.
3. **`listReturnEventsForOrder(orderId)`** on a returns service interface, projecting a neutral
   shape — never the ORM row — with a discriminator saying which source each entry came from, so a
   consumer never has to infer provenance from the shape.
4. **`GET /returns/events?internalOrderId=…` on the RETURNS surface.** The gate settled this: both
   `returns-read.module.ts` (since #2382) and `return-actions.module.ts` already import
   `OrdersModule`, so no new module wiring is needed either way — and the data is the returns
   context's own, so it belongs on its surface.
   - **Acceptance**: int-spec asserts acts from two returns on one order come back together, that a
     second order's are excluded, and that a return with `openedAt`/`declinedAt` set contributes
     those entries.

5. **The discriminator's values are named, closed, and about the SOURCE** — `custody_act` |
   `record_status` | `refund` — so the mapper's unknown-*kind* arm (Phase 2) cannot quietly absorb an
   unrecognised *source* as well. `ReturnLineEventKindValues` carries its own separate four
   (`receive | dispose | stock_attestation | not_returned`) and its docblock warns that **nothing in
   the tree branches on it and the compiler will not catch a new member** — which is exactly why the
   two vocabularies stay distinct rather than being flattened into one union.

### `refund confirmed` is read through `IOrderRefundService` — a named cross-context edge

`return_lines` has `receivedAt` and `disposedAt` and **no money timestamp at all**
(`return-line.orm-entity.ts:121-131`), so `moneyState` can supply the FACT and never the `timestamp`
a `TimelineEvent` requires. A dateless entry on a surface whose whole job is *when things happened*
is not a degraded entry, it is a wrong one. And dropping the money event while `received` and
`disposed` remain is the same "reads as broken" argument that decided `opened`.

So the record is read, and the edge is stated in full rather than implied:

- **A read-only call to `IOrderRefundService.getRefundsForReturn(returnId)`**
  (`libs/core/src/orders/application/interfaces/order-refund.service.interface.ts:27`) — an existing
  method, added by #2382, with a partial index behind it
  (`IDX_refund_records_return_id … WHERE "returnId" IS NOT NULL`, `refund-record.orm-entity.ts:40`).
  No new port method, no new index for this half.
- **It lands in the INTERFACE layer, not in `ReturnsService` — corrected during implementation.**
  An earlier version of this paragraph called the edge one `returns` "already has". That is true of
  the TypeScript barrel and **false of the NestJS module graph**, which is the level DI actually
  runs on: `ReturnsModule` excludes `OrdersModule` *deliberately*, and says so in three places
  (*"NOT `OrdersModule`, which imports seven siblings this context has no business pulling in"*,
  `returns.module.ts:111`). It reaches `orders` only through the leaf `OrderChangesModule` and the
  report-don't-persist seam. Injecting `IOrderRefundService` into `ReturnsService` would add exactly
  the edge that module was designed to avoid.
  So the split follows the boundary that already exists: `ReturnsService.listReturnEventsForOrder`
  owns the two returns-owned sources and the connection-name resolution, and `ReturnsController`
  — which **already** injects `IOrderRefundService`, under a module that **already** imports
  `OrdersModule` (#2382 named that edge in its own docblock) — composes the refund entries in.
  **Net: no new module edge anywhere.** An edge stated is reviewable; an edge implied is how the
  next one arrives unnoticed, and this one nearly arrived as a paragraph rather than as a code
  change.
- The timestamp is `RefundRecord.recordedAt` (`:60`). The service call is one fan-out over the
  returns already resolved for the order — bounded by the number of returns on ONE order, not a page.

### The read returns CONTEXTS as well as entries — found on the diff review

Composing the refund entry needs four per-return facts (`externalReturnId`,
`returnOrigin`, `sourceConnectionName`, and the id itself). A first
implementation looked them up from the entries already read, which is wrong in
two ways that a passing test would not have shown:

- **A return with no entry of its own loses its refund entirely.** `openedAt` is
  persisted as `null` when a source reports an unparseable `createdAt`
  (`returns.service.ts` `parseOpenedAt`, which logs and continues), so a return
  can legitimately have no header fact and no acts — and its refund would have
  been silently dropped. Reachable through a logged production path, not a
  hypothetical.
- **The missing-context fallback DEFAULTED `returnOrigin` to `source_ingested`**,
  which states that a channel opened a return the operator authored. A defaulted
  provenance is a claim, not a gap — the same rule the `by` table below is built
  on.

So `listReturnEventsForOrder` returns `{ entries, returns }`, where `returns`
covers **every** return on the order, entry-producing or not. The controller
iterates the contexts. Pinned by an int-spec that nulls `openedAt` and asserts
the refund still arrives with its real origin.

### `by` — what each row actually renders

The AC asks `by` to distinguish OL-owned acts from source observations, and `actorUserId` resolves to
no display name anywhere in the tree (#2382). So the rule is written out rather than left to the
implementer:

| Event | `by` renders |
|---|---|
| Custody act, `actorUserId === sessionUserId` | `you` |
| Custody act, `actorUserId` set and different | the neutral other-operator string (#2382's `return-restock-blocked-notice.tsx:74` rule verbatim) |
| Custody act, `actorUserId` null | **omitted** — never defaulted to either side |
| `opened` / `declined` on a `source_ingested` return | the channel name |
| `opened` / `declined` on an `operator_authored` return | the neutral operator string, never a channel |
| `refund confirmed`, `executedBy === 'operator_out_of_band'` | the neutral "recorded by an operator" string — **never a person** |
| `refund confirmed`, `executedBy === 'refund_executor'` | the neutral "OpenLinker" string |

**`RefundRecord` has NO actor column** — a third instance of the same defect, caught on the second
pass. It carries `executedBy` (`refund-record.orm-entity.ts:108`, ADR-056), whose values are
`operator_out_of_band | refund_executor` (`refund-record.types.ts:38`) and which answers *what moved
the money*, **not who**. An earlier draft of this very table said "resolved from the record's own
actor"; there is no such actor, so the refund rows above are `executedBy`-derived and name no person.
That is also the honest reading — ADR-056 exists precisely so OL never claims to have moved money it
did not move.

`opened` / `declined` have **no actor column** on `returns` either, so their `by` is a SOURCE claim or
nothing — which `origin` (`ReturnOriginValues = ['source_ingested', 'operator_authored']`,
`return.types.ts:33`) answers exactly. The channel name is resolved **server-side** and projected as
`connectionName: string | null`, reusing the shape #2378 already ships on the blocked-restock read
(`return-restock-blocked-notice.tsx:144`) including its unknown-connection copy fallback — the
frontend never resolves a connection id to a name itself, and a null renders that fallback rather
than an id.

### `credit note issued` is DEFERRED, with the reason

It lives in `invoicing` / `order_changes` — **a different bounded context**. Reaching for it here
would either manufacture a cross-context edge inside a frontend issue or produce a quiet omission
that reads as a bug. Recorded as a decision rather than left as a gap. Whether it earns its own
issue is the coordinator's call, not this plan's.

### Phase 2 — the mapper (new work)

6. **`features/returns/lib/return-timeline-events.ts`** — pure, no I/O: return events →
   `TimelineEvent[]`, with copy in a `.copy.ts` beside it.
   - Covers: opened, declined, received, disposed, restock blocked, stock handled manually, refund
     confirmed. **`refunded` renders only from an observation**, never from the trigger (#2378).
   - An **unrecognised** event kind renders its raw kind rather than being dropped: a silent drop is
     the disappearance defect this programme keeps closing.

### Phase 3 — the merge

7. Export `TimelineEvent` from the orders barrel; add `extraEvents?` to `OrderActivityTimeline`.
8. Wire in `order-detail-page.tsx`, gated on the order having an id.

### Phase 4 — tests, named so they can be checked BY NAME

- `return-timeline-events.test.ts` — every kind maps; `by` distinguishes OL act from observation; an
  unknown kind survives.
- `order-activity-timeline.test.tsx` — injected events merge in timestamp order and the component
  renders identically with none.
- **`order-detail-page.test.tsx` — asserts the returns events appear ON THE PAGE.** A component test
  renders the component itself and cannot prove anything mounts it (`docs/lessons.md`).
- int-spec for the new read.

---

## 5. Risks

- **Risk — an order with no returns.** The timeline must render exactly as today, not an empty
  section. Pinned by a test.
- **Risk — `by` defaulting.** An event whose actor is unknown must say so rather than claiming
  either side; `actorUserId` resolves to no name anywhere (#2382), so the same you/other-operator
  rule applies.
- **Backward compatibility** ✅ — `extraEvents` is optional; the read is additive. Exporting
  `TimelineEvent` (today a private interface, `order-activity-timeline.tsx:29`) is additive too.
- **Migration — YES, one index, and an earlier draft's "none" was false.** `returns.internalOrderId`
  is indexed (`IDX_returns_internal_order_id`), so the join *starts* cheap — but on
  `return_line_events` the only `returnId` index is **partial**:
  `WHERE "restockState" IN ('blocked','in_doubt')`, built for #2378's blocked-segment count. A
  timeline wants EVERY act, so that index cannot serve it, and the other leads on `returnLineId`.
  Without a new index this is a sequential scan of the act ledger on every order-detail page load.

  **Concretely**: `CREATE INDEX "IDX_return_line_events_return_id_occurred" ON "return_line_events" ("returnId", "occurredAt")`
  — no predicate, deliberately, since a timeline wants every act and a partial index is precisely
  what the existing one gets wrong here. `occurredAt` is in it as the second column because the read
  orders by it within a return, so the index serves the ordering as well as the lookup. The **ORM
  entity gains the matching `@Index('IDX_return_line_events_return_id_occurred', ['returnId', 'occurredAt'])`**
  in the same commit — the #2373 discipline: the integration harness builds its schema with
  `synchronize`, so an entity/migration mismatch is invisible in every gate and appears only in
  production. Parity is verified MECHANICALLY, not read.

  Migration slot `1863000000000` is reserved and unused; no other slot is taken.

---

## 6. Acceptance criteria

- [ ] Timeline distinguishes OL-owned acts from source observations via `by`
- [ ] `TimelineEvent`'s shape is **verified** before being relied on — done above, and no change made
- [ ] Cross-feature imports go through the public barrels, never a deep path
- [ ] Read-only and demo modes behave (this surface is read-only, so it renders for both)
- [ ] Component tests, **plus a page test asserting the events render on the page**
- [ ] An order with no returns renders the timeline unchanged
- [ ] All FOUR in-scope sources contribute — a timeline showing `received` but never `opened` reads
      as broken rather than partial, and invites distrust of the entries that ARE there
- [ ] `credit note issued` is absent BY DECISION, recorded in the plan, not omitted silently
- [ ] **With `extraEvents` absent or empty, the rendered timeline order is identical to today's** —
      pinned by a test that asserts about ORDER, not merely that the component still renders
- [ ] No injected event renders without a timestamp
- [ ] The `returns → orders` refund read is via `IOrderRefundService`, named in the plan, acyclic
- [ ] Migration and ORM entity declare the same index; parity verified mechanically
- [ ] A refund on a return with no entry of its own still reaches the timeline,
      carrying its real `returnOrigin` rather than a defaulted one
