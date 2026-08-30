# Implementation Plan: `fulfillment_works` / `_lines` / `_holds` schema + writer-disciplined repository

**Issue**: #2392 (`W3a-3`) — Wave 3a epic #2412, stream S1, size L
**Date**: 2026-08-30
**Status**: Ready for Review
**Base branch**: `oms-programme-wave-3a` (NOT `main`)
**Estimated Effort**: 1.5–2 days

> **Critical path.** #2395, #2396, #2399, #2400, #2406 and #2410 all sit behind this issue.

---

## 1. Task Summary

**Objective**: persist the `FulfillmentWork` vocabulary #2391 shipped. Three tables
(`fulfillment_works`, `fulfillment_work_lines`, `fulfillment_holds`), one migration, and a
`FulfillmentWorkRepository` whose every axis transition is a narrow conditional UPDATE with a named
owner — the §6.3 house discipline applied to what REVIEW C10 calls a **five-writer table**.

**Context**: `fulfillment_works` is written by the router (#2395), the executor handshake (#2399),
progress ingress (#2400), operator actions (#2406/#2410) and sweeps. Without per-column ownership
that repeats the `order_records` multi-writer problem at a hotter grain; without a counter `CHECK`,
"3 of 5 shipped" can silently become "6 of 5".

**Classification**: CORE / Infrastructure (persistence) + a migration in `apps/api`.

---

## 2. Scope & Non-Goals

### In scope

- Three ORM entities + the `orm-entities` sub-barrel + the `libs/core/package.json` exports entry.
- `FulfillmentWorkRepositoryPort` (domain/ports) + domain errors.
- `FulfillmentWorkRepository` with a per-column writer table in its file header.
- `FulfillmentModule` + `FULFILLMENT_WORK_REPOSITORY_TOKEN` (replacing the `export {}` placeholder).
- Migration `1864000000000-create-fulfillment-works.ts`.
- App wiring (`apps/api`, `apps/worker`) + `tablesToTruncate`.
- The `barrel-purity.spec.ts` allow-set line for `HoldReason` (see § 5, D-1).
- Replacing the armed arm of `fulfillment-no-injection-boot.int-spec.ts` with a real provider-graph
  assertion (see § 5, D-6).
- Unit specs + two int-specs (the DB-level `CHECK`; stale-precondition conditional UPDATEs).
- `docs/architecture-overview.md` § 26 update.

### Out of scope — columns I CREATE whose WRITERS land later

This is the single most misreadable part of the slice, so it is tabulated rather than described.

| Column | Created here | Written by |
|---|---|---|
| `assignmentAttempt` | yes, `int NOT NULL DEFAULT 0` | #2399 (router-driven re-request) |
| `dispatchRelayedAt` | yes, nullable | #2401 (`W3a-12`, the relay claim) |
| `version` | yes, `int NOT NULL DEFAULT 0` | #2406 (optimistic-concurrency token) |
| `cancelledAt` | yes, nullable | this slice's `cancel` transition |
| `routingDecisionId` | **NO** — not mine | #2394/#2395 own it |
| `acceptedAt` | **NO** — not mine | #2399 (ADR-054's conditional claim) |
| `rejectionReason` / `blocking` | **NO** — not mine | #2399 (DESIGN §5.4) |

**The discriminant, stated so it is not arbitrary**: a column is created here iff it appears in
**#2392's own enumerated column list** *or* is a field #2391 declared on the `FulfillmentWork` /
`FulfillmentWorkLine` interfaces. `assignmentAttempt` qualifies on both counts (the issue lists it,
and `fulfillment-work.types.ts:135` declares it — its own docblock notes it "has no writer in this
slice, which is the asymmetry with the deferred `sku`"). `acceptedAt` and the rejection pair qualify
on neither, and ADR-054 says explicitly that "the claim column and its at-most-once semantics land
with #2399". Recorded here so #2399 knows it owns a second `ALTER TABLE` rather than discovering it.

Also out of scope: `supportedActions` computation (#2406 — deliberately not a field, see ADR-054);
the A2/A3 authority resolution services ADR-053 places in this context; any HTTP surface; any job
type; any consumer of the repository at all.

### Constraints

- The base branch is `oms-programme-wave-3a`. `origin/main`'s migration tail is `1849000000003`;
  this branch carries 20 more, to `1863000000000`.
- ADR-053's no-injection invariant is binding on everything under `libs/core/src/fulfillment/`.
- `libs/core/src/__tests__/barrel-purity.spec.ts` registers `fulfillment` as a zero-sibling-edge
  leaf. Adding a NestJS module does **not** break that (see § 5, D-2).

---

## 3. Architecture Mapping

**Target layer**: CORE — `libs/core/src/fulfillment/{domain/ports,infrastructure/persistence}` —
plus one migration in `apps/api/src/migrations/` and module registration in both host apps.

**Why CORE and not an integration**: a `FulfillmentWork` is OL's own aggregate. Nothing about it is
platform-specific; ADR-054 makes it the unit of assignment precisely because OL cannot split a
commercial order (`identifier_mappings` is a bijection per connection, ADR-044). No adapter is
resolved anywhere in this slice.

**Capabilities involved**: none. This slice resolves no `getCapabilityAdapter`, constructs no
adapter, and makes no outbound call.

**Existing patterns reused** (all verified in-tree on this branch):

| Concern | Precedent |
|---|---|
| Conditional UPDATE → `affected > 0` | `ShipmentRepository.claimWaybillRelay` |
| Two-cause zero-row disambiguation | `OrderHoldRepository.releaseHeld` |
| Parent + children in ONE transaction | `ReturnRepository.create` |
| Named class-level `@Check` | `ReturnLineOrmEntity`, `ReservationOrmEntity` |
| `QueryFailedError` → domain error | `ReturnPersistenceError`, `OrderHoldRepository` `23505` |
| `toOrm` exclusion + writer table | `OrderRecordRepository.toOrm` |
| Migration narrative shape | `1849000000011-create-order-holds.ts` |
| `orm-entities` sub-barrel | `libs/core/src/returns/orm-entities.ts` |

---

## 4. Schema

Derived from #2392's column list, ADR-054, and DESIGN §5.2. Vocabulary columns are `varchar`
with the ORM property typed `string` — **no PG enum anywhere** (zero `CREATE TYPE ... AS ENUM` in
`apps/api/src/migrations/`; the house convention is that the union is enforced in TypeScript so
widening never needs an `ALTER TYPE`), narrowed on read by the `is*` guards #2391 shipped.

### `fulfillment_works`

| Column | Type | Null | Note |
|---|---|---|---|
| `id` | `text` | no | PK, `ol_fulfillmentwork_*` via `formatInternalId` |
| `orderId` | `text` | no | by-value, **no FK** (see § 5, D-4) |
| `locationId` | `text` | **yes** | `null` = not yet assigned, never "no location applies" |
| `deliveryMethod` | `text` | **yes** | opaque grouping key; `null` = not yet resolved. `text`, not `varchar(N)` — the key is adapter-supplied and opaque, so any length cap is a guess that fails at insert |
| `assignedConnectionId` | `uuid` | yes | the holder; `null` before assignment and after rejection |
| `status` | `varchar(32)` | no | default `'open'` |
| `requestStatus` | `varchar(32)` | no | default `'unsubmitted'` |
| `assignmentAttempt` | `integer` | no | default `0`; written by #2399 |
| `cancellationReason` | `varchar(64)` | yes | required when `status = 'cancelled'` |
| `cancelledAt` | `timestamptz` | yes | |
| `dispatchRelayedAt` | `timestamptz` | yes | claimed by #2401 |
| `version` | `integer` | no | default `0`; consumed by #2406 |
| `createdAt` / `updatedAt` | `timestamptz` | no | `now()` |

Indexes:

- `IDX_fulfillment_works_grouping` on `(orderId, locationId, deliveryMethod)` — its **leading column
  serves every `WHERE orderId = ?` lookup**, so there is deliberately no separate `(orderId)` index.
  (The first draft created both; the identical argument this plan makes against a redundant
  `fulfillment_work_lines(fulfillmentWorkId)` index kills it.)
- `IDX_fulfillment_works_assigned_open` on `(assignedConnectionId, status)` partial
  `WHERE "assignedConnectionId" IS NOT NULL` — the executor worklist read.
- `IDX_fulfillment_works_request_status` on `(requestStatus, updatedAt)` — ADR-054 requires
  **timeout-as-rejection by sweep**, which scans `requestStatus = 'submitted' AND updatedAt < ?`
  across all connections. Without it that sweep seq-scans the table forever. Created here even
  though #2399 owns the sweep, because an index is cheap now and a second migration is not.

**No unique index on the grouping key.** A work is *created* by the router in one transaction with
its routing decision (#2395); re-routing legitimately produces a second work for the same
`(order, location, method)` after the first is `cancelled`, so a total unique index would make
re-routing impossible and a partial one would need a predicate over the seven-value execution axis
that #2395 has not yet fixed. Idempotency of creation is #2395's to define, and it must not be
pre-empted here by an index that is wrong in a way only discoverable months later.

### `fulfillment_work_lines`

| Column | Type | Null | Note |
|---|---|---|---|
| `id` | `uuid` | no | PK `uuid_generate_v4()` — never referenced from outside the aggregate |
| `fulfillmentWorkId` | `text` | no | **FK → `fulfillment_works(id) ON DELETE CASCADE`** |
| `orderLineId` | `text` | no | by-value INTO the order snapshot's jsonb; **un-FK-able** |
| `productVariantId` | `text` | no | by-value, no FK |
| `totalQuantity` | `integer` | no | |
| `fulfilledQuantity` | `integer` | no | default `0` |
| `cancelledQuantity` | `integer` | no | default `0` |
| `createdAt` / `updatedAt` | `timestamptz` | no | |

```
CONSTRAINT "CHK_fulfillment_work_lines_capacity" CHECK (
  "totalQuantity" >= 0 AND "fulfilledQuantity" >= 0 AND "cancelledQuantity" >= 0
  AND "fulfilledQuantity" + "cancelledQuantity" <= "totalQuantity"
)
```

Unique: `UQ_fulfillment_work_lines_work_order_line` on `(fulfillmentWorkId, orderLineId)` — one
line's participation in one work is singular by definition, and it is the update key. Its leading
column serves every `WHERE fulfillmentWorkId = ?` lookup and the FK's referential check, so **no
separate index on `fulfillmentWorkId`** (the `return_lines` precedent).

### `fulfillment_holds`

| Column | Type | Null | Note |
|---|---|---|---|
| `id` | `uuid` | no | PK `uuid_generate_v4()` |
| `fulfillmentWorkId` | `text` | no | **FK → `fulfillment_works(id) ON DELETE CASCADE`** |
| `reason` | `varchar(64)` | no | `HoldReason` (see § 5, D-1) |
| `note` | `text` | yes | |
| `placedByUserId` / `placedByService` | `text` | yes | XOR-constrained |
| `placedAt` | `timestamptz` | no | |
| `releasedAt` | `timestamptz` | yes | |
| `releasedByUserId` | `text` | yes | |
| `releaseNote` | `text` | yes | |
| `createdAt` / `updatedAt` | `timestamptz` | no | |

```
CONSTRAINT "CHK_fulfillment_holds_actor" CHECK (
  ("placedByUserId" IS NOT NULL) <> ("placedByService" IS NOT NULL)
)
```

Index: `IDX_fulfillment_holds_work_active` on `(fulfillmentWorkId)` partial
`WHERE "releasedAt" IS NULL` — serves the active-hold read and the ≤10 cap count.

**No `UQ ... WHERE releasedAt IS NULL`**, unlike `order_holds`: DESIGN §6.3 states the ≤10 stacking
allowance is *at the fulfilment grain*, so at-most-one is the wrong rule here. See § 5, D-3 for why
the cap is not a DB constraint either.

---

## 5. Decisions

### D-1 — `HoldReason` needs a SECOND `authorizedTypeOnlySpecifiers` entry. **Flagged.**

`fulfillment_holds.reason` is specified as `HoldReason`, which lives in
`@openlinker/core/order-lifecycle`. `fulfillment`'s allow-set in `barrel-purity.spec.ts` currently
holds exactly one entry.

**Register it, type-only.** It satisfies both conditions that table's docblock names — the import
erases at build time, and the target is itself a registered zero-sibling-edge leaf exporting no
NestJS module — and `architecture-overview.md` § 26 already anticipates it verbatim: *"`HoldReason`
is NOT imported: holds are first-class rows landing with #2392, and design adjudication #4 keeps
that one vocabulary in `order-lifecycle` for both hold grains."* Restating the eight strings locally
is the duplication ADR-053 § Alternatives rejects by name, and `automation` already takes the same
edge (a **value** edge, so this type-only one is strictly weaker).

**This authorization expires if `order-lifecycle` gains a NestJS module.** Condition 2 of the
allow-set docblock is that the target is itself a registered zero-sibling-edge leaf exporting no
module — true today (that barrel states "No NestJS module, no service, no repository, no tokens
file"), and its own docblock says that ends the day the concern needs a binding. Recorded so the
re-derivation is a decision rather than an omission.

**But the GUARD does not come with the type, and that changes how the column is read back.**
`automation` narrows via `isHoldReason` — a **value** import
(`automation-condition.types.ts:37-38`). It may do that because it is not a registered leaf.
`fulfillment` is, and `barrel-purity.spec.ts` rejects a sibling value import *unconditionally,
regardless of the allow-set*:

```ts
expect(typeOnly ? located : `FORBIDDEN VALUE IMPORT — ${located}`).toBe(located);
```

So the house rule *"narrow-or-fallback on read, never a blind cast"* **cannot be followed here**:
importing the guard costs the leaf property, and restating the union locally is what ADR-053
§ Alternatives rejects by name. `reason` is therefore **cast at the boundary** in `toDomain`,
following the in-tree `ReturnLine` precedent — `entity.custodyState as ReturnCustodyState`,
`moneyState`, `disposition` all do exactly this, and only that entity's `reason` gets the narrower
treatment. The constraint is recorded in the repository docblock so the cast reads as a decision
rather than an oversight.

Two mechanical corollaries: use the `import type { … }` **statement** form (an inline
`import { type X }` is classified as a VALUE import by that walker), and the write path stays
strongly typed — the port accepts `HoldReason`, so every row this context writes is valid by
construction and the cast only widens rows read back.

### D-1b — three persisted columns are ADDED to the `FulfillmentWork` interface

`version`, `cancelledAt` and `dispatchRelayedAt` are **not** fields on the interface #2391 shipped,
so `toDomain` could not surface them. Two of those are unacceptable as-is: `cancelledAt` is written
by *this slice's own* `cancel` and would be unobservable, and `version` must reach an HTTP caller for
DESIGN §5.2's 409 contract, which is #2406's whole mechanism.

**Resolution**: widen `FulfillmentWork` with `readonly version: number`,
`readonly cancelledAt: Date | null`, `readonly dispatchRelayedAt: Date | null`. This is an
**additive** change to a shipped public barrel and is zero-risk today — #2391 deliberately shipped
the vocabulary ahead of its consumers, so nothing in the tree constructs or reads a
`FulfillmentWork` yet. Deferring it would mean #2406 amending the barrel *and* a second migration
review; doing it in the slice that persists the columns keeps one decision in one place. The types
file records each field's writer, matching the existing `assignmentAttempt` docblock convention.

### D-2 — a `FulfillmentModule` does not cost the leaf property

The property is *zero outbound `@openlinker/core/*` value edges*, not framework-freedom —
`architecture-overview.md` says so explicitly, and #2170 is the proof they are separable.
`sales-documents` is a registered leaf that exports `SalesDocumentsModule` from its own barrel. The
leaf stays OFF the aggregating `libs/core/src/index.ts`, unchanged.

### D-3 — the ≤10 active-holds cap is REPOSITORY-level, not a DB constraint

A partial unique index gives N=1 only. N>1 needs a trigger; there is no trigger anywhere in this
tree, and — decisively — the integration harness builds schema by TypeORM `synchronize`, which
emits no triggers, so the cap would hold in production and silently **not** in tests. That is the
exact divergence `implementation-plan-automation-rules-storage.md` §27 declined a `CHECK` for.

The cap is enforced in `placeHold`, and **counting inside the transaction is not sufficient on its
own**. Postgres defaults to READ COMMITTED, so two concurrent `placeHold` calls on a work with nine
active holds both `SELECT count(*)` → 9 (each other's INSERT is uncommitted and invisible), both
pass, both insert → **eleven**. A plain `SELECT` takes no locks, and this is a *phantom*, so even
`SELECT … FOR UPDATE` over `fulfillment_holds` cannot help — the offending rows do not exist yet.

`placeHold` therefore takes a **row lock on the parent `fulfillment_works` row** first, which is
what serialises the count-then-insert per work:

```sql
SELECT "id" FROM "fulfillment_works" WHERE "id" = $1 FOR UPDATE;
SELECT count(*) FROM "fulfillment_holds" WHERE "fulfillmentWorkId" = $1 AND "releasedAt" IS NULL;
-- then INSERT, or raise FulfillmentHoldLimitExceededError
```

`setLock('pessimistic_write')` is the in-tree spelling (`return.repository.ts`,
`reservation.repository.ts`, `prompt-template.repository.ts`). The cap is proved by a **concurrent**
int-spec with two overlapping transactions — a sequential test and a mocked unit test both pass
against the broken implementation, so neither is evidence. Stated in the migration docblock so the
absent DB constraint reads as a decision.

### D-4 — foreign keys, per relation

| Relation | FK? | Reasoning |
|---|---|---|
| `fulfillment_work_lines.fulfillmentWorkId` | **YES**, `ON DELETE CASCADE` | a line is a *part of* its work, not a peer; deleting a work must take its lines and nothing else owns them (`return_lines → returns` precedent) |
| `fulfillment_holds.fulfillmentWorkId` | **YES**, `ON DELETE CASCADE` | same shape — a hold is meaningless without its work |
| `fulfillment_works.orderId` | **NO** | cross-aggregate by-value reference; the `order_changes` / `refund_records` / `returns.internalOrderId` precedent avoids cross-table lock coupling on the hottest write path |
| `fulfillment_work_lines.orderLineId` | **impossible** | `order_records` has no lines table — items live inside the `orderSnapshot` jsonb |
| `fulfillment_works.assignedConnectionId` | **NO** | a work must outlive the connection that held it; a deleted connection must not cascade away fulfilment history |

Both real FKs exist in the **migration only**, with no `@ManyToOne` relation (the
`category_mappings` / `inventory_locations` / `return_lines` precedent). Note the consequence: the
`synchronize`-built test schema has no FKs, so the CASCADE closure does not cover these tables and
all three need explicit `tablesToTruncate` entries (children first).

### D-5 — `@Check` is declared class-level with the migration's own constraint NAME

Not anonymous. The harness builds schema by `synchronize`, so an anonymous `@Check` gets a hash name
and the int-spec would assert a constraint the migration-built schema does not have under that name.
Precedents: `return-line`, `reservation`, `reservation-shortfall-episode`, `inventory-item`,
`return-line-event`, `offer-commercial-snapshot`.

The capacity `CHECK` is the DB twin of the pure `checkFulfillmentWorkLineCapacity` #2391 shipped.
**As shipped they are NOT equivalent, and that has to be fixed rather than papered over.** The pure
function tests only `remaining >= 0`, so `{total: 5, fulfilled: -1, cancelled: 0}` passes it
(remaining = 6) while failing the non-negativity clauses the `CHECK` needs. Its own docblock claims
"#2392 mirrors this as the DB `CHECK`; the two must move together" — a claim this slice would
falsify.

**Resolution**: widen `checkFulfillmentWorkLineCapacity` to include the three non-negativity
clauses, restoring the equivalence #2391 asserted. That is the honest direction — a negative
fulfilled quantity is not a line "within capacity" under any reading — it is one line plus a spec
update, and the function has no consumers yet. The alternative (dropping the equivalence claim)
leaves two subtly different rules with one name, which is exactly the drift a vocabulary leaf
exists to prevent. A unit spec asserts the pure function and the int-spec asserts the constraint
over the same fixture table, so a future divergence fails both.

### D-6 — the boot spec's armed arm, replaced

`fulfillment-no-injection-boot.int-spec.ts` test 4 THROWS by design the moment a Nest decorator
appears under the context. Replaced with the ADR-041 F3 shape
(`invoicing-auto-issue-boot.int-spec.ts`): boot the real worker container, resolve
`FULFILLMENT_WORK_REPOSITORY_TOKEN` (proving the module is wired and no DI/require cycle exists),
then assert the provider graph carries no `orders` / `inventory` service — by reading Nest's own
injection metadata for every provider `FulfillmentModule` declares, and asserting `FulfillmentModule`'s
`imports` metadata contains neither `OrdersModule` nor `InventoryModule`.

**Verified RED first** by temporarily injecting `IOrderRecordService` into the repository — and the
red must be the ASSERTION, not a `TS6133` unused-import with `Tests: 0 total`, which would be a
false pass. Evidence recorded in the PR.

The static scan (`scripts/check-no-injection-contracts.mjs`) is unchanged and remains the
complement, not the duplicate: it cannot see `ModuleRef.get(TOKEN, { strict: false })`.

### D-7 — `toOrm` exclusions (the writer table)

`toOrm` maps ONLY the columns whose writer is the aggregate write itself. Every column below has a
single narrow atomic writer and is **excluded**, so an unrelated upsert cannot null-then-reset it and
a stale in-memory read cannot stomp a peer's write.

| Column | Sole writer | Why excluded |
|---|---|---|
| `status` | `transitionStatus` / `cancel` | progress ingress and operator actions write it out of band; a router re-save would revert a `closed` work to `open` |
| `requestStatus` | `transitionRequestStatus` | the executor handshake (#2399) owns it; the router holds a stale copy by construction |
| `assignedConnectionId` | `assignHolder` / `clearHolder` | a rejection clears it; a concurrent save would resurrect a holder who refused |
| `assignmentAttempt` | `incrementAssignmentAttempt` (#2399) | monotonic counter; a round-trip would reset the idempotency key's stability |
| `dispatchRelayedAt` | `claimDispatchRelay` (#2401) | an at-most-once claim marker — round-tripping a `null` re-opens the relay |
| `cancelledAt` / `cancellationReason` | `cancel` | the `order_records.cancelledAt` precedent verbatim |
| `version` | every transition, `version = version + 1` in SQL | must be computed in the database, never from a caller's read |
| `fulfilledQuantity` / `cancelledQuantity` | `recordLineProgress` | progress ingress (#2400) owns them; the router creating a work carries zeros and would erase real progress |

**Five further columns are INSERT-ONLY** — present on the `create` statement, absent from every
update path. The distinction matters and the earlier draft of this plan got it wrong by collapsing
it into "excluded":

| Column | Why insert-only rather than simply excluded |
|---|---|
| `assignedConnectionId` | ADR-054 R1 requires the router to create N work rows **already assigned**, in one transaction. Excluding it from the insert would force `create` + `assignHolder` as two statements and open an unassigned-work window; excluding it from UPDATEs is what stops a stale save resurrecting a holder who refused |
| `status` / `requestStatus` | the initial values (`open` / `unsubmitted`) are the router's to set; every later move is a transition |
| `locationId` / `deliveryMethod` | the router is the single producer, but re-routing is contemplated (§ 4). If re-routing mints a NEW row these are never updated; if it ever updates in place, a `toOrm` round-trip from a stale read would silently revert it. Insert-only forces #2395 to make that choice explicitly |

`toOrm` therefore assigns only: `id`, `orderId`, `totalQuantity` (on lines) and the timestamps —
plus the five insert-only columns **on the create path only**. `orderId` is insert-only for the same
statement-level reason (`text NOT NULL`, no DB default, so it must be present on a first write —
the `sourceConnectionId` precedent).

**`create` accepts an optional `EntityManager`.** ADR-054 R1 requires N work rows and the order's
terminalisation to commit in ONE transaction; if `create` always opened its own, #2395 could not
compose it. It opens one only when none is supplied.

**This repository writes no raw-SQL upsert**, so the `ReturnRepository.upsertFromSource` trap (the
exclusion must ALSO be applied to the raw column tuple) does not arise. A comment records that, so
a later raw-SQL path inherits the rule rather than rediscovering it.

### D-7b — what `version` means, and why it is a new pattern

There is **no optimistic-concurrency column anywhere in `libs/core/src` today** — no
`@VersionColumn`, no precedent. `CLAUDE.md` requires a new pattern be justified explicitly, so:
ADR-054 names it as a work-row column and DESIGN §5.2 makes the read model "actionable only with an
optimistic-concurrency token", so the alternative is #2406 inventing one against a table it does not
own.

Two properties are settled here because #2406 cannot settle them retroactively:

1. **It counts STATE CHANGES, not writes.** `version = version + 1` rides in the `SET` of each
   transition, so a not-applied transition (the `WHERE` matched zero rows) does **not** bump it.
   That is what makes an idempotent retry safe: a caller replaying an already-applied action sees
   "not applied" against an *unchanged* version, which must not be reported as a stale-token 409.
2. **Every mutating port method takes an object-shaped input, not positional arguments.** No method
   takes `expectedVersion` yet — it has no consumer, and guessing its semantics now is how it gets
   wrong. The object shape is what makes adding it later purely additive instead of a nine-signature
   widening. When #2406 adds it, it belongs in the `WHERE` (`AND "version" = :expectedVersion`), not
   only in the `SET`.

### D-8 — `shipment_lines.fulfillmentWorkId` CANNOT be delivered as written. **BLOCKING.**

#2392 and DESIGN §5.2 both say *"`shipment_lines` gains a nullable `fulfillmentWorkId`"*. **There is
no `shipment_lines` table** — not on this branch and not on `origin/main`. `libs/core/src/shipping`
declares exactly one ORM entity, `@Entity('shipments')`, with no line concept of any kind.

The design was written against an assumed schema the tree does not have. Three options:

- **(a) Defer to `W3a-13`** — the issue already says the column is *"wired in `W3a-13`"*, so that
  sibling necessarily touches this seam and can create the table it needs. **Recommended.**
- (b) Put `fulfillmentWorkId` on `shipments` instead. Defensible on the relation alone (§5.2 says
  `FulfillmentWork` 1:N `Shipment`, and for 1:N the FK belongs on the many side — so `shipments` is
  arguably the *more* correct home) — but it is a reinterpretation of two written specs, and if the
  design really does intend per-line linkage (one shipment combining lines from two works) it is
  wrong in a way that is expensive to reverse once #2402 builds on it.
- (c) Create `shipment_lines` here. Rejected: a whole new aggregate child for the shipping context,
  far outside an S1 schema slice, with no consumer and no spec for its other columns.

Taking (a): the plan ships nothing for this AC and says so. Reported before implementation.

### D-9 — the PK is `ol_fulfillmentwork_*`, and no prefix override is added

`formatInternalId('FulfillmentWork')` yields `ol_fulfillmentwork_<32-hex>` through the lowercase
fallback. A prettier `ol_work_*` would require an `ENTITY_TYPE_ID_PREFIX` entry, and that map is
`Partial<Record<CoreEntityType, string>>` — so it would first need a `CoreEntityTypeValues` member,
widening a closed union shared by every adapter for a cosmetic gain. `returns` (#2327) and inventory
locations take exactly this path (`formatInternalId('Return')` / `'Location'`, no member, no
override), and `return.orm-entity.ts:14-16` documents it. Accepted, and stated on the entity so the
next reader does not re-open it.

Line and hold PKs are plain `uuid_generate_v4()`: neither is referenced from outside its aggregate,
so minting a prefixed internal id would buy nothing (the `return_lines` / `refund_records`
precedent).

---

## 6. Implementation Plan

### Phase 1 — Domain contracts

1. **`domain/ports/fulfillment-work-repository.port.ts`** — `FulfillmentWorkRepositoryPort`.
   One narrow conditional UPDATE per axis transition, each returning `boolean` (`affected > 0`):
   `create`, `findById`, `findByOrderId`, `transitionStatus`, `transitionRequestStatus`,
   `assignHolder`, `clearHolder`, `incrementAssignmentAttempt`, `claimDispatchRelay`, `cancel`,
   `recordLineProgress`, `placeHold`, `releaseHold`, `listActiveHolds`.
   *Acceptance*: every mutating method that has a precondition returns `boolean` or throws a named
   domain error; none returns `void`.
2. **`domain/exceptions/`** — `FulfillmentPersistenceError(operation, cause)` (the
   `ReturnPersistenceError` shape), `FulfillmentWorkNotFoundError`, `FulfillmentHoldNotFoundError`,
   `FulfillmentHoldAlreadyReleasedError`, `FulfillmentHoldLimitExceededError`,
   `DuplicateFulfillmentWorkLineError`.
3. **`fulfillment.tokens.ts`** — replace `export {};` with
   `FULFILLMENT_WORK_REPOSITORY_TOKEN`. Rule 6: Symbol declarations only.
   *Acceptance*: the barrel's `export * from './fulfillment.tokens'` still compiles (no `TS2306`).

### Phase 2 — Persistence

4. Three `*.orm-entity.ts` under `infrastructure/persistence/entities/`, with named class-level
   `@Check` / `@Index` matching the migration byte for byte (D-5).
5. **`infrastructure/persistence/repositories/fulfillment-work.repository.ts`** — the per-column
   writer table (D-7) in the file header; `create` writes header + lines in ONE
   `dataSource.transaction`; every transition is `repository.update({...preconditions}, {...})`
   returning `(result.affected ?? 0) > 0`; `releaseHold` uses `.returning('*')` + a re-read to
   distinguish the two zero-row causes; `23505` matched by CODE and converted, every other
   `QueryFailedError` propagating untranslated.
6. **`orm-entities.ts`** sub-barrel + the `"./fulfillment/orm-entities"` block in
   `libs/core/package.json`.
7. **`fulfillment.module.ts`** — `TypeOrmModule.forFeature([...3])`, the repository behind its token,
   `exports: [FULFILLMENT_WORK_REPOSITORY_TOKEN]`. Barrel exports `FulfillmentModule` (D-2).

### Phase 3 — Migration

8. `apps/api/src/migrations/1864000000000-create-fulfillment-works.ts`, class
   `CreateFulfillmentWorks1864000000000`, `name` property agreeing with both (rules 2+3+4).
   `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`, `CREATE TABLE IF NOT EXISTS`, quoted camelCase,
   `CREATE ... INDEX IF NOT EXISTS`; docblock in the `create-order-holds` narrative shape naming
   which choices are contract (the capacity CHECK, the actor XOR, the two CASCADE FKs, the absent
   grouping-unique, the absent ≤10 constraint). `down()` drops indexes, then children, then parent.
   *Acceptance*: `migration:show` clean; up **and** down exercised against a throwaway Postgres.

### Phase 4 — Wiring

9. `FulfillmentModule` into `apps/api/src/app.module.ts` and `apps/worker/src/app.module.ts`.
   **This is what puts the tables into the int-test schema** (`autoLoadEntities` + `synchronize`;
   there is no entity list anywhere).
10. `tablesToTruncate` in `apps/api/test/integration/setup.ts` — all three, children first, with a
    comment stating that the migration-only FKs are absent from the `synchronize`-built schema so
    the CASCADE closure cannot reach them.
11. The `fulfillment` allow-set line in `barrel-purity.spec.ts` (D-1).

### Phase 5 — Tests

12. Unit specs: the three entities' mapping, `toDomain` narrow-or-fallback coercion, `23505`
    translation, the ≤10 cap, and every conditional-UPDATE precondition.
13. **Replace** the boot spec's armed arm (D-6). **Red-first evidence required.**
14. `apps/api/test/integration/fulfillment-work-schema.int-spec.ts` — modelled on
    `returns-schema.int-spec.ts`: one `information_schema.columns` assertion per table, plus the
    capacity CHECK proved BEHAVIOURALLY by catching the violation and matching
    `CHK_fulfillment_work_lines_capacity` in the message. **Red-first**: assert the insert is
    rejected before the constraint exists.
15. `apps/api/test/integration/fulfillment-work-transitions.int-spec.ts` — every axis transition
    applied twice: the first reports applied, the second (now stale) reports **not applied** and
    mutates nothing. Plus:
    - **the hold cap under CONCURRENCY** — two overlapping transactions against a work with 9 active
      holds; exactly one succeeds. A sequential test passes against the broken implementation, so it
      would be no evidence at all.
    - **`CHK_fulfillment_holds_actor`** — both violating shapes rejected (neither actor set, and both
      set). The "neither" case is the one a service-placed hold hits first.
    - **`create` atomicity** — a line violating the capacity CHECK must leave **no** header row.
    - **`version`** — an applied transition bumps it; a not-applied one does not.

16. **CASCADE is NOT verifiable in CI, and the plan says so rather than implying otherwise.** The
    `synchronize`-built test schema has no FKs at all, so neither int-spec can prove
    `ON DELETE CASCADE`. It is exercised by hand against the throwaway migration-built Postgres
    (`information_schema.table_constraints` + a real delete), and the command and its output are
    recorded in the PR. Every other AC in § 9 is machine-checked; this one is not, and that is
    stated.

### Phase 6 — Docs

17. `architecture-overview.md` § 26 — the persisted schema, the writer table, the FK reasoning, the
    ≤10 decision, the `HoldReason` carve-out (amending § 26's current "`HoldReason` is NOT imported"
    sentence, which this slice makes obsolete), and the D-8 deferral.
18. **AC-1 is already satisfied**: #2391 shipped the ADR-054 pointer line at § 26. Verified, not
    duplicated.

---

## 7. Alternatives Considered

**A1 — one `fulfillment_work_state` table with a status column per axis.** Rejected: ADR-054's two
axes are orthogonal and a merged row invites the "cancel is a command" bug one layer down.

**A2 — enforce ≤10 holds with a trigger.** Rejected — D-3.

**A3 — a generic `save(work)` instead of per-axis transitions.** Rejected: that IS the
`order_records` multi-writer problem REVIEW C10 names, at a hotter grain.

**A4 — PG enums for the two axes.** Rejected: zero precedent in 60+ migrations, and widening a
union would need an `ALTER TYPE` plus a coordinated deploy.

---

## 8. Validation & Risks

- **Risk — the entity/migration pair drifts.** Mitigation: every index and CHECK is named
  identically on both sides and asserted behaviourally by the int-spec; verified by hand before
  commit.
- **Risk — the module is not imported by a host app**, so the tables never enter the int-test schema
  and the schema int-spec asserts against nothing. Mitigation: the int-spec's column assertion fails
  loudly on a missing table (it cannot pass vacuously).
- **Risk — a later slice adds a raw-SQL upsert and forgets the D-7 exclusions.** Mitigation: stated
  in the repository header.
- **Edge case — `cancel` on an already-cancelled work** reports not-applied rather than throwing;
  the caller decides. `releaseHold` is the exception, because its two zero-row causes are different
  facts an operator must be able to tell apart.
- **Backward compatibility**: purely additive. Three new tables, one new nullable-free module. No
  existing column, entity or query changes.

---

## 9. Testing Strategy & Acceptance Criteria

- [ ] Counter CHECK rejects an over-fulfilment at the DB level (int-spec, red-first).
- [ ] Every axis transition is a conditional UPDATE; a stale-precondition call reports "not applied"
      (int-spec).
- [ ] `migration:show` clean; up **and** down exercised on a throwaway Postgres; no
      `synchronize: true` introduced.
- [ ] Per-column writer table documented in the repository file header.
- [ ] Repository converts unique/constraint violations to domain errors; never leaks
      `QueryFailedError`.
- [ ] The boot spec's provider-graph assertion replaces the armed arm and was verified red.
- [ ] `pnpm lint` (0 errors), `pnpm type-check`, `pnpm test`, `pnpm test:integration`,
      `pnpm check:invariants` (35 checks). The worker boot spec is run explicitly — root
      `test:integration` is `--filter @openlinker/api` only (#2670).
- [ ] AC-1 (`architecture-overview.md` ADR-054 pointer) — verified already satisfied by #2391.
- [ ] **AC — `shipment_lines.fulfillmentWorkId`: NOT DELIVERABLE as written (D-8), deferred.**

---

## 10. Alignment Checklist

- [x] Hexagonal architecture — port in `domain/`, implementation in `infrastructure/persistence/`.
- [x] CORE ↔ Integration boundary — no adapter resolved, no platform vocabulary.
- [x] Existing patterns, no new abstractions.
- [x] Idempotency — conditional UPDATEs; `create` atomic.
- [x] Error handling — domain errors only across the port.
- [x] Testing strategy complete; two red-first obligations named.
- [x] Naming + file structure per `engineering-standards.md`.
- [x] Execution-ready.
