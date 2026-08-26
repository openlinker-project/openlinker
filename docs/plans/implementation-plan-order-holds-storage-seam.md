# Implementation Plan: `order_holds` storage seam (#2338 / `W2-1`)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~0.5 day

---

## 1. Task Summary

**Objective**: Land the persistence seam for **order holds** — a new `order_holds`
table in the `orders` context, an anemic `OrderHold` domain entity, and
`OrderHoldRepositoryPort` whose two mutators (`placeIfNoneOpen`, `releaseHeld`)
are double-call-safe and raise **named domain errors** rather than leaking
TypeORM's `QueryFailedError`.

**Context**: There is no way to stop an order in OpenLinker today. A
fraud-suspect or unpaid order flows straight through provisioning and dispatch;
the operator's only recourse is disabling a connection, which stops *every*
order. DESIGN §6.3 specifies `order_holds`; REVIEW §3 **H9** deliberately names
the repository seam (`OrderHoldRepositoryPort.placeIfNoneOpen`, each mutator with
its own domain error) rather than leaving it to be improvised at the service
layer — because four issues chain behind this one (#2339 → #2342) and would each
otherwise invent their own concurrency story.

**Classification**: CORE — Domain + Infrastructure (**migration-bearing**).

---

## 2. Scope & Non-Goals

### In Scope
- `order_holds` table + migration (`1849000000000`).
- `OrderHoldOrmEntity` carrying the partial unique index and the actor `CHECK`
  under the **same names** the migration uses.
- `OrderHold` domain entity (anemic + one pure derivation, ADR-011).
- `OrderHoldRepositoryPort` + `OrderHoldRepository` (TypeORM).
- Domain errors `OrderAlreadyOnHoldError`, `HoldAlreadyReleasedError`.
- `ORDER_HOLD_REPOSITORY_TOKEN`; a leaf `OrderHoldsModule`.
- Unit spec for the repository's error translation + an int-spec proving the DB
  guarantees and that **no TypeORM error type escapes the port**.

### Out of Scope (owned by the chained issues)
- `OrderHoldService`, the `held`/`released` `OmsLifecycleFact` emissions, and the
  provisioning/dispatch enforcement — **#2339**.
- `order_records.activeHoldReason` denormalised projection + its reconcile —
  later in Wave 2 (DESIGN §6.3); this table is the authority, that column is the
  projection, and nothing here writes it.
- Any HTTP surface, FE, or automation trigger (T3) — #2340–#2342.
- **`phaseEnteredAt` is NOT added anywhere** — adjudicated: a phase fed by `now`
  is uninvalidatable. `placedAt` is the backing fact T3 reads.
- Work-grain holds (`fulfillment_holds`) — Wave 3, once `FulfillmentWork` exists.

### Constraints
- Wave-2 branch base; migration timestamp must be the next free **synthetic**
  prefix (`docs/migrations.md` rule 3). Current tail on this branch and on
  `origin/main` is `1848000000000` ⇒ **`1849000000000`**.
- The integration harness builds its schema by TypeORM `synchronize`, **not** by
  migration, so every constraint an int-spec asserts must be declared on the ORM
  entity under the same name as in the migration (the #2333 / #2327 rule).

---

## 3. Architecture Mapping

**Target Layer**: `libs/core/src/orders/` — domain (entity, port, exceptions) +
infrastructure (ORM entity, repository); migration in `apps/api/src/migrations/`.

**Capabilities Involved**: none. A hold is an **OL-owned lifecycle fact**, not a
destination capability — no adapter, no `*Port` capability, no plugin surface.
This is precisely why it lives in CORE: the authority over "this order is
stopped" is OpenLinker's, not a marketplace's.

**Existing patterns reused (verbatim where possible)**:
- `order_changes` (#2333, ADR-044) — the closest sibling and the direct template:
  partial unique index named identically on entity + migration, `internalOrderId`
  as an indexed reference **by value with no FK**, plain uuid PK (not an
  `ol_*` internal id), narrow conditional `UPDATE` mutators.
- `IdentifierMappingRepository.insertMapping` — catch-`23505`, act on the code,
  never the message.
- `ShipmentRepository.claimWaybillRelay` — `WHERE … IS NULL` claim reporting
  `affected > 0`.
- `ReturnLineOrmEntity` — a **named** `@Check(...)` mirroring the migration's
  `CHK_*` constraint so `synchronize` and the migration agree.
- `HoldReason` from `@openlinker/core/order-lifecycle` (#2305) — **imported, not
  restated**. Note the shipped identifier is `HoldReason`, not `OrderHoldReason`
  (REVIEW H14: the union is shared with the future work grain, so an
  `Order`-prefixed name would be misleading). This plan uses the shipped name.

**New Components**: listed in §6.

---

## 4. Domain Research

### The two invariants the table exists to hold

1. **At most one OPEN hold per order** (v1 grain). Enforced by a **partial**
   unique index `UQ_order_holds_open_order ON (internalOrderId) WHERE
   "releasedAt" IS NULL`. Partial, not total, so releasing frees the slot and an
   order can be held again — an order permanently unholdable after one release
   would be a liveness bug of exactly the shape ADR-044 corrected for
   `order_changes`.
   Shopify's ≤10 is at the *fulfillment* grain, which this design also allows
   once `FulfillmentWork` exists (Wave 3) — stacking is **not** a v1 gap.

2. **Every row names its actor.** A `CHECK` requires exactly one of
   `placedByUserId` / `placedByService`. Exactly-one (`<>`) rather than at-least-one:
   an actor is one thing, and a row claiming both a human and a service placed it
   is not a richer record, it is an unanswerable audit question. §6.4's release
   rule ("released by the placing service or by an admin with a mandatory release
   note") is only decidable if the placer is unambiguous.

### Why the errors are named, and named *these* things

`placeIfNoneOpen` returning `null` on contention was considered and rejected: it
pushes the decision to every caller, and #2339's `OrderHoldService`, #2341's HTTP
layer and #2342's automation would each have to re-derive the same meaning. A
named error carries it once. `QueryFailedError` must never escape — the
`DuplicateIdentifierMappingError` precedent, and the engineering-standards rule
that a repository converts infrastructure errors to domain errors.

- `OrderAlreadyOnHoldError(internalOrderId)` — the slot is taken.
- `HoldAlreadyReleasedError(holdId)` — zero rows matched
  `WHERE "releasedAt" IS NULL`.

`HoldAlreadyReleasedError` is deliberately **not** `OrderHold…`-prefixed for the
same reason `HoldReason` is not: the work grain will reuse it.

**Both mutators are therefore double-call-safe**: a second call changes nothing
and says so, rather than silently succeeding (which would let #2339 emit a second
`held` fact for one hold) or writing a second row.

### One subtlety the errors have to survive

`releaseHeld` affecting zero rows has **two** causes: the hold is already
released, or the id does not exist at all. Reporting "already released" for a
row that never existed would be a false statement about the operator's data. The
repository therefore re-reads on the zero-affected branch: a row found ⇒
`HoldAlreadyReleasedError`; nothing found ⇒ `OrderHoldNotFoundError`. This is the
same insert-then-recover reasoning `OrderChangeRepository.insertRequested` uses,
applied to the release direction.

Symmetrically, `placeIfNoneOpen`'s `23505` recovery re-selects the open hold; if
the peer's row was released in between the slot is free again, and rethrowing so
the caller retries is more honest than looping — verbatim the `insertRequested`
comment's reasoning.

---

## 5. Questions & Assumptions

### Assumptions
- **A1** — The chained issues need reads as well as writes: #2339 must ask "is
  this order held?" at the provisioning choke point, #2341 renders a hold
  history, #2342 (trigger T3) sweeps holds open longer than N days. The port
  ships those four reads now rather than growing one per downstream PR.
- **A2** — `internalOrderId` is `text`, NOT NULL, **no FK** (the
  `refund_records` / `invoice_records` / `order_changes` precedent of an indexed
  reference by value). Consequence: nothing cascades in, so
  `apps/api/test/integration/setup.ts` must truncate `order_holds` explicitly.
- **A3** — `reason` is a plain `varchar(64)` with no PG enum and no `CHECK`,
  coerced on read by `isHoldReason`. `HoldReason` is a **closed** union
  (ADR-059), so a DB list would be defensible here — but it would cost a
  migration per value and turn a rollback into a hard write failure, and the
  `order_changes` precedent is one file away. Coercion failure is reported
  (`OrderHoldVocabularyError`), never silently mapped onto `operator`, which
  would attribute a machine's hold to a human — the exact thing `isHoldReason`'s
  no-default posture exists to prevent.
- **A4** — `placedAt` is caller-supplied (`Date`), not a DB default, so the
  service owns the clock and a test can pin it. `releasedAt` likewise.
- **A5** — `id` is a plain uuid, not `ol_hold_*`: a hold is an internal audit row
  no external system names and that never passes through `identifier_mappings`
  (the `order_changes` / `return_lines` shape). No `CoreEntityTypeValues` member
  and no `ENTITY_TYPE_ID_PREFIX` override is added; a later reader should not
  "fix" the omission.
- **A6** — A leaf `OrderHoldsModule` (the `OrderChangesModule` precedent) rather
  than adding providers to `OrdersModule`, whose graph pulls in seven sibling
  contexts. #2339's service will import it.

### Open Questions (non-blocking)
- **Q1** — Does the operator surface (#2341) need paging on hold history? Not
  assumed; `listByOrder` returns the order's holds newest-first unpaged, since one
  order's hold count is inherently small. If #2341 disagrees, adding a page
  argument is additive.
- **Q2** — `releaseNote` mandatory-for-admin (§6.4) is a **service**-layer rule.
  The column is nullable here; #2339 enforces the policy. Encoding it in the
  schema would require the schema to know who is releasing, which it cannot.

---

## 6. Proposed Implementation Plan

### Phase 1 — Domain

1. **`libs/core/src/orders/domain/entities/order-hold.entity.ts`**
   - `OrderHold`, fully `readonly`, anemic per ADR-011, with **one** pure
     derivation `isOpen(): boolean` (`this.releasedAt === null`) — a function of
     its own already-loaded field, no clock, no parameters.
   - Fields: `id`, `internalOrderId`, `reason: HoldReason`, `note: string | null`,
     `placedByUserId: string | null`, `placedByService: string | null`,
     `placedAt: Date`, `releasedAt: Date | null`,
     `releasedByUserId: string | null`, `releaseNote: string | null`,
     `createdAt`, `updatedAt`.
   - **Acceptance**: no framework import; `pnpm type-check` green.

2. **`libs/core/src/orders/domain/types/order-hold.types.ts`**
   - `PlaceOrderHoldInput` / `ReleaseOrderHoldInput`. Types live in a
     `*.types.ts` per the house rule; this file carries no runtime functions
     (the coercion it would need already exists as `isHoldReason` upstream).
   - `PlaceOrderHoldInput.placedBy` is modelled as a **discriminated union**
     (`{ kind: 'user'; userId } | { kind: 'service'; service }`), so the
     exactly-one actor invariant is a compile-time fact at the call site as well
     as a `CHECK` at the row. The repository flattens it onto the two columns.

3. **Domain exceptions** in `libs/core/src/orders/domain/exceptions/`
   - `order-already-on-hold.error.ts` → `OrderAlreadyOnHoldError`
   - `hold-already-released.error.ts` → `HoldAlreadyReleasedError`
   - `order-hold-not-found.error.ts` → `OrderHoldNotFoundError`
   - `order-hold-vocabulary.error.ts` → `OrderHoldVocabularyError`
   - Each: `extends Error`, sets `name`, `Error.captureStackTrace`, carries the
     identifying value as a readonly field (the `OrderChangeVocabularyError`
     shape).

4. **`libs/core/src/orders/domain/ports/order-hold-repository.port.ts`**
   ```ts
   export interface OrderHoldRepositoryPort {
     placeIfNoneOpen(input: PlaceOrderHoldInput): Promise<OrderHold>;
     releaseHeld(input: ReleaseOrderHoldInput): Promise<OrderHold>;
     findById(id: string): Promise<OrderHold | null>;
     findOpenByOrder(internalOrderId: string): Promise<OrderHold | null>;
     findOpenByOrders(internalOrderIds: string[]): Promise<OrderHold[]>;
     listByOrder(internalOrderId: string): Promise<OrderHold[]>;
     listOpenPlacedBefore(before: Date, limit: number): Promise<OrderHold[]>;
     listOpenHolds(limit: number, offset: number): Promise<OrderHold[]>;
   }
   ```
   Docblock states the four rules a consumer may rely on (one open hold per
   order; both mutators double-call-safe and error-bearing; no TypeORM type
   escapes; the port is **intra-context** — a sibling reaches it through
   `IOrderHoldService`, never directly).
   - `findOpenByOrders` is batched for #2341's list projection: the per-row
     alternative is N queries behind a paged table.
   - `listOpenPlacedBefore` is T3's read (automation v1, #2360 — "on hold for N
     days", the reason `placedAt` exists and `phaseEnteredAt` does not), bounded
     by `limit` — an unbounded sweep read is the shape ADR-048 spent a wave
     removing. **It has no cursor, and the docblock must say what that costs**:
     with more than `limit` holds past the threshold, every tick returns the same
     head page and the tail is never reached. That is safe only if the caller's
     action removes the row from the predicate (releasing it, or stamping
     something the query excludes). A caller that merely *notifies* starves and
     needs a cursor added — stated here rather than discovered in #2360.
   - `listOpenHolds(limit, offset)` is #2340's reconcile-sweep read, deliberately
     **scan-offset** shaped rather than `Date`-keyed, because `runBoundedSweep`
     persists a numeric cursor and resumes on it. It is ordered by `id` — a
     stable, unique, always-present key — rather than by `placedAt`, which is
     caller-supplied and therefore not guaranteed distinct, and an offset page
     over a non-unique sort can skip a row between ticks. **A stable sort does
     not make offset paging total here, and the docblock must say so**: the open
     set *shrinks* as holds are released, and a release removes a row and shifts
     every later row down one, so the next page steps over one. The consequence
     is a missed reconcile repair, retried on the next cycle — bounded and
     self-healing, which is why this is documented rather than redesigned
     (#2340 owns the sweep's semantics), but it must be written where #2340
     will read it.
   - `findById` also serves #2341's release path: the controller scopes to the
     order and reads `isOpen()` + `placedByService` off the returned row, so the
     mandatory-note rule needs no extra query and no extra port method.

### Phase 2 — Infrastructure

5. **`…/infrastructure/persistence/entities/order-hold.orm-entity.ts`**
   - `@Entity('order_holds')`, `@PrimaryGeneratedColumn('uuid')`.
   - `@Index('UQ_order_holds_open_order', ['internalOrderId'], { unique: true, where: `"releasedAt" IS NULL` })`
   - `@Index('IDX_order_holds_order', ['internalOrderId', 'placedAt'])`
   - `@Index('IDX_order_holds_open_placed_at', ['placedAt'], { where: `"releasedAt" IS NULL` })` — T3's read.
   - `@Check('CHK_order_holds_actor', `("placedByUserId" IS NOT NULL) <> ("placedByService" IS NOT NULL)`)`
   - Every name matches the migration verbatim (the `synchronize` rule above).

6. **`…/infrastructure/persistence/repositories/order-hold.repository.ts`**
   - `placeIfNoneOpen`: build + `save`; catch `23505` (code, never message) →
     re-select the open hold → `OrderAlreadyOnHoldError`; if the slot has since
     been freed, rethrow so the caller retries into a clean insert.
   - `releaseHeld`: a QueryBuilder `UPDATE … WHERE "id" = :id AND "releasedAt"
     IS NULL … RETURNING *` — one statement, matching the issue's own wording and
     yielding both the affected count and the row. On zero rows, `findById` →
     found ⇒ `HoldAlreadyReleasedError`, absent ⇒ `OrderHoldNotFoundError`.
     (Zero-affected has two causes and reporting the wrong one is a false
     statement about the operator's data — see §4.)
   - `toDomain` coerces `reason` via `isHoldReason`, raising
     `OrderHoldVocabularyError` on a miss.
   - Mapping is **private** to the repository (no separate mapper — single
     consumer).

7. **`libs/core/src/orders/orders.tokens.ts`** — `ORDER_HOLD_REPOSITORY_TOKEN`.

8. **`libs/core/src/orders/order-holds.module.ts`** — leaf module,
   `TypeOrmModule.forFeature([OrderHoldOrmEntity])`, provides + exports the
   token bound `useExisting` to the repository.
   - **It is deliberately imported by nobody in this slice, and that is a stated
     consequence rather than an oversight.** `OrderChangesModule` (#2333) shipped
     with `ReturnsModule` as its consumer in the same change; this module's first
     consumer is #2339's `OrderHoldService`. Registering it into `OrdersModule`
     merely to have a parent would give it a home in the graph it does not need
     and would drag the leaf into the seven-context module it was split out to
     avoid. It ships unimported; #2339 wires it.
   - **The int-spec therefore must NOT resolve the token from the Nest
     container** — an unregistered module contributes no providers, so
     `harness.getApp().get(ORDER_HOLD_REPOSITORY_TOKEN)` would throw. See step 14.

9. **Barrels** — `libs/core/src/orders/index.ts` exports the entity, the input
   types and the four exceptions; `orders.tokens.ts` is already star-exported.
   `OrderHoldRepositoryPort` is **not** exported from the barrel (the
   `OrderChangeRepositoryPort` precedent: intra-context). `orm-entities.ts` gains
   `OrderHoldOrmEntity` with a comment naming its int-spec consumer.

### Phase 3 — Migration

10. **`apps/api/src/migrations/1849000000000-create-order-holds.ts`**
    (`CreateOrderHolds1849000000000`) — `CREATE EXTENSION IF NOT EXISTS
    "uuid-ossp"`, `CREATE TABLE IF NOT EXISTS "order_holds" (…)` with the
    `CHK_order_holds_actor` constraint inline, then the three indexes; `down()`
    drops indexes then table. Docblock states the three contract choices (partial
    unique index, actor CHECK, no FK) as the `order_changes` migration does —
    **plus a fourth**: why `reason` carries no DB `CHECK` even though
    `HoldReason` is closed (A3). The `order_changes` precedent rests on the
    opposite premise (`OrderChangeKind` is open and Wave 2 widens it), so without
    the note a later reader would reasonably "fix" the omission by adding one —
    the same posture `hold-reason.types.ts` takes about its own name.
    - **Acceptance**: `pnpm check:invariants` green (timestamp unique, class
      suffix matches, strictly greater than `origin/main`'s tail).

11. **`apps/api/test/integration/setup.ts`** — add `'order_holds'` to
    `tablesToTruncate` with the "no FK, nothing cascades in" comment.

### Phase 4 — Tests

12. **`order-hold.repository.spec.ts`** (unit) — mocked TypeORM `Repository`;
    asserts the four error translations, including that a raw `QueryFailedError`
    with a **non**-`23505` code propagates untranslated (a repository that
    swallowed every DB error would be worse than one that leaked).
13. **`order-hold.entity.spec.ts`** — `isOpen()` both ways.
14. **`apps/api/test/integration/orders/order-holds.int-spec.ts`** — real
    Postgres, exercising the **port**, not raw SQL, because the AC is about what
    escapes the port.
    **Construct the repository directly**, not via the DI container:
    ```ts
    const repo = new OrderHoldRepository(
      harness.getDataSource().getRepository(OrderHoldOrmEntity)
    );
    ```
    This runs the real port implementation against the real `synchronize`-built
    schema with no app wiring, and is exactly why `OrderHoldOrmEntity` joins the
    `orm-entities` sub-barrel (step 9). Note the `order_changes` int-spec is
    **not** a precedent for this file: it asserts DB-level guarantees with raw
    SQL and never touches its repository, which cannot satisfy an AC phrased as
    "no TypeORM error type escapes the port". Assertions:
    - place twice ⇒ one row + `OrderAlreadyOnHoldError` (and
      `expect(err).not.toBeInstanceOf(QueryFailedError)`);
    - release twice ⇒ one stamp + `HoldAlreadyReleasedError`;
    - release an unknown id ⇒ `OrderHoldNotFoundError`;
    - place → release → place again succeeds (the slot is freed);
    - two different orders held concurrently do not block each other;
    - the actor `CHECK` rejects neither-actor and both-actors rows (raw SQL here,
      since the port's typed input cannot express the violation);
    - `listOpenPlacedBefore` / `findOpenByOrders` return what they claim.

---

## 7. Alternatives Considered

- **Boolean/`status` column instead of `releasedAt`.** Rejected: every other
  at-most-once marker in the tree is a timestamp (`waybillRelayedAt`,
  `cancelledAt`, `fxStampedAt`, `appliedAt`) at the same storage cost, and T3
  needs the release time anyway.
- **`activeHoldReason` on `order_records` as the only storage.** Rejected: it
  cannot express history, cannot name the actor, and has no place to enforce
  at-most-one-open. It is a *projection* of this table (DESIGN §6.3), written
  later in Wave 2, and the table wins on drift.
- **Returning `null`/`false` from the mutators.** Rejected — see §4.
- **A total unique index on `internalOrderId`.** Rejected: it makes an order
  permanently unholdable after its first release.
- **FK to `order_records`.** Rejected: the three sibling tables all reference by
  value, avoiding cross-table lock coupling; the cost (explicit truncation) is
  paid in one line of `setup.ts`.

---

## 8. Validation & Risks

- ✅ Hexagonal: domain has no `typeorm`/`@nestjs` import; the repository
  implements the domain port; the port is injected by Symbol token.
- ✅ Naming: `*.entity.ts` / `*.port.ts` / `*.orm-entity.ts` / `*.repository.ts` /
  `*.error.ts`; `ORDER_HOLD_REPOSITORY_TOKEN` matches the
  `{CONTEXT}_{INTERFACE}_TOKEN` rule.
- ✅ Cross-context: `HoldReason` is imported from the sibling barrel
  `@openlinker/core/order-lifecycle` — a published type alias, an allowed shape.
- **Risk — entity/migration drift.** The int-spec asserts DB-level guarantees but
  the harness builds by `synchronize`, so a constraint present only in the
  migration would be untested and one present only on the entity would never
  reach production. Mitigated by declaring both under identical names and by
  stating the rule in both docblocks.
- **Risk — timestamp collision with a sibling Wave-2 branch.** Re-checked against
  `origin/main` immediately before commit; `check:invariants` fails the build on
  a collision.
- ✅ Backward compatible: additive table, no existing column touched, no
  behaviour change until #2339 reads it.

---

## 9. Acceptance Criteria (from the issue)

- [ ] Migration filename re-prefixed to the next free **synthetic** timestamp.
- [ ] Migration creates `order_holds` with the partial unique index on
      `(internalOrderId) WHERE "releasedAt" IS NULL`.
- [ ] `placeIfNoneOpen` twice ⇒ one row + `OrderAlreadyOnHoldError`.
- [ ] `releaseHeld` twice ⇒ one stamp + `HoldAlreadyReleasedError`.
- [ ] No TypeORM error type escapes the port (asserted in the int-spec).
- [ ] Either `placedByUserId` or `placedByService` on every row (DB `CHECK`).
- [ ] Tests added; no CORE ↔ Integration boundary violation.

---

## 10. Alignment Checklist

- [x] Hexagonal architecture
- [x] CORE vs Integration boundary respected (no adapter, no capability)
- [x] Existing patterns reused (`order_changes` end to end)
- [x] Idempotency: both mutators double-call-safe by construction
- [x] Event-driven: deliberately none here — facts are #2339's
- [x] Rate limits/retries: N/A (no outbound call)
- [x] Error handling: four named domain errors, no infrastructure leak
- [x] Testing strategy complete (unit + integration)
- [x] Naming + file structure per engineering-standards
- [x] Execution-ready
