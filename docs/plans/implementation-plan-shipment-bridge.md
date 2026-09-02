# Implementation Plan: Shipment Bridge (#2402 / `W3a-13`)

**Date**: 2026-08-31
**Status**: Draft — carries two BLOCKING AC-deliverability findings (D-1, D-2)
**Branch**: `2402-shipment-bridge` (base `origin/oms-programme-wave-3a`)
**Estimated Effort**: 1–1.5 days

---

## 1. Task Summary

**Objective**: link a `Shipment` to the `FulfillmentWork` it satisfies, and guarantee that
the OMS itself mints no shipments — an OL-executed `shipped` goes through
`ShipmentDispatchService` unchanged, a 3PL shipping under its own contract produces an
*observed* branch-1 shipment and never a fabricated `providerShipmentId`.

**Context**: DESIGN §5.5. Wave 3a stream S1. Dependency #2400 (`IFulfillmentProgressService`).

**Classification**: CORE (Application + Infrastructure) + one migration.

---

## 2. Two findings that reshape the AC

### D-1 — `shipment_lines` does not exist, and this issue does not create it. **RESOLVED, coordinator-confirmed.**

`libs/core/src/shipping` declares exactly one entity, `@Entity('shipments')`. A repo-wide
grep for `shipment_line` returns only #2392's deferral comment. #2392's plan D-8 offered
three options and this issue takes **(b): the column lands on `shipments`**.

Three grounds, in order of force:

1. **DESIGN §5.2 contradicts itself in one sentence** — *"Relationship to `Shipment` is 1:N
   with the shipment keeping its identity; `shipment_lines` gains a nullable
   `fulfillmentWorkId`."* For a 1:N work→shipment relation the FK belongs on the **many**
   side, i.e. `shipments`. A line table would express M:N at line grain, which is not the
   stated relation. Implementing the sentence literally ships the contradiction.
2. **`shipment_lines` is a different concern with a different key and a different motive** —
   `DECISION-oms-fulfilment-grain` option C / ANALYSIS-1032 item 13, keyed
   `(shipmentId, orderId, lineId, quantity)` with `orderId` deliberately present so
   consolidated shipping across two orders stays expressible. Its purpose is making
   `shipped_quantity` / `delivered_quantity` derivable, not linking work to shipment. It
   carries four obligations none of which are #2402's: a lossy **backfill written as ledger
   events** (else cancel/reissue double-counts permanently), the `fulfillment-rollup.ts`
   "any delivered ⇒ delivered" precedence fix, line counters, and an FE line panel.
3. **It has no owner issue.** Being filed separately by the coordinator with that obligation
   list. *Correction to the record*: the grain decision's blocking prerequisite (item 14 —
   PrestaShop's positional `String(row.id || index)` line-id fallback) **has since been
   fixed**; `prestashop-order.mapper.ts` now routes through `resolveOrderRowId`, which
   throws on a missing id rather than falling back to the array index. That blocker is
   cleared; the other three obligations stand.

### D-2 — the AC's central verb is not deliverable as written. **BLOCKING — report before implementing.**

The AC says a `shipped` progress event on OL-executed work *"calls
`IShipmentDispatchService.dispatch(...)` unchanged"*. It cannot, today.

`ShipmentDispatchInput` = `{ sourceConnectionId, sourceDeliveryMethodId, deliveryIntent? }`
**&** `Omit<GenerateLabelCommand, 'shipmentId'|'connectionId'|'deliveryMethodId'|'shippingMethod'>`
— which makes **`recipient` and `parcel` required**. `GenerateLabelCommand.recipient` is
documented *"The caller resolves it from the order."*

Every existing caller receives them from outside core:

| Caller | Source of `recipient` / `parcel` |
|---|---|
| `apps/api/.../shipment.controller.ts:254` `generateLabel` | `dto.recipient` / `dto.parcel` — operator-supplied |
| `BulkShipmentDispatchService.dispatchBulk` | `input.items[]`, i.e. the same DTO one level up |

**Nothing in `libs/core` derives a recipient or a parcel from an order.** The readiness gate
sharpened this and the sharpening *strengthens* it: a `recipient` projection **does** exist —
`apps/web/src/features/orders/lib/dispatch-input.ts:116-141`, pure and framework-free, deriving
recipient from the order snapshot — but it lives in the **browser**, and **`parcel` is an
operator-supplied argument** (`args.parcel`: dimensions, weight, template) derived from nothing
in the order at all. The same module ships a `missing-recipient` ineligibility reason, proving
the recipient half legitimately fails for some orders. An automatic dispatch would therefore
have to **invent parcel weight and dimensions** — the values that decide what the carrier
charges and whether the label is valid. There is no
order→recipient/parcel projection to reuse, and `automation` — the one core context that
fires dispatches automatically — turns out to call a *different* `dispatch` (its own action
dispatcher) and imports no shipping at all (`@openlinker/core/{order-lifecycle,orders,users}`).

So an automatic `shipped`-triggered `dispatch()` needs a new order→recipient/parcel
projection with no precedent to copy. That is not a size-M S1 slice, and it is the wrong
thing to invent under time pressure: **a wrong recipient projection ships a parcel to the
wrong address**, and OL would have authored the error rather than relayed it.

**Recommendation — deliver the bridge as the LINKAGE plus the mint guarantee, and defer the
auto-dispatch trigger with an owner.** Every one of #2402's three real ACs is satisfied by
that scope; none of them needs the payload. Concretely, the linkage is stamped through the
creation site each branch **already has**, rather than opening a new one.

### D-3 — AC-1 is already false on `main`; its honest reading is testable

AC-1 reads *"No code path outside `ShipmentDispatchService` creates a shipment."* There are
**two** creation sites today:

- `shipment-dispatch.service.ts:434` — the label-generating branch.
- `fulfillment-status-sync.service.ts:416` `createBranchOneShipment` — the ADR-012 branch-1
  observed row, which DESIGN §5.5 *itself* names as where a 3PL shipment comes from.

The AC's intent is **"the OMS mints no shipments"**, i.e. this bridge opens no **third**
creation site. That is what the assertion test asserts (exact call-site count, so a future
third site fails the build).

---

## 3. Architecture mapping, and the constraint that decides placement

**HARD CONSTRAINT.** `libs/core/src/fulfillment` is a zero-sibling-edge leaf.
`barrel-purity.spec.ts`'s `ZERO_SIBLING_EDGE_LEAVES` allows it exactly
`['@openlinker/core/fulfillment-authority', '@openlinker/core/order-lifecycle']` and rejects
every other `@openlinker/core/*` specifier **including type-only**. So:

- `fulfillment` **cannot** import `shipping`. It may only **report** (ADR-053
  report-don't-perform, the #2100 `SalesDocumentBlockOutcome` shape).
- Adding a member to `FulfillmentRelayIntent` needs no import and is in scope.
- The consuming composition lives **in `shipping`**, which already imports sibling contexts
  freely (`integrations`, `mappings`, `orders`, `identifier-mapping`, `sync`). The new
  `shipping → fulfillment` edge is one-way and type/interface-only, so no DI cycle.

**The success criterion for placement is that this change adds ZERO entries to
`ZERO_SIBLING_EDGE_LEAVES` and zero to `check-cross-context-imports.mjs`'s `ALLOW_LIST`.**
Needing one is the signal the placement is wrong.

---

## 4. Design

### 4.1 Schema — `shipments.fulfillmentWorkId`

```ts
// shipment.orm-entity.ts
@Index('IDX_shipments_fulfillmentWorkId', ['fulfillmentWorkId'], {
  where: '"fulfillmentWorkId" IS NOT NULL',
})
// …
@Column({ type: 'text', nullable: true })
fulfillmentWorkId!: string | null;
```

- **Nullable**, because every shipment predating the OMS — and every shipment for an
  unrouted order — legitimately has no work. Nullable is the normal state, not a migration
  artefact.
- **No FK**, per the cross-aggregate precedent the tree already applies
  (`order_changes`, `refund_records`, `returns.internalOrderId`): an indexed reference by
  value, avoiding cross-table lock coupling on a write path that already takes a per-order
  lock. A real FK is reserved for a part-of-its-parent child
  (`return_lines.returnId ON DELETE CASCADE`) — a shipment is not part of a work; it
  outlives it and is independently queryable.
- **Partial index**, matching the `IDX_shipments_reservation_consume_pending` precedent on
  the same table: the populated set is a minority for the foreseeable future, and the
  predicate references only the monotone column itself (never a mutable status), so rows do
  not enter and leave the index on ordinary updates.

### 4.2 Writer discipline

`fulfillmentWorkId` is set **at creation only**, by the two existing creation sites, and is
never patched afterwards. It is therefore:

- present on `CreateShipmentInput` (optional),
- **absent from `UpdateShipmentInput`**, and
- **excluded from any update path** — the repo's `update()` never touches it.

**Confirmed by the readiness gate (F-2)**: `buildUpdatePayload`
(`shipment.repository.ts:264-286`) builds a `Partial<ShipmentOrmEntity>` behind
`if (patch.x !== undefined)` guards, so keeping the field out of `UpdateShipmentInput` is
**sufficient** — no extra guard needed.

**Silent-failure trap (F-1), and the reason T4 asserts the persisted row.** `create()` calls
`repository.save(entity)` on a fully-populated entity from `buildOrmEntity`
(`shipment.repository.ts:197-243`), which assigns every column explicitly. Adding the column to
the ORM entity but **forgetting `buildOrmEntity` does not fail to compile** — `save` omits it
and the DB writes `NULL`, silently, on every row. Three mapping sites therefore change
together: `buildOrmEntity` (:197), `toDomain` (:288-313, **23 positional constructor args —
append the new field at the END**, as `shipment.entity.ts:47-53` mandates), and the `Shipment`
constructor itself.

This is the single-narrow-writer rule (`cancelledAt`, `salesDocumentBlockReason` precedent).
It also means **no conditional-UPDATE claim marker is needed here**: the column is not a
claim, it is provenance written once with the row. `waybillRelayedAt` / `reservationConsumedAt`
are claims because two unlocked triggers race to act on one transition; nothing races to
assign a work id, because the row does not exist until its creator assigns it.

### 4.3 Attempt attribution (#2399)

Progress must be attributable to the attempt it belongs to. **The shipment does not carry
`assignmentAttempt`, deliberately** — it carries `fulfillmentWorkId`, and the attempt lives on
the work row where #2399's conditional UPDATE claims it. Denormalising the attempt onto the
shipment would create a second copy of a value that legitimately advances after the shipment
exists (a re-assignment does not un-ship a parcel), and the copy would then be wrong with no
writer able to fix it.

Attribution of a *stale* answer is handled where #2400 already handles it: the progress claim
row. `record()` burns `(workId, idempotencyKey)`, and the relay intent it returns is emitted
**only on the non-duplicate path** — so an answer arriving after a re-assignment either dedups
(no intent, no second link) or is a genuinely new fact. The plan adds no second attribution
mechanism.

### 4.4 The bridge

**Two stamps and one intent.**

1. **`ShipmentDispatchInput.fulfillmentWorkId?: string`** — threaded to the `shipments.create`
   call at `shipment-dispatch.service.ts:434`. Optional, so every existing caller is
   byte-identical. This is how an OL-executed dispatch links, whether triggered by the
   operator today or by an automatic trigger later (D-2's deferral).
   *Note the retry branch*: when `priorBranchOne` exists the service `update()`s instead of
   creating. The work id is **not** in that patch — the row already carries the work id its
   creator gave it, and a retry of the same work must not rewrite provenance.

2. **`CreateShipmentInput.fulfillmentWorkId?`** consumed by
   `FulfillmentStatusSyncService.createBranchOneShipment` — the 3PL observed branch. It
   resolves the work for `(orderId, connectionId)` through
   `IFulfillmentWorkQuery` (see 4.5) and stamps it. **It creates the row exactly as it does
   today in every other respect** — in particular `providerShipmentId` stays untouched
   (i.e. `NULL`), which is AC-2, held by construction rather than by a rule someone must
   remember.

3. **`FulfillmentRelayIntent` gains `{ kind: 'shipment'; workId; orderId; connectionId }`**,
   emitted by `record()` on a `shipped` event. Pure vocabulary — no import, no sibling edge.
   It is **reported, never performed**, exactly like the existing `dispatch` and `reroute`
   members. #2401 owns the `dispatch` (relay-to-order-source) member and is untouched here.

### 4.5 The `shipping → fulfillment` read

`FulfillmentStatusSyncService` needs "which work covers this order on this connection".
That is a **read of another context**, so it goes through an `I*Service` interface, never a
`*RepositoryPort` (the cross-context contract rule; a `*RepositoryPort` import would fail
`check-cross-context-imports.mjs`).

**`findByOrderId` already exists** (`fulfillment-work-repository.port.ts:188`, returning
`FulfillmentWork[]`), so this service **adds no repository method** — it surfaces an existing
one across the boundary, which is exactly what the import rules force (the port matches
`check-cross-context-imports.mjs`'s `/RepositoryPort$/` deny pattern and is deliberately off
the barrel). There is no by-order-**and**-connection variant; the service filters the returned
array caller-side rather than growing the port.

**Token-name check (readiness gate F-6)**: `shipping.tokens.ts` already declares
`FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN` — a shipping-owned `FULFILLMENT_*` token for the older
shipping-local notion of "fulfillment". Both barrels `export *` over their token files, so any
new token must be checked by name against **both** files; a collision would be ambiguous for a
consumer star-importing both.

`IFulfillmentWorkQueryService.findActiveByOrderAndConnection(orderId, connectionId)` —
added to `fulfillment`'s application interfaces, bound via a new token in
`fulfillment.tokens.ts`, `export *`-ed by the existing sub-barrel line.

**Merge hazard, flagged**: `fulfillment.tokens.ts`, `fulfillment.module.ts` and
`fulfillment/index.ts` are contended by #2395/#2396/#2401. A previous merge in this wave
produced **two `exports:` keys** in a module — valid TypeScript that silently drops the
first with no error anywhere. After any merge/rebase, grep the module for a duplicated key
before trusting a green type-check.

### 4.6 Direction scoping — non-negotiable

Every read this change adds scopes `direction` explicitly. `ShipmentRepositoryPort`'s
order-scoped reads (`findByOrderId`, `findActiveByOrderId`, `findBranchOneByOrderAndConnection`)
already take `direction: ShipmentDirection` as a **required** parameter, so the compiler
enforces this for the existing seams. Any new read added here does the same.

Rationale (#2373 / ADR-060, and the #2645 cross-body defect Wave 2 caught only at
integration): a return label **is** a shipment and shares the table. A bridge that reads
lines or shipments without scoping direction reads an arriving return as a dispatch. The
`UQ_shipments_branch_one_per_order_conn` index carries `direction` as a **key column, not a
WHERE arm**, precisely so it admits one outbound + one return per `(order, connection)` while
refusing a second in either direction.

---

## 5. Migration

- **File**: `apps/api/src/migrations/1868000000000-add-shipment-fulfillment-work-id.ts`
- **Class**: `AddShipmentFulfillmentWorkId1868000000000` (prefix, class suffix and any
  `name` property move together).
- `up()`: `ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "fulfillmentWorkId" text` +
  `CREATE INDEX IF NOT EXISTS "IDX_shipments_fulfillmentWorkId" … WHERE "fulfillmentWorkId" IS NOT NULL`.
  `down()`: drop both, in reverse.
- **No default, no backfill.** `NULL` is the correct value for every existing row: those
  shipments genuinely satisfy no work.

> **RE-VERIFY THE TAIL IMMEDIATELY BEFORE PUSHING.** Current wave tail is
> `1867000000000` (#2399). `scripts/check-migration-timestamps.mjs` compares against
> `origin/main` only and **structurally cannot see a sibling branch in flight** — three
> branches collided on a slot in this wave, twice in a row. #2395 / #2401 may land a
> migration while this one is open. Re-run the tail check as the last step before `git push`,
> not at plan time.

### Migration-parity spec

`apps/api/test/integration/fulfillment-work-migration-parity.int-spec.ts` runs the FULL
migration chain and diffs named `TABLES` between migration-built and `synchronize`-built
schemas; the list drives a derived non-vacuity assertion, so a table costs one line.

**This migration ALTERs an existing table rather than creating one**, and `shipments` is
built by many older migrations. Adding `'shipments'` to `TABLES` therefore risks surfacing
**pre-existing legacy drift this issue neither caused nor can fix** — exactly what the
spec's own docblock warns about (*"a whole-schema diff would fail on pre-existing drift"*).

**Plan (revised by the readiness gate, F-3)**: the **targeted assertion is the deliverable** —
the new column's `data_type` / `is_nullable` and the new index's `indexdef`, compared across
both databases, in this same spec file. **13 migrations** touch `shipments`, and
`1862000000000-add-shipment-direction` adds a column default and drops it in the same
statement — exactly the shape that diverges between a migration-built and a
`synchronize`-built schema. Probing the whole-table diff is optional and time-boxed; if it
goes red on unrelated drift, record the drift as a finding and do **not** weaken or silence
the spec.

Empirical question; resolved by running it.

---

## 6. Test strategy — red-first, one guard at a time

Every guard below is verified by **making it fail first**, and the red is checked to be for
the RIGHT reason — a `TS6133` red with `Tests: 0 total` is a false pass (three agents hit
that in this programme).

| # | Guard | Test | How it is made to fail first |
|---|---|---|---|
| T1 | AC-1: no third creation site | Source-assertion spec counting `shipments.create(` call sites in `libs/core/src/shipping/**` and asserting the exact set of files | Add a throwaway third `create(` call → red; remove → green |
| T2 | AC-2: a 3PL `shipped` never writes a `providerShipmentId` | Unit spec on `createBranchOneShipment`: assert the `create` input has no `providerShipmentId` key **and** that the persisted row reads `null` | Stamp a provider id in the builder → red |
| T3 | AC-3: `resolve()` beats a work's processor hint | Unit spec: work carries a hint naming connection A; routing `resolve()` answers `omp_fulfilled`; assert **no** shipment is created and the hint is not consulted | Make the composer prefer the hint → red |
| T4 | Linkage lands on dispatch | Unit spec: `dispatch({…, fulfillmentWorkId})` → assert the **PERSISTED row** carries it (never the call argument — F-1's `buildOrmEntity` omission is invisible to an argument assertion) | Remove the field from `buildOrmEntity` → red |
| T5 | Linkage is never rewritten on retry | Unit spec: `priorBranchOne` exists with work W1; re-dispatch with W2; assert the row still reads W1 | Add the field to the update patch → red |
| T6 | Direction scoping | Unit spec: a `return` shipment for the same `(order, connection)` is not returned by the outbound-scoped read | Pass `'return'`/omit the arg → red (compiler-enforced today, asserted so it stays so) |
| T7 | Migration parity | The targeted column/index assertion above | Drop the index from the migration → red |
| T8 | The `shipment` intent is actually emitted | Unit spec: `record()` on a `shipped` event returns exactly one `{kind:'shipment'}` with the right `workId` | Do not emit it → red |
| T9 | A replay emits NO intent | Unit spec: the `duplicate` path returns an empty intent list | Emit unconditionally → red |

**T8/T9 exist because the compiler cannot help here (readiness gate F-4).**
`FulfillmentRelayIntent` has three references tree-wide and **nothing anywhere narrows on its
`.kind`**. The `never` exhaustiveness guard at `fulfillment-progress.service.ts:199-206`
protects the *event* union, not the intent union, and `noFallthroughCasesInSwitch` only catches
a missing `break`. So a new intent member compiles silently and **nothing would notice if it
were never emitted** — this programme's "check that cannot fail" class. T8/T9 are that check.

**No concurrency test is written for `fulfillmentWorkId`**, and that is a deliberate,
stated decision rather than an omission: the column is **not a claim**. It is written once,
inside the same statement that inserts the row, by the row's only creator. There is no
read-then-write window to serialise, so a concurrency test here could not distinguish the
defect from its absence — which the programme's own rule says makes it not evidence. The
guard that *does* need this discipline is #2400's progress claim, which already has it.

---

## 7. Documentation

- **`docs/architecture-overview.md:548`** — currently states the column is deferred to #2402
  as `shipment_lines.fulfillmentWorkId`. Rewrite to record that it landed on **`shipments`**,
  with D-1's reasoning in one sentence (1:N puts the FK on the many side; `shipment_lines` is
  a different concern with a different key and its own unmet obligations), plus a pointer to
  the separately-filed line-attribution issue. A doc describing a table that does not exist
  is how the next agent inherits the dead end this issue spent an hour clearing.
- Add the bridge to the § Shipment / § Fulfillment Authority narrative.

---

## 8. Deferred, with owners

| Deferred | Why | Owner |
|---|---|---|
| Automatic `shipped` → `dispatch()` on OL-executed work | D-2: needs an order→recipient/parcel projection that exists nowhere; wrong projection = parcel to the wrong address | **needs a new issue** — flag to coordinator |
| `shipment_lines` line attribution | D-1: different key, different motive, four unmet obligations | coordinator is filing |
| Consuming the `shipment` relay intent in the worker | intent is reported here; the relay composer is #2401's territory | #2401 — confirm boundary with coordinator |

---

## 9. Alignment checklist

- [x] Hexagonal layering respected; `fulfillment` stays a zero-sibling-edge leaf
- [x] Cross-context read via `I*Service`, never `*RepositoryPort`
- [x] Adds zero entries to `ZERO_SIBLING_EDGE_LEAVES` and zero to the cross-context `ALLOW_LIST`
- [x] No FK, per the cross-aggregate precedent; reasoning stated
- [x] Single narrow writer; column excluded from the update path
- [x] Every added read scopes `direction`
- [x] Idempotency inherited from #2400's claim; no second mechanism invented
- [x] Migration ordering re-verified at push time, not plan time
- [x] Red-first evidence per guard; no test that cannot fail
