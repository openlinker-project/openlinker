# Implementation Plan: Reservation ledger — table, §6I guarded-UPDATE repository, named domain errors (#2343)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: 1 day
**Issue**: #2343 (`W2-6`) — OMS Wave 2, Body B, first issue
**Design of record**: `docs/plans/analysis/DESIGN-oms-authority-model.md` § 4.2; ADR-061; `ANALYSIS-1032-oms-module.md` § 6I; `REVIEW-oms-authority-model.md` § 3 H9

---

## 1. Task Summary

**Objective**: land the persistence and concurrency substrate of OpenLinker's own advisory reservation
ledger — the `reservations` table, the `inventory_items.olReservedQuantity` counter it denormalises,
and a `ReservationRepositoryPort` whose every state transition is a **guarded conditional UPDATE**
with a **named domain error** for each way it can match nothing.

**Context**: Body B is "the only thing in the programme that makes an ingested order reduce what
channels may promise". Seven issues chain behind this one (#2344 service, #2345 ATP subtraction,
#2346/#2347/#2348 consume/expiry/surfacing, #2349 reconciler, #2350). The seam landed here is
therefore a contract, not an internal detail. Every operation is a concurrency primitive whose
failure mode is an **oversell**, so the deliverable is the SQL *plus* a concurrent integration-test
matrix against real Postgres — a mocked repository cannot prove a `WHERE` predicate.

**Classification**: CORE — Domain + Infrastructure, **migration-bearing**.

---

## 2. Scope & Non-Goals

### In scope
- `reservations` table + partial unique index + supporting indexes (migration + ORM entity).
- `inventory_items.olReservedQuantity` `integer NOT NULL DEFAULT 0` + `CHECK (>= 0)`.
- `Reservation` domain entity, `reservation.types.ts`, `ReservationRepositoryPort`.
- `ReservationRepository` implementing it: four operations, all guarded, no TypeORM error escaping.
- Four named domain exceptions.
- Tokens, barrel exports, module wiring, ORM sub-barrel, int-harness truncate list.
- Unit spec (mapping/sorting/error-translation) + integration spec (the concurrency matrix).

### Out of scope (explicit non-goals, each owned by a named successor)
- **`ReservationService` / get-or-create / delta-adjust / `atpEffect` stamping policy** — #2344.
  This issue ships primitives; it does not decide *when* a reservation is created.
- **ATP subtraction.** `RESERVATION_LEDGER_READER_TOKEN` stays bound to `EmptyReservationLedgerReader`,
  so published quantities remain byte-identical to today. This is load-bearing: swapping that binding
  is #2345's single change, and doing it here would make Story I1 (an install with zero reservations
  publishes exactly as today) untestable as a *separate* regression.
- Consume claim (#2346-ish), expiry sweep (#2349's state-dependent extend/release), shortfall
  surfacing (`W2-12`), the reconciler job, and any HTTP/FE surface.
- Multi-location sourcing. v1 is explicitly single-location (§ 6I): a reservation names one
  `inventoryItemId` and no adapter emits a non-null `locationId` today.
- Retirement of `InventoryMasterPort.reserveInventory` / `releaseInventory` (#2315 deprecated them
  in place; removal is a contract-major cycle).

### Constraints
- Guarded UPDATE, never read-modify-write (`ShipmentRepository.claimWaybillRelay`,
  `InventoryRepository.backfillLegacyProvenance`, Wave-1c `claimAttribution` are the house idiom).
- Named domain errors only across the port boundary (`docs/engineering-standards.md § Error
  Handling`; `DuplicateIdentifierMappingError` precedent).
- Synthetic sequential migration prefix (`docs/migrations.md` rule 3). Tail on the Wave-2 base is
  `1848000000000`; a sibling agent (#2338) is claiming `1849000000000`; this plan takes
  **`1850000000000`**, verified against the working tree and `origin/main` before commit.
- The integration harness builds its schema by `synchronize`, **not** by migration — so every
  constraint that the migration creates must ALSO be declared, under the same name, on the ORM
  entity, or the int-spec is testing a different schema than production. (`CreateReturns1846…`
  states this rule; #2343 is the second instance.)

---

## 3. Architecture Mapping

**Target layer**: `libs/core/src/inventory/` — domain (entity, port, types, exceptions) +
infrastructure (ORM entity, repository) + module wiring. Migration in `apps/api/src/migrations/`.

**Existing components reused**
- `InventoryItemOrmEntity` — gains one column; its master-owned-column classification spec
  (`INVENTORY_*_COLUMNS` in `inventory.repository.ts`) must classify the new column, or the build
  fails. `olReservedQuantity` is **OL-owned, never master-written**, so it joins neither the identity
  group nor the master-owned group — it needs its own classification (see Phase 2, step 3).
- `ReservationLedgerReaderPort` / `ReservationAtpEffect` (#2321) — the `atpEffect` union already
  exists and is already exported. **Reuse it verbatim**; defining a second copy in
  `reservation.types.ts` would give the codebase two vocabularies for one column.
- `SyncLockPort` — **not** used. Guarded UPDATEs take row locks in Postgres; an advisory lock on top
  would be a second, weaker serialisation of the same rows.

**New components**
| Layer | File |
|---|---|
| Domain entity | `domain/entities/reservation.entity.ts` |
| Domain types | `domain/types/reservation.types.ts` |
| Domain port | `domain/ports/reservation-repository.port.ts` |
| Domain exceptions | `domain/exceptions/insufficient-availability.error.ts`, `reservation-position-unavailable.error.ts`, `reservation-not-held.error.ts`, `reservation-ledger-constraint.error.ts` |
| Infrastructure | `infrastructure/persistence/entities/reservation.orm-entity.ts`, `.../repositories/reservation.repository.ts` |
| Migration | `apps/api/src/migrations/1850000000009-create-reservations.ts` |

**CORE, not Integration**: the ledger is OpenLinker's OWN promise-tracking, defined precisely because
no destination owns it. Nothing here is platform-shaped and no adapter is touched.

**Cross-context edges**: none added. `reservations.orderRecordId` / `orderLineId` are indexed values
with **no FK** (the `refund_records` / `returns` precedent — `order_records` has no lines table at
all, so `orderLineId` necessarily points into the `orderSnapshot` jsonb). This keeps `inventory`
free of an `inventory → orders` import, which #2344 explicitly relies on for the `atpEffect` design
(the stamp is caller-supplied precisely so no `inventory ↔ fulfillment` edge exists).

---

## 4. The ledger's grain, and what consumers may rely on

**One row = one order line's held claim against one inventory position.** The natural key is
`(orderRecordId, orderLineId, inventoryItemId)`, unique **only while `status = 'held'`**.

Every part of that is deliberate and is the contract the seven successor issues bind to:

- **`orderRecordId` is in the key and cannot be dropped.** `orderLineId` is the *source-supplied*
  `OrderItem.id`, unique only within an order — Allegro and PrestaShop line ids collide across orders
  trivially. Keyed on `orderLineId` alone, order B's reserve fails against order A's unrelated held
  row and the operator sees "insufficient stock" with stock plainly available (§ 6I).
- **`inventoryItemId` is in the key** so one line can eventually hold at more than one position once
  sourcing exists — even though v1 is single-location.
- **The index is PARTIAL on `status = 'held'`.** That partiality *is* the idempotency key
  (#2344's `ON CONFLICT DO NOTHING` + re-select depends on it), and it is what lets a line be
  released and later re-reserved without colliding with its own history.
- **`quantity` is units of THAT position held by THAT line** — not an order total, not a variant total.
- **`atpEffect` is immutable per row and stamped at creation by the caller.** A reader may test it as
  a local column (#2345) and must never re-derive it.
- **`expiresAt` is NOT NULL.** An unbounded hold on a system that may never observe the close event is
  an oversell leak with no floor (§ 4.2). The *policy* for what expiry does is #2349's; the *floor*
  is this table's.
- **`olReservedQuantity` is denormalised state over this ledger, and the ledger is authoritative.**
  #2349's reconciler corrects the counter to `SUM(quantity) WHERE status='held'`, never the reverse.
- **A terminal row is never deleted.** `released | consumed | expired` rows stay for history; only
  `held` rows are live. Consumers filter on `status`, never on row existence.

---

## 5. Questions & Assumptions

### Resolved by decision (recorded, not left open)
1. **Table name — `reservations` vs § 6I's `inventory_reservations`.** Chosen: **`reservations`**.
   The issue's acceptance criterion names it literally ("Migration creates `reservations`"), and the
   file/class naming it prescribes (`reservation.entity.ts`, `ReservationRepositoryPort`) is
   consistent with it. The `returns` migration (#2327) set the precedent of following the AC's
   literal table name. There is no competing "reservation" concept in the schema, so the shorter
   name is unambiguous. Recorded here because § 6I says otherwise and a future reader will notice.
2. **`releaseHeld` covers release AND consume AND expiry.** § 6I: "Release and consume decrement
   identically". REVIEW H9 names `releaseHeld`. So: one operation, one guarded statement, with the
   **terminal status a required parameter**. Not three near-identical methods — three copies of a
   decrement is three places to get the `WHERE` wrong.
3. **`claimHeld` owns the ledger row AND the counter, in one transaction — no `withTransaction` on
   the port.** An earlier draft split `insertHeldIfAbsent` from `claimHeld` and added a
   `withTransaction<T>(fn: (tx: ReservationRepositoryPort) => Promise<T>)` seam so #2344 could
   compose them atomically. Rejected on review, for two reasons.

   First, **it leaks a persistence concept into a domain port.** `engineering-standards.md §
   Repository Ports Pattern` says a port carries "only methods needed by application services… do
   NOT mirror the TypeORM `Repository<T>` API". A transaction *is* that API. The repo's shape is a
   repository that injects `DataSource` and keeps `dataSource.transaction(...)` **internal**
   (`return.repository.ts:101` saving header + lines, `order-record.repository.ts:1868`, five
   `mappings/*.repository.ts`); nothing exposes a transaction seam.

   Second, **it was unnecessary** — the split was the problem, not the missing seam. Keeping the
   ledger row and its denormalised counter consistent is *the repository's own invariant*, not
   caller policy. So `claimHeld` takes the **desired held quantity** per line and, inside one
   transaction, upserts the ledger row and moves the counter by the delta between the persisted
   quantity and the desired one. Get-or-create and delta-adjust then fall out of one operation
   instead of being composed by a caller who could forget the transaction — and #2344 keeps every
   decision that is genuinely its own (which lines, what quantity, which `atpEffect`, what
   `expiresAt`, the multi-position gate).
4. **Zero rows from `claimHeld` has three causes and must not collapse into one error.** Insufficient
   ATP, a stale position, and a missing position are different operator situations. On the failure
   path only (never the happy path) the repository issues one follow-up read to discriminate.

### Assumptions
- `availableQuantity` is already net of the master's own reservations, so `reservedQuantity` is
  subtracted nowhere (§ 6I's double-counting answer, restated in § 4.2). The ATP predicate is
  `availableQuantity - olReservedQuantity >= q`.
- `isStale = false` belongs in the claim predicate (§ 6I's statement includes it): a position whose
  variant vanished from the master must not accept new promises.
- No `CHECK (olReservedQuantity <= availableQuantity)`. A master dropping availability below an
  already-committed reservation set is a **fact to surface** (`W2-12`), not a constraint violation
  that would make the *sync* fail.

---

## 6. Proposed Implementation Plan

### Phase 1 — Domain

1. **`domain/types/reservation.types.ts`**
   - `ReservationStatusValues = ['held','released','consumed','expired'] as const` + `ReservationStatus`.
   - `ReservationTerminalStatusValues = ['released','consumed','expired'] as const` +
     `ReservationTerminalStatus` — a narrowed union so `releaseHeld` cannot be asked to flip a row
     back to `held` at the type level.
   - `ReservationKey`, `CreateReservationInput`, `ReservationClaimInput`, `ReservationClaimOutcome`,
     `ReleaseReservationInput`.
   - Re-export `ReservationAtpEffect` from the #2321 port rather than redefining it.
   - *Acceptance*: `as const` pattern, no enums, types only (no runtime rule qualifies for the
     `engineering-standards.md § pure-rule exception` here).

2. **`domain/entities/reservation.entity.ts`** — anemic readonly constructor entity (ADR-011).
   *Acceptance*: no framework import, no mutation method.

3. **Four exceptions in `domain/exceptions/`**
   - `InsufficientAvailabilityError(inventoryItemId, requestedQuantity, availableQuantity)`
   - `ReservationPositionUnavailableError(inventoryItemId, reason: 'missing' | 'stale')`
   - `ReservationNotHeldError(orderRecordId, orderLineId, inventoryItemId)`
   - `ReservationLedgerConstraintError(constraint, cause)` — the translation target for any
     `QueryFailedError` a guarded statement can still raise (notably the `>= 0` CHECK, which the
     guard makes unreachable, so firing it is a defect signal rather than a normal path).
   *Acceptance*: each sets `name`, calls `Error.captureStackTrace`, carries its discriminating fields.

4. **`domain/ports/reservation-repository.port.ts`**
   ```ts
   export interface ReservationRepositoryPort {
     /** Upsert each held row to its desired quantity and move the counter by the delta. */
     claimHeld(claims: readonly ReservationClaimInput[]): Promise<readonly ReservationClaimOutcome[]>;
     /** Terminalise ONE held row and release its units. */
     releaseHeld(input: ReleaseReservationInput): Promise<Reservation>;
     findHeld(key: ReservationKey): Promise<Reservation | null>;
     listHeldByOrderRecordId(orderRecordId: string): Promise<readonly Reservation[]>;
   }
   ```
   Four operations, as the issue's size justification says — and `listHeldByOrderRecordId` is not
   padding: `releaseHeld` is keyed, so cancelling an order (#2346/#2347) and the expiry sweep
   (#2349) both need to *discover* the keys before they can release them.
   Each method's docblock states its guard predicate and which named error a zero-row match raises.

### Phase 2 — Persistence

1. **`reservation.orm-entity.ts`** — `@Entity('reservations')`, columns per § 4, with:
   - `@Index(['orderRecordId','orderLineId','inventoryItemId'], { unique: true, where: `"status" = 'held'` })`
     named `UQ_reservations_active_line`.
   - `@Index(['status','atpEffect','inventoryItemId'])` — named for the query that is **already
     written**: `computeAtp` (`availability.types.ts:111`) fixes #2345's sum as
     `Σ quantity WHERE status='held' AND atpEffect='published'`, joined to `inventory_items` on
     `inventoryItemId` to reach `productVariantId`/`sourceConnectionId`. Both predicate columns lead;
     the join column trails. The same index serves #2349's reconciler
     (`SUM … GROUP BY inventoryItemId`).
   - `@Index(['status','expiresAt'])` — the expiry sweep's *candidate* scan. Note this predicate is
     only half of #2349: expiry is **state-dependent** (ADR-061 decision 1 / REVIEW C1 — the sweep
     *extends* rather than releases when the order carries an open hold), so the sweep reads orders
     after this index narrows the candidates.
   - `@Index(['orderRecordId'])` — order-scoped reads (#2346/#2347).
   - `@ManyToOne(() => InventoryItemOrmEntity, { onDelete: 'RESTRICT' })` — a position with live
     reservations must not vanish (§ 6I); the stale path soft-marks rather than deletes.
   - `@Check('CHK_reservations_quantity_positive', '"quantity" > 0')` — declared under the same name
     the migration uses, because the int harness builds by `synchronize`.
   - **No FK on `orderRecordId` / `orderLineId`.**

2. **`inventory-item.orm-entity.ts`** — add
   `@Column('int', { default: 0 }) olReservedQuantity!: number;` and a named
   `@Check('CHK_inventory_items_ol_reserved_nonneg', '"olReservedQuantity" >= 0')`.

3. **`inventory.repository.ts` column classification** — `INVENTORY_OL_OWNED_COLUMNS`
   (`inventory.repository.ts:141`) **already exists**, declared empty by Wave 1b with a docblock
   naming `olReservedQuantity` as its single anticipated member and an explicit
   `readonly (keyof InventoryItemOrmEntity)[]` annotation chosen so this append type-checks.
   **Append to it; do not declare a new group.** Update its docblock from "empty by decomposition"
   to naming the landed column. Deliberately **not** added to `INVENTORY_MASTER_OWNED_COLUMNS`: the
   master sync must never write this column, and the whole point of that column-scoped UPDATE is that
   a new column cannot silently join the write set.
   *Acceptance*: `inventory.repository.spec.ts` passes with the column classified exactly once, and
   the master-sync UPDATE's `.set({...})` literal is unchanged.

4. **Move the emptiness pin in `inventory.repository.spec.ts:650`.** That spec asserts
   `expect(INVENTORY_OL_OWNED_COLUMNS).toEqual([])` with a comment stating the pin exists so the
   surrounding "never writes an OL-owned column" assertion "start[s] doing real work on the same
   commit that fills the group". Filling the group without touching it **fails `pnpm test`** — by
   design. Replace it with `toContain('olReservedQuantity')`; the loop above it then stops being
   vacuous, and the sibling coverage/disjointness assertions exercise the fourth group for real.

4. **`reservation.repository.ts`**
   - `findHeld` / `listHeldByOrderRecordId` — plain query-builder selects filtered to `status='held'`.
   - `claimHeld` — **the core primitive.** An empty input array returns `[]` without opening a
     transaction. Otherwise, in one transaction, over claims **sorted ascending by
     `inventoryItemId`** (mandatory, not stylistic: two multi-line orders touching the same positions
     in opposite order deadlock without it), per claim:
     1. `INSERT … ON CONFLICT ("orderRecordId","orderLineId","inventoryItemId") WHERE status='held'
        DO NOTHING RETURNING *`. A conflict is a **success signal**, not an error — the
        insert-then-recover idiom `IdentifierMappingRepository.insertMapping` ships. On conflict,
        re-select the held row to learn its persisted quantity.
     2. `delta = desiredQuantity − persistedQuantity` (the full quantity on a fresh insert). `delta
        === 0` short-circuits: a repeated identical reserve touches the counter not at all, which is
        what makes #2344's crash-resume safe.
     3. `delta > 0` runs the guarded add below; `delta < 0` runs the release-shaped decrement (an
        amended-down line), so a shrink can never fail on availability.
     4. A widening whose guard fails throws, rolling back the whole transaction — so the ledger row
        keeps its **original** quantity, which is #2344's acceptance criterion.

     The guarded add:
     ```sql
     UPDATE "inventory_items"
        SET "olReservedQuantity" = "olReservedQuantity" + $2
      WHERE "id" = $1
        AND "isStale" = false
        AND "availableQuantity" - "olReservedQuantity" >= $2
     RETURNING "availableQuantity" - "olReservedQuantity" AS "remainingAtp"
     ```
     `affected > 0` is the answer. On zero rows: one discriminating read of the position →
     missing/stale ⇒ `ReservationPositionUnavailableError`; otherwise
     `InsufficientAvailabilityError(id, requested, available)`. The throw rolls the whole transaction
     back — a partially-claimed order set must never persist.
     Raw-query reply shape is normalised the way `markVariantsStaleExcept` documents
     (`[rows, affected]` vs a bare row array — the driver's raw typing is `any`).
   - `releaseHeld` — one transaction, two guarded statements:
     ```sql
     UPDATE "reservations" SET "status" = $4, "releasedAt" = now()
      WHERE "orderRecordId" = $1 AND "orderLineId" = $2 AND "inventoryItemId" = $3
        AND "status" = 'held'
     RETURNING *
     ```
     zero rows ⇒ `ReservationNotHeldError` (so a double release is a *named, discriminable*
     no-op rather than a silent double decrement), then
     ```sql
     UPDATE "inventory_items"
        SET "olReservedQuantity" = GREATEST(0, "olReservedQuantity" - $2)
      WHERE "id" = $1
     ```
     `GREATEST(0, …)` guards against a reconciler having already corrected the counter (§ 6I); the
     CHECK remains the hard floor. Ordering the *ledger* flip first is deliberate: the ledger is
     authoritative, so if the second statement is lost the reconciler repairs toward a state the
     ledger already describes.
     **The error hangs off the LEDGER statement, not the counter statement.** § 6I attaches
     `ReservationNotHeldError` to `UPDATE inventory_items … WHERE olReservedQuantity >= $q`; this
     plan attaches it to the reservation-row flip instead, and the counter decrement is then
     unguarded-but-clamped. That is a deliberate divergence: the ledger is authoritative (the #2349
     reconciler corrects the counter *to* it), so "was this reservation held?" is a question only the
     ledger row can answer — the counter can legitimately have been corrected out from under it,
     in which case the § 6I predicate would report "not held" about a row that plainly is.
   - **Every public method wraps its body** in a translation that converts `QueryFailedError` to a
     named error (constraint-name-keyed) and rethrows already-named domain errors untouched. This is
     the AC "no TypeORM error escapes the port".

5. **Migration `1850000000009-create-reservations.ts`** — creates the table, the partial unique index,
   the three supporting indexes, the FK, the quantity check; adds `olReservedQuantity` + its CHECK.
   `down()` drops both. Header states the synthetic-prefix rule and why no
   `olReserved <= available` CHECK exists.

### Phase 3 — Wiring

- `inventory.tokens.ts`: `RESERVATION_REPOSITORY_TOKEN = Symbol('ReservationRepositoryPort')`.
- `inventory.module.ts`: entity in `forFeature`, provider + `useExisting` binding, export.
  `RESERVATION_LEDGER_READER_TOKEN` binding **unchanged** (still `EmptyReservationLedgerReader`).
- `orm-entities.ts`: export `ReservationOrmEntity` (the int harness needs it).
- `index.ts`: export entity, port, types, tokens, the four exceptions. **Not** the repository class.
- `apps/api/test/integration/setup.ts`: add `'reservations'` to `tablesToTruncate`.

### Phase 4 — Tests

**Unit** — `reservation.repository.spec.ts`: claim sorting by `inventoryItemId` (the deadlock
guarantee, asserted on the statement order), error translation for each zero-row branch,
the delta arithmetic (fresh insert / identical repeat is a no-op / widen / shrink), the empty-array
short-circuit, and `releaseHeld` refusing a non-`held` row.

**Integration** — `apps/api/test/integration/reservations-ledger.int-spec.ts`, real Postgres, the
matrix the issue's size justification names:
1. Two concurrent `claimHeld` for a position with stock for exactly one ⇒ one succeeds, the loser
   raises `InsufficientAvailabilityError` carrying requested + available.
2. Two concurrent multi-line claims submitted in **opposite input order** ⇒ both settle, no deadlock.
3. `olReservedQuantity` can never go negative — release beyond held is refused by the guard, and a
   direct `UPDATE … SET olReservedQuantity = -1` is refused by the CHECK.
4. **No CHECK forbids `olReserved > available`** — a master sync lowering `availableQuantity` below a
   committed reservation set is *persistable* (this asserts an absence, deliberately).
5. Reserve racing a master sync that lowers `availableQuantity` ⇒ both serialise on the row lock; the
   post-sync ATP is what the guard reads.
6. Release racing a second release ⇒ exactly one succeeds, the other raises `ReservationNotHeldError`,
   the counter decrements once.
7. The partial unique index admits a second row for the same triple once the first is terminal.
8. A multi-line `claimHeld` whose second line fails on availability rolls back the first line's
   ledger row **and** its counter increment.
9. A repeated identical `claimHeld` is granted and moves the counter not at all; an amended-up
   quantity moves it by the delta; an amended-up quantity that exceeds ATP throws and leaves the
   original ledger quantity intact.
10. No `QueryFailedError` escapes any operation.

Concurrency is exercised by issuing the competing operations on **separate connections** without
awaiting the first — a single-connection `Promise.all` would serialise in the driver and prove nothing.

---

## 7. Alternatives Considered

1. **Read-then-write with `SELECT … FOR UPDATE`.** Rejected: it is the defect shape this programme
   keeps correcting, it holds the lock across a round trip on the row every published quantity
   derives from, and the guarded UPDATE expresses the same invariant in one statement.
2. **A `CHECK (olReservedQuantity <= availableQuantity)`.** Rejected by § 6I explicitly — it would
   make the master *sync* fail when a master legitimately lowers stock, converting a fact the operator
   must see into an error that hides it.
3. **Three methods (`releaseHeld` / `consumeHeld` / `expireHeld`).** Rejected: three copies of one
   decrement is three places to get the `WHERE` wrong; the terminal status is data.
4. **Reusing `InventoryMasterPort.reserveInventory`.** Rejected and already ruled out by #2315 —
   those are master-side pushes, deprecated in place, and no shipped adapter implements them.
5. **Splitting the ledger insert from the counter claim and exposing `withTransaction`.** Rejected on
   tech review — see § 5 decision 3. It leaks a TypeORM concept into a domain port against
   `engineering-standards.md § Repository Ports Pattern`, has no precedent in the repo, and was
   solving a problem the split itself created. Keeping the counter consistent with the ledger is the
   repository's invariant, not the caller's.

---

## 8. Validation & Risks

| Check | Status |
|---|---|
| Hexagonal layering (domain has no framework import) | ✅ |
| Repository throws domain errors only | ✅ (per-method translation) |
| Cross-context imports | ✅ none added |
| Naming (`*.port.ts`, `*.orm-entity.ts`, `*.error.ts`, `as const` unions) | ✅ |
| Symbol token in `<ctx>.tokens.ts`, barrel `export *` | ✅ |
| Migration ordering (rule 3) | ✅ `1850000000000`, re-verified pre-commit |
| Backward compatibility | ✅ additive; ATP unchanged until #2345 |

**Risks**
- *ORM/migration schema drift.* The int harness uses `synchronize`, so a constraint present only in
  the migration is untested and one present only in the entity never ships. Mitigation: both
  constraints declared under identical names in both places, called out in the migration header.
- *Migration timestamp collision with the concurrent #2338 agent.* Mitigation: re-check the working
  tree and `origin/main` immediately before commit; `check:migration-timestamps` fails the build on
  collision, so the failure mode is loud.
- *`claimHeld`'s discriminating read is a second round trip, and is racy.* Bounded to the failure
  path only. The race is benign by construction: it can only mislabel an already-failing claim
  (`InsufficientAvailabilityError` vs `ReservationPositionUnavailableError`), never turn a failure
  into a success — the guard already decided that. Documented in the method's docblock rather than
  locked, because `SELECT … FOR SHARE` on a diagnostic read would put a lock on the failure path of
  the hottest write in the system.
- *Column-classification spec.* Adding `olReservedQuantity` without classifying it fails the build —
  which is the guard working, not a risk, but it is the one place this change reaches into #2071's
  machinery.

---

## 9. Acceptance Criteria (from the issue)

- [ ] Migration creates `reservations`, the partial unique index, `olReservedQuantity` and its CHECK
- [ ] Two concurrent `claimHeld` for a position with stock for one succeed exactly once; the loser raises `InsufficientAvailabilityError` (real Postgres)
- [ ] Two concurrent multi-line claims in opposite input order do not deadlock (real Postgres)
- [ ] `olReservedQuantity` can never go negative (constraint asserted)
- [ ] No CHECK forbids `olReserved > available` — a master drop is *persistable*
- [ ] No TypeORM error escapes the port; tests added; no boundary violations

---

## 10. Alignment Checklist

- [x] Hexagonal architecture
- [x] CORE vs Integration boundary respected
- [x] Existing patterns reused (guarded UPDATE, insert-then-recover, `as const` unions, Symbol tokens)
- [x] Idempotency considered (partial unique index; double release is named, not silent)
- [x] Error handling comprehensive (four named errors, per-method translation)
- [x] Testing strategy complete (unit + a concurrency matrix on real Postgres)
- [x] Naming + file structure per `engineering-standards.md`
- [x] No new ADR required — ADR-061 and design § 4.2 already carry this decision

---

## Related Documentation

- `docs/plans/analysis/DESIGN-oms-authority-model.md` § 4.2
- `docs/plans/analysis/ANALYSIS-1032-oms-module.md` § 6I
- `docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md`
- `docs/architecture/adrs/058-*` (inventory provenance ladder)
- `docs/migrations.md`, `docs/engineering-standards.md`, `docs/testing-guide.md`
