# Implementation plan — `shipment_lines` (#2727)

Line-grain shipment records so shipped/delivered quantities are derivable.
Split out of #2402, which deliberately declined this table.

---

## 1. What #2402 settled, and what this does NOT reopen

#2402 put `fulfillmentWorkId` on **`shipments`**, not on lines, because the
work→shipment relation is **1:N** and the FK belongs on the many side. That
stands. This table expresses a **different** relation — one shipment carries
units from one or more order lines, possibly across more than one order — and
carries **no `fulfillmentWorkId` at all**.

That absence is the design, not an omission. See §7.

---

## 2. Schema

### 2.1 `shipment_lines`

| column | type | note |
|---|---|---|
| `id` | uuid PK (`PK_shipment_lines`) | plain uuid — never referenced from outside the aggregate (`return_lines` / `fulfillment_work_lines` precedent). The name goes on **`@PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: … })`**, not only in the migration: without it `synchronize` mints a hash name, the two schemas differ, and the parity spec's `stripPkName` carve-out swallows the difference so the PK name is never checked at all. |
| `shipmentId` | text | FK → `shipments(id)` ON DELETE CASCADE, **migration-only** |
| `orderId` | text | **load-bearing, see below** |
| `lineId` | text | the source-supplied `orderSnapshot.items[].id`. **A blank id is SKIPPED, never written.** `readItems` defaults a missing id to `''`, and two blank-id lines in one order would collide on the unique index and the second would vanish under `ON CONFLICT DO NOTHING` — a silently lost line. All four adapters supply a stable id (PrestaShop's `resolveOrderRowId` throws on a missing one), and `reservations.orderLineId` already keys on this exact value, so the guard is a floor rather than the expected path. |
| `productVariantId` | text NULL | by-value, no FK |
| `quantity` | int | units this shipment UNDERTAKES for this line |
| `shippedQuantity` | int default 0 | |
| `deliveredQuantity` | int default 0 | |
| `cancelledQuantity` | int default 0 | |
| `createdAt` / `updatedAt` | timestamptz | |

Indexes:
- `UQ_shipment_lines_shipment_order_line` UNIQUE `(shipmentId, orderId, lineId)` — the identity the issue names. Its leading column serves every `WHERE shipmentId = ?` read, so no second index on that column.
- `IDX_shipment_lines_order_line` `(orderId, lineId)` — the per-order derivation read.

CHECK `CHK_shipment_lines_capacity`:

```
"quantity" >= 0
AND "shippedQuantity" >= 0   AND "deliveredQuantity" >= 0 AND "cancelledQuantity" >= 0
AND "deliveredQuantity" <= "shippedQuantity"
AND "cancelledQuantity" <= "shippedQuantity"
```

Read the ordering as: you cannot deliver what you did not ship, and cannot
cancel more than you shipped. The last clause is what makes the **net** shipped
quantity (`shipped − cancelled`) non-negative by construction, which is the
number every derivation reads.

### Why `shippedQuantity <= quantity` is deliberately ABSENT

The obvious fourth clause is a trap, and tech review caught it. Two independent
paths violate it during ordinary operation:

1. **Re-ingestion rewrites `orderSnapshot` wholesale.** `quantity` is frozen at
   line creation (`ON CONFLICT DO NOTHING`), so a line created when the snapshot
   said 2 and re-ingested at 5 would emit a `ship(5)` act against `quantity = 2`.
2. **A dispatch retry reuses the same shipment row.** `ShipmentDispatchService`
   persists `failed` in its `generateLabel` catch and a retry re-enters on the
   same `shipment.id`, so `failed → generated → dispatched` is reachable on one
   row. A ship-then-cancel-then-reship line legitimately folds to
   `shipped = 4, cancelled = 2` on a line of `quantity = 2`.

Both would raise inside `reconcile`, be swallowed by §5's best-effort catch, and
leave the read model silently non-convergent for that order with a `warn` line
as the only signal. That is strictly worse than not having the clause.

`quantity` therefore records **what this shipment undertook as OL understood the
order at the time** — provenance, not a bound. The bound that matters (net
shipped ≥ 0) is `cancelledQuantity <= shippedQuantity`, which no path violates.

Twinned with the pure `checkShipmentLineCapacity`
(`domain/types/shipment-line.types.ts`) — one rule, two expressions, moved
together, exactly as `checkFulfillmentWorkLineCapacity` is twinned with
`CHK_fulfillment_work_lines_capacity`.

### 2.2 `shipment_line_events`

Append-only acts. The counters above are the **fold**; this table is
authoritative.

| column | type | note |
|---|---|---|
| `id` | uuid PK (`PK_shipment_line_events`) | |
| `shipmentLineId` | text | FK → `shipment_lines(id)` ON DELETE CASCADE, migration-only |
| `shipmentId` | text | denormalised, by-value, no FK — the per-shipment act read |
| `kind` | varchar(16) | `ship` \| `deliver` \| `cancel` |
| `quantity` | int | CHECK `> 0` (`CHK_shipment_line_events_quantity_positive`) |
| `occurredAt` | timestamptz | the shipment's own timestamp, never `new Date()` |
| `createdAt` | timestamptz | |

`UQ_shipment_line_events_line_kind_occurred` UNIQUE
`(shipmentLineId, kind, occurredAt)`.

**`occurredAt` is IN the key, and that is what makes a reused shipment row
correct.** The first draft keyed `(line, kind)` on the reasoning that "a
shipment ships once". Tech review showed that is false:
`ShipmentDispatchService` reuses the same row across retries, so
`failed → generated → dispatched` is reachable and a line that emitted
`ship` + `cancel` could never record its successful re-dispatch — folding to a
net shipped of 0 for a parcel that really shipped, permanently.

With `occurredAt` in the key:
- a repeated `reconcile` over an unchanged shipment re-derives the identical
  `(kind, occurredAt)` and inserts nothing — idempotent under a bare
  `ON CONFLICT DO NOTHING`, no sequence counter to allocate and therefore no
  lock to take (which is what the returns `(line, seq)` key would have needed);
- a genuine re-dispatch carries a NEW `dispatchedAt` and correctly emits a
  second `ship` act.

`occurredAt` is the shipment's own `dispatchedAt` / `deliveredAt` /
`cancelledAt`-or-`failedAt` — OL's clock is not a witness to a carrier's act
(#2336 / #2367 / #2371). When the shipment carries no timestamp for the
transition it falls back to **`createdAt`, never `updatedAt`**: `updatedAt`
moves on every write, so using it as a key component would mint a fresh
duplicate act on every recompute.

---

## 3. Why `orderId` stays on the line

It is **not** redundant with `shipments.orderId`.

`shipments.orderId` is the order the shipment was *dispatched for* — the one the
recipient address came from, the one the per-order dispatch lock is keyed on. A
**consolidated** parcel carries units from more than one order, and that is the
case `DECISION-oms-fulfilment-grain` option C exists to keep expressible.

If the line derived its order from its shipment header, a line belonging to
order B inside a parcel headed by order A would be **unrepresentable**: order B's
derived shipped quantity would be permanently zero and nothing would say so.

Today every writer sets `line.orderId = shipment.orderId`. The column is what
lets that stop being true without a migration.

---

## 4. The backfill, and why event-shaped

### The defect a snapshot backfill has

Order O, line L, quantity 2. `S1` dispatched, then cancelled; `S2` the re-issue,
dispatched.

- **Snapshot backfill**: writes `S1.shipped = 2` and `S2.shipped = 2`. Order-level
  shipped = **4**. Permanently wrong, and unfixable, because both rows claim to
  be shipments of the same units and nothing distinguishes a correction from a
  second shipment.
- **Event backfill**: `S1` emits `ship(2)` then `cancel(2)` → net 0. `S2` emits
  `ship(2)` → net 2. Order-level net = **2**. Correct.

The `cancel` act is precisely the thing that "distinguishes a correction from a
second shipment", and it exists only because the backfill walks each shipment's
history rather than restating its end state.

### Shape

Two migrations in the claimed `1874…` block:

- `1874000000000-create-shipment-lines.ts` — both tables, both CHECKs, all
  indexes, both CASCADE FKs.
- `1874000001000-backfill-shipment-lines.ts` — the population, in SQL.

Per outbound shipment, joined to its order's `orderSnapshot.items` via
`jsonb_array_elements`:

1. insert one `shipment_lines` row per item with `quantity = item.quantity`;
2. emit `ship(quantity)` when `dispatchedAt IS NOT NULL` **or** status ∈
   `dispatched | in-transit | delivered`;
3. emit `deliver(quantity)` when `deliveredAt IS NOT NULL` or status
   `delivered`;
4. emit `cancel(quantity)` when status ∈ `cancelled | failed` **and** a `ship`
   act was emitted (a shipment cancelled at `draft` never shipped, so there is
   nothing to reverse and no act is written — which is what keeps
   `cancelledQuantity <= shippedQuantity` true);
5. fold the acts into the counters.

**Lossy, and named as such**: attributing each shipment the line's FULL ordered
quantity is a guess for a genuinely multi-package order — OL never recorded the
split. What the event shape guarantees is not that history is exact, but that a
later cancel-and-reissue **does not compound** the error.

### The proof

`apps/api/test/integration/shipment-lines-backfill.int-spec.ts` seeds a
cancel-and-reissue order, runs the real migration, and asserts the net is `2`.
A red-first run against a snapshot-shaped backfill (asserted in the same file by
computing the snapshot sum alongside) yields `4` — the test fails against a
snapshot backfill, as the AC requires.

---

## 5. The runtime writer — ONE seam

`OrderFulfillmentProjectionService.recompute(orderId)` is already called from
all eight shipment-mutation sites (dispatch ×3, cancellation, status sync ×2,
branch-1 poll ×2). It is the single seam, so no mutation service changes.

**It is not unconditional, and the plan does not pretend otherwise.** Three of
those sites sit behind a `if (patch.status)` changed-patch gate
(`shipment-status-sync.service.ts:168,227`, `fulfillment-status-sync.service.ts:368`).
Benign for act emission — no status change means no new act — but it does mean a
tracking-only backfill (#1947) or a `labelPdfRef` write will not create missing
line rows. This is the *same* changed-patch gate that produced #2402's
permanently-unlinkable row, so it is recorded rather than asserted away. The
dispatch path, which is where a line first needs to exist, always calls
`recompute`.

`recompute` gains a step before the rollup:
`IShipmentLineService.reconcile(orderId, shipments)`.

**It takes the shipments `recompute` has ALREADY loaded**, rather than re-reading
them. That is not tidiness: `recompute` is called once per shipment inside the
two sync loops, so a `reconcile(orderId)` that re-read the order's shipments
would be `O(S² × I)` upserts for a page touching `S` shipments of one order.
Passing the loaded array makes it `O(S × I)` and removes a redundant query
(pre-implement finding 5).

1. read the order's snapshot items once, through the orders context's OWN
   exported projection (`orderFromReadySnapshot`, on the `@openlinker/core/orders`
   barrel) rather than growing a second parser of an orders-owned jsonb document
   in `shipping`. The read is `IOrderRecordService.getOrderRecord`, already
   injected — an existing `shipping → orders` `I*Service` edge, so no new
   cross-context edge;
2. upsert one `shipment_lines` row per `(shipment, orderId, lineId)`
   (`ON CONFLICT DO NOTHING` — `quantity` is never rewritten, so a later order
   edit cannot retroactively restate what a shipped parcel undertook);
3. `INSERT … ON CONFLICT DO NOTHING` the acts implied by each shipment's current
   status and timestamps;
4. **recompute** each touched line's counters from its acts (a total fold, not an
   increment — the ledger is authoritative and the counter is a denormalisation,
   the `reservations` / `olReservedQuantity` shape).

Because step 4 is a total fold, the runtime path is **convergent over whatever
the migration wrote**: if the SQL backfill and the service ever disagreed on the
acts, the next recompute adds the missing ones and the counters follow. That is
the ledger property doing the work a duplicated implementation would otherwise
have to do by hand.

It is best-effort inside `recompute`'s existing try/catch — the rollup is
explicitly "a denormalized read-optimisation, never a source of truth", and a
line-write failure must not fail the shipment operation that triggered it.

---

## 6. The rollup precedence fix

Current rule: `if (statuses.includes('delivered')) return 'delivered'` — so an
order with one delivered parcel and one still in transit reports **delivered**.

New precedence:

```
no shipments                                   -> not-shipped
any in-progress (generated|dispatched|in-transit) -> dispatched   // NEW: outranks delivered
any delivered:
    coverage supplied and delivered < ordered  -> dispatched      // NEW
    else                                       -> delivered
all terminal failure                           -> failed
else                                           -> not-shipped
```

Two independent refinements, deliberately separable:

- **The status half** needs no line data and fixes the shipment-grain case on
  every install, including one that never runs the backfill.
- **The quantity half** takes an OPTIONAL `FulfillmentQuantityCoverage
  { ordered, delivered }`. Absent means "no line data" — pre-backfill rows, or a
  shipment whose order snapshot carried no items — and the function must still
  answer for those, which is why it is optional rather than required.

#### Why the coverage half is sound despite a lossy numerator

Tech review raised that §4 attributes each shipment of a line the line's FULL
quantity, so a two-package line of quantity 2 shows `delivered = 2` once ONE
package arrives — and asked whether the coverage arm therefore reintroduces the
very defect it fixes.

It does not, and the reason is worth stating because it is what bounds the arm:

- **The arm only ever DEMOTES.** `delivered < ordered → dispatched`; there is no
  branch that promotes anything to `delivered`.
- **Over-attribution can only make the numerator too LARGE.** So
  `delivered < ordered` remains a *sound proof* of undercoverage — if an
  over-estimate is still short, the truth is shorter. A false demotion is
  therefore impossible; only a missed one.
- Per line the numerator is clamped to that line's ordered quantity
  (`LEAST(Σ net delivered, ordered)`) before summing, which can never drop below
  the true count and strictly improves precision.

Its **known blind spot** is exactly the case review named — a partially
delivered multi-package line, where the over-count hides the shortfall. That
case is caught by the status half instead, because the sibling package is still
in progress. The two halves cover different failures, which is why both ship.

What the arm genuinely catches and the status half cannot: an order whose
shipments are all terminal but which only ever put SOME of its lines in a
parcel. Status says `delivered`; coverage says `1 of 3` and demotes.

**`dispatched` is the honest approximation, and the vocabulary is why.**
`FulfillmentRollupState` has exactly four values and no `partial`. Between
`delivered` (a lie about a partly-delivered order) and `dispatched` (imprecise
but keeps the order in the operator's unfinished set), `dispatched` is the safe
direction. A fifth value is a separately-owned change: it would need the orders
SQL filter/summary twins, the FE `deriveFulfillment`, and every label map. Named
here rather than smuggled in.

**Twins updated in the same commit:**
- `FulfillmentRollupStateValues`' precedence docblock (`orders`), which states
  the old rule verbatim.
- The FE `deriveFulfillment` (`apps/web/.../order-health.ts`) — the **status
  half only**. The coverage half is BE-only because the FE has no quantity
  input; stated in its docblock so the twin's asymmetry is deliberate.

Both existing specs encode the defect (`['failed','delivered','dispatched'] →
'delivered'` BE; `['dispatched','delivered'] → 'delivered'` FE) and are updated
with a comment naming #2727.

### Blast radius — nothing needs a code change, but the reading moves

Nothing re-derives this precedence in SQL: every consumer reads the STORED
`order_records.fulfillmentState`. So no consumer changes. What DOES change is
what an operator sees, and that is bigger than "a rollup badge":

| Consumer | Effect |
|---|---|
| `deriveOrderLifecyclePhase` (`order-lifecycle`) — production caller in `orders.controller.ts` | maps `delivered → 'delivered'`, `dispatched → 'in_transit'`. A partly-delivered order's **order-detail lifecycle panel flips Delivered → In transit**. |
| That phase's SQL twin (`LIFECYCLE_FULFILLMENT` + per-phase `CASE`, #2309/ADR-059) and `check-order-lifecycle-phase-mirror.mjs` (#2311) | read the stored column; no edit, but the bucket an order lands in moves. |
| `FULFILLMENT_ORDINAL` | `dispatched → 2`, `delivered → 3`, so the order drops one rank and re-sorts on `/orders`. |
| `phaseToOrderStatus` (one-way writeback projection) | **no production caller today**, so marketplace writeback is unaffected. Latent, not absent — recorded so it is not rediscovered. |
| `order-sla.ts` | treats `dispatched` and `delivered` identically. Genuinely unaffected — stated positively. |

Every one of these is the *intended* consequence of no longer calling a
partly-delivered order delivered. Named here rather than discovered by an
operator, and `order-lifecycle-phase.int-spec.ts` is checked for fixtures that
encode the old precedence.

---

## 7. Direction, and the #2402 unlinkable-branch-1 gap

**Direction** is scoped by JOIN, not by a denormalised column. Every read joins
`shipments` and filters `s.direction = :direction`, with `direction` a REQUIRED
parameter carrying no default — the `ShipmentRepositoryPort` rule verbatim ("a
default is a silent decline"). Copying `direction` onto the line would create a
second source of truth for the one column #2373 exists to be.

**The #2402 gap does not become reachable here, and that is a choice.** #2402
left a branch-1 shipment that reaches terminal status before its order is routed
permanently unlinkable, because `claimFulfillmentWorkLink`'s repair sits inside
a changed-patch gate. This read model keys on `(shipmentId, orderId, lineId)`
and joins on `orderId` — it never consults `fulfillmentWorkId`, so an unlinked
shipment contributes its quantities exactly like a linked one. Keying the
derivation on the work instead would have inherited the gap wholesale: every
such shipment would silently contribute zero. The gap remains open and remains
#2402's; it is out of this rollup's path by construction, not by luck.

**One shipped comment must be amended in the same commit.**
`fulfillment-status-sync.service.ts`'s `linkFulfillmentWork` comment currently
says the unlinkable row is *"free today — nothing reads the column — but #2727's
rollup will, and whoever wires it needs a backfill rather than a surprise."*
#2727 declines to read the column, so left alone that comment becomes a false
pointer to a closed issue and sends the next reader looking for a backfill that
was deliberately not written. It is rewritten to record that #2727 keyed on
`orderId` and the gap is unclaimed again.

---

## 8. Scope boundary — the FE line panel

Obligation 4 of the issue ("an FE line panel") is **not** in this slice, and is
not one of the six acceptance criteria. What this slice does deliver is a real
reader: the rollup consumes the derived coverage on every recompute, so the read
model is not written-and-never-read. The operator-facing panel needs a read API
and a component and is a clean follow-up; stated rather than quietly dropped.

---

## 9. Files

**New**
- `libs/core/src/shipping/domain/types/shipment-line.types.ts` — `ShipmentLineActKind`, `ShipmentLine`, `ShipmentLineAct`, `checkShipmentLineCapacity`, `netShippedQuantity`, `FulfillmentQuantityCoverage`
- `libs/core/src/shipping/domain/ports/shipment-line-repository.port.ts`
- `libs/core/src/shipping/application/interfaces/shipment-line.service.interface.ts`
- `libs/core/src/shipping/application/services/shipment-line.service.ts` (+ spec)
- `libs/core/src/shipping/infrastructure/persistence/entities/shipment-line.orm-entity.ts`
- `libs/core/src/shipping/infrastructure/persistence/entities/shipment-line-event.orm-entity.ts`
- `libs/core/src/shipping/infrastructure/persistence/repositories/shipment-line.repository.ts`
- `apps/api/src/migrations/1874000000000-create-shipment-lines.ts`
- `apps/api/src/migrations/1874000001000-backfill-shipment-lines.ts`
- `apps/api/test/integration/shipment-lines-backfill.int-spec.ts`

**Changed**
- `fulfillment-rollup.ts` (+ spec) — precedence
- `order-fulfillment-projection.service.ts` — reconcile then roll up
- `orders/domain/types/order-fulfillment.types.ts` — precedence docblock
- `apps/web/src/features/orders/lib/order-health.ts` (+ test) — FE twin
- `shipping/index.ts`, `shipping.tokens.ts`
- `shipping.module.ts` — **`TypeOrmModule.forFeature` must gain BOTH new entities**, plus the provider/token/export wiring
- `apps/api/test/integration/setup.ts` — **the truncate list, not entity registration.** `synchronize` builds no FKs at all, so the CASCADE-closure walk cannot reach either child from `shipments`. Both children are listed explicitly, before `'shipments'`. Omitting this is exactly how `fulfillment_work_verifications` was found the hard way.
- `apps/api/test/integration/fulfillment-work-migration-parity.int-spec.ts` — add both tables to `TABLES`

**Deliberately NOT changed**: `apps/api/src/database/data-source.ts` globs
`libs/core/src/**/*.orm-entity{.ts,.js}`, which both new filenames match.

---

## 10. Risks

1. **Migration/`synchronize` divergence.** Every index and CHECK is declared
   class-level under the migration's exact name, and both tables join the parity
   spec — the only automated check of a migration in this repository.
2. **Backfill cost.** `shipments` has no retention anywhere in the tree, so a
   single unbounded statement over `shipments ⋈ order_records` with
   `jsonb_array_elements` is a long write inside one migration transaction on a
   mature install. The backfill therefore runs as a **batched loop over shipment
   id pages**, not one statement.
3. **`recompute` is on a hot path.** The added work is two indexed writes per
   shipment per recompute, all `ON CONFLICT DO NOTHING`, inside the existing
   best-effort catch.


---

## 11. Deviations from this plan, as shipped

Recorded rather than silently absorbed.

1. **No `shipment-line.entity.ts`.** §9 listed one. It was never written and is
   not needed: `ShipmentLine` is a readonly interface in `shipment-line.types.ts`
   and the entity would have carried no behaviour, which the ADR-011
   anemic-by-default policy makes an empty file rather than a domain object. The
   repository maps ORM → that interface directly.

2. **The backfill's `cancel` predicate was simplified.** It carried a status
   disjunct that can never hold for a row whose status is already `cancelled` or
   `failed` — dead code that read as a narrowing of the ship condition when it
   was in fact identical to it. Now `dispatchedAt IS NOT NULL` alone, with the
   equivalence argued in place so nobody "fixes" one side.

3. **The backfill `down()` docblock was corrected.** It claimed to delete "only
   what this pass could have written"; it is a bare `DELETE` and cannot tell a
   backfilled row from a runtime-reconciled one. The docblock now says so, and
   says why it is acceptable (the whole model is derived — the next `recompute`
   rebuilds it from the shipments, which are untouched).

4. **The parity spec asserts an ABSENCE as well as presences.** Beyond adding
   both tables to `TABLES` and both FKs to `EXPECTED_DELETE_RULE`, it asserts
   `CHK_shipment_lines_capacity` does **not** contain
   `"shippedQuantity" <= "quantity"`. Every other clause assertion stops the
   constraint being weakened; only a negative one stops it being *completed*,
   which is the direction that actually breaks ordinary operation here.

5. **`docs/architecture-overview.md` gains § 27 Shipment lines**, and #2402's
   bullet's forward reference ("tracked as **#2727**") is updated to point at it
   rather than left describing the work as unstarted. §9 did not list either
   edit; the repo documents every slice, and a forward reference left claiming
   an issue is open is a false statement about the tree.

6. **The FE twin is asymmetric, and its docblock now says so** rather than
   leaving a future reader to "restore" a coverage arm the browser has no input
   for.

## 12. Left undone, with reasons

- **The FE line panel** (issue obligation 4) — not one of the six acceptance
  criteria, and it needs a read API plus a component. The read model is not
  written-and-never-read regardless: the rollup consumes the derived coverage on
  every recompute.
- **The #2402 unlinkable branch-1 gap** stays open and stays #2402's. This
  slice keys on `(shipmentId, orderId, lineId)` and joins on `orderId`, never
  consulting `fulfillmentWorkId`, so an unlinked shipment contributes its
  quantities exactly like a linked one — the gap is out of this rollup's path by
  construction rather than by luck.
- **`fulfillment_work_rejections` is missing from the integration truncate
  list** — a pre-existing gap noticed while adding the two shipment-line tables
  beside it. Not fixed here: it belongs to #2399 and touching it would put an
  unrelated behaviour change in this diff.
- **No `partial` rollup value.** `dispatched` is the honest approximation for a
  partly-delivered order; a fifth value would need the orders SQL twins, the FE
  `deriveFulfillment` and every label map.

## 13. What the integration run found (three real defects)

The draft type-checked, linted and passed every unit test while carrying three
defects that only the real migration chain could expose. Recorded because each
is a class, not an incident — all three are in `docs/lessons.md`.

1. **`FK_shipment_line_events_line` was unimplementable.** `shipmentLineId` was
   `text`; `shipment_lines.id` is a generated `uuid`, and Postgres refuses an FK
   across mismatched types outright. The sibling `shipment_lines.shipmentId` IS
   correctly `text` (because `shipments.id` is an `ol_shipment_*` internal id),
   which is exactly why the wrong type looked right. The harness builds schema by
   `synchronize`, which creates no FKs at all — so *only* the parity spec could
   have caught this.

2. **The backfill spec's seed violated `UQ_shipments_branch_one_per_order_conn`.**
   It left `providerShipmentId` NULL on every seeded shipment, which claims the
   row is the branch-1 observed projection — and there can only be one per
   `(order, connection, direction)`. The index was right; the fixture modelled
   the wrong thing. A cancel-and-reissue is two real dispatched labels.

3. **The new negative parity assertion could not fail.**
   `not.toContain('"shippedQuantity" <= "quantity"')` names a string
   `pg_get_constraintdef` never emits, because it renders lowercase identifiers
   unquoted. The guard protecting the deliberate omission — the whole reason the
   assertion exists — would have passed with the forbidden clause present. The
   positive assertion for the same column failed loudly and got fixed; the
   negative one would have stayed green forever.

Verified after the fixes: `fulfillment-work-migration-parity.int-spec.ts` 9/9,
`shipment-lines-backfill.int-spec.ts` 7/7.
