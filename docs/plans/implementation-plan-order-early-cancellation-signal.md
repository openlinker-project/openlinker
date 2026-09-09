# Implementation Plan: Durable Early-Cancellation Signal (#2069)

**Date**: 2026-09-09
**Status**: Draft
**Estimated Effort**: 0.75–1.5 days

---

## 1. Task Summary

**Objective**: Close the remaining half of #2069 — a source cancellation event
that arrives **before** OpenLinker has ever ingested the order must leave a
durable trace, so that the later create/sync job (which today provisions the
order as *active* at every destination) can observe the cancellation and skip
destination provisioning instead.

**Context**: `OrderIngestionService.handleSourceCancellation` resolves the
order's internal id via `IIdentifierMappingService.getInternalId`. When the
mapping does not exist yet (the order is genuinely unknown to OL), the method
logs a warning and returns `[]` — **nothing is written anywhere**. The later
create job then calls `getOrCreateInternalId`, persists a fresh
`order_records` row with `cancelledAt = null`, and `OrderSyncService.syncOrder`
(the `#2284` guard, already shipped) sees no cancellation and provisions the
order at every destination. The operator ends up with a live, shippable order
the buyer already cancelled.

Half of this issue shipped as **#2284**: `OrderSyncService.syncOrder` already
consults `record.cancelledAt` before provisioning and returns a distinct
terminal `'skipped_cancelled'` result per destination when it is set. That
half needs **no changes** — it is the consumer the new write feeds into.

This plan implements the remaining half only: **the durable write for an
early/unknown-order cancellation**, keyed on `(sourceConnectionId,
externalOrderId)` since no internal order id exists yet to write against.

**Explicitly rejected alternative** (per the issue's own analysis, and
reiterated in the retitling comment): minting an internal id via
`getOrCreateInternalId` from the cancellation path. That would create a real
`identifier_mappings` row — and, to hold `cancelledAt`, a stub `order_records`
row — for an order OL has never actually ingested, i.e. a phantom order
visible in the operator's order list before any real order data exists. This
is exactly the shape #2328 rejected for returns attribution ("point every
downstream trigger at a phantom").

**Classification**: CORE (Application + Infrastructure + Domain layers,
`libs/core/src/orders/`). One new database migration. No Interface-layer
(controller/DTO) or Integration-layer (adapter) changes; no new capability
port; no plugin-contract change.

---

## 2. Scope & Non-Goals

### In Scope
- A new durable "early cancellation signal" record, keyed on
  `(sourceConnectionId, externalOrderId)`, written when
  `handleSourceCancellation` cannot resolve an internal order id.
- Consuming that signal the moment the order is genuinely first (or later)
  ingested, and applying it via the existing, already-tested
  `markCancelled`/`recordCancellationIfNeeded` machinery so `#2284`'s
  provisioning guard sees it.
- Updating the two stale code comments the issue names (AC5, AC6).
- Unit tests (`order-ingestion.service.spec.ts`, `order-record.service.spec.ts`,
  a new repository spec) and an integration test exercising the full
  cancel-before-create race against real Postgres.

### Out of Scope
- Any change to `OrderSyncService`'s provisioning guard — it is already
  correct (#2284) and untouched by this plan.
- A lock or other mechanism to close the *microsecond*-scale TOCTOU race
  between `handleSourceCancellation`'s `getInternalId` read and the create
  job's `getOrCreateInternalId` write (see § 8 Risks — this residual is
  self-healing on the very next poll/webhook for that order, unlike today's
  bug, which never self-heals).
- A scheduled cleanup sweep for orphaned signal rows (an order that is
  cancelled before ingestion and then genuinely never re-synced again). The
  expected volume is bounded by how often this race fires at all, which is
  already the rare case the issue exists to close; see § 8.
- The `marketplace.offer.stockRestore` early-fire hook. It is gated on
  `incoming.status === 'cancelled'` and is **not** fired by the known-order
  `handleSourceCancellation` path either (verified — that method never
  enqueues it), so leaving it untouched keeps the new path symmetric with the
  existing one rather than introducing new behavior nothing asked for.
- Editing historical implementation-plan documents
  (`docs/plans/implementation-plan-1158-order-status-writeback-relay.md` etc.)
  that describe the residual as it stood at the time — those are point-in-time
  records, not living documentation. Only the *code comments* the issue names
  (AC5, AC6) are updated.
- An ADR. This is a single-bounded-context bug fix that reuses an
  already-established pattern in this exact context — a small,
  indexed-reference-by-value side table with no FK to its subject
  (`order_holds`, `order_changes`, `refund_records` all precede it) — and
  introduces no new capability port, no cross-context edge, and no
  plugin-contract change. It does not cross the bar in
  `docs/architecture/adrs/README.md § When to write an ADR`, and the issue
  itself does not ask for one.

### Constraints
- Must not regress the normal (create-then-cancel) ordering, already covered
  by `#1984`/`#2284`'s existing tests.
- Must not touch `persistOrder`'s signature or call sites — see § 4 for why
  the fix is fully contained in `persistIncomingSnapshot`, which always runs
  first and unconditionally on every non-cancel-event ingestion call.
- Follows the migration-timestamp convention in `docs/migrations.md`: the next
  free synthetic timestamp after the current tail
  (`1877000000000-add-fulfillment-progress-claims-shipped-index.ts`, core) and
  `1869000000200-create-oms-routing-rules.ts` (the only plugin migration dir
  ahead of core) is **`1878000000000`**.

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/orders/`) — domain port + type,
infrastructure ORM entity + repository, application service wiring. Plus one
migration in `apps/api/src/migrations/`.

**Capabilities Involved**: None new. No `OrderSourcePort` /
`OrderProcessorManagerPort` change. The fix sits entirely in ingestion
orchestration and persistence, below any capability port.

**Existing Services Reused**:
- `IIdentifierMappingService.getInternalId` (unchanged — still the read that
  decides which branch `handleSourceCancellation` takes).
- `IOrderRecordService.markCancelled` / the private `recordCancellationIfNeeded`
  helper and its first-write-wins, refresh-once-after-both-writers plumbing
  (`#1984`, `#2125`) — reused verbatim, not reimplemented.
- `OrderSyncService`'s `#2284` `cancelledAt IS NULL` provisioning guard —
  unchanged; it is what makes the new write actually matter.

**New Components Required**:
- `OrderCancellationSignalRepositoryPort` (domain port) — `record()` +
  `consume()`.
- `OrderCancellationSignalOrmEntity` (`order_cancellation_signals` table).
- `OrderCancellationSignalRepository` (infrastructure implementation).
- `ORDER_CANCELLATION_SIGNAL_REPOSITORY_TOKEN` in `orders.tokens.ts`.
- One new method on `IOrderRecordService` /  `OrderRecordService`:
  `recordEarlyCancellationSignal(sourceConnectionId, externalOrderId,
  cancelledAt)`.
- One migration creating the table.

**Core vs Integration Justification**: This is pure order-ingestion
orchestration and persistence — no external system is involved beyond the
ones already touched by `handleSourceCancellation` and `syncOrderFromSource`.
It belongs in `libs/core/src/orders/`, the same context that already owns
`order_records`, `order_holds`, and `order_changes`.

---

## 4. Internal Research — How The Fix Fits The Existing Flow

### 4.1 The two cancellation-observation paths (`#1984`)

`OrderRecordService` already has two ways a cancellation reaches
`order_records.cancelledAt`, both funneling through the same private
`recordCancellationIfNeeded(internalOrderId, isCancelled, cancelledAt)` →
`repository.markCancelled` (atomic, `COALESCE`-based, first-write-wins):

1. **`persistIncomingSnapshot`** (called at Step 2 of
   `OrderIngestionService.syncOrderFromSource`, *before* item resolution,
   *unconditionally* on every non-cancel-event call) — fires when the fetched
   `incoming.status === 'cancelled'`.
2. **`persistOrder`** (Step 5, only reached once item resolution succeeds) —
   fires on the same condition, off the built `Order.status`.
3. **`handleSourceCancellation`** itself, for the *already-known* order case
   — calls `markCancelled` directly with `new Date()`.

`persistOrder`'s own `upsertWithLineItems()` call **excludes** `cancelledAt`
from its column list (already asserted by
`order-record.repository.spec.ts:1824` — "should NOT include cancelledAt in
the upsert statement"), so whatever `persistIncomingSnapshot` wrote at Step 2
survives Step 5 untouched. Combined with the fact that `persistIncomingSnapshot`
is the **only** caller-side entry point that runs before `persistOrder` in
every `syncOrderFromSource` invocation (verified: `persistOrder` has exactly
one caller in the whole tree, `syncOrderFromSource`, always preceded by
`persistIncomingSnapshot` in the same call), **the entire fix can live inside
`persistIncomingSnapshot` alone** — no change to `persistOrder`'s signature or
body, no new parameter threading through `OrderIngestionService`.

### 4.2 Why a new keyed record, not a phantom order

`handleSourceCancellation`'s unknown-order branch has no internal id to write
`markCancelled` against — `OrderRecordRepository.markCancelled` is a bare
`UPDATE ... WHERE "internalOrderId" = $2` with **no insert fallback** (it is
explicitly documented as "No-op ... when the order row doesn't exist yet").
Minting an id via `getOrCreateInternalId` to make that `UPDATE` land would (a)
create a real `identifier_mappings` row for an order with no data yet, and
(b) still need a stub `order_records` INSERT to have any row for the `UPDATE`
to hit, i.e. an operator-visible phantom order — which is precisely what the
issue's own analysis and the retitling comment reject, citing #2328's
"point every downstream trigger at a phantom" rule for returns.

The new record is instead keyed on `(sourceConnectionId, externalOrderId)` —
the one piece of durable identity that exists before ingestion. It carries no
FK to `order_records` (there is nothing to reference), mirroring the
`order_holds` / `order_changes` / `refund_records` "indexed reference by
value" precedent in this exact context.

### 4.3 Consumption timing and the self-healing property

`consume()` must run **after** the order-record row for `internalOrderId`
already exists (i.e. after `repository.upsert(orderRecord)` inside
`persistIncomingSnapshot`), for the same reason `recordCancellationIfNeeded`
is already placed there: if `consume()` ran first and then the `upsert()`
failed, a retry of the whole ingestion attempt would find the signal already
deleted and lose the fact permanently. Placed **after** the upsert (exactly
where `recordCancellationIfNeeded` already sits), a failure in `consume()`
itself leaves the signal row untouched (a `DELETE` that throws commits
nothing), so a retry — or the next ordinary poll/webhook for that order,
since `consume()` runs unconditionally on **every** `persistIncomingSnapshot`
call, not just the first — picks it up. This is a materially different
failure mode from today's bug: today's gap **never** self-heals; the narrow
TOCTOU window this design leaves open (see § 8) self-heals on the very next
sync for that order.

### 4.4 Destination-echo guard does not need to be duplicated

`handleSourceCancellation`'s *known*-order branch already applies the ADR-017
destination-echo guard (skip when `existing.sourceConnectionId !==
connectionId`). The new unknown-order branch does not need an equivalent
check: a destination can only "echo" a cancellation for an order it has
itself been told to create, which requires OL to have already written an
`identifier_mappings` row for `(Order, itsExternalId, itsConnectionId)` →
the same internal id. If that mapping exists, `getInternalId` returns
non-null and the call routes into the *known*-order branch (where the guard
already applies) instead of the new one. The unknown-order branch is
reachable only for a genuine, first-ever cancellation signal for that
`(connectionId, externalOrderId)` pair.

---

## 5. Questions & Assumptions

### Open Questions
None — the design question the issue itself left open ("what does the early
cancel write against?") is answered in § 4.2/4.3 above.

### Assumptions
- The destination create path (`OrderSyncService.syncOrder`, gated by
  `#2284`) is the only provisioning path that needs the guard, as the issue's
  own "Assumptions" section states. Verified: `OrderProvisioningResumeService`
  and `OrderDestinationRetryService` both re-enqueue the *same*
  `marketplace.order.sync` job type, which re-enters
  `OrderIngestionService.syncOrderFromSource` → `OrderSyncService.syncOrder`,
  so they inherit the guard for free and need no separate check.
- A signal row surviving indefinitely (an order cancelled before ingestion
  that is then never synced again by that source) is an acceptable residual —
  see § 8. No TTL/cleanup sweep is added in this plan.
- `IncomingOrder.status` is a raw, source-native string (not the neutral
  `OrderStatus` union); the fix does not need to interpret it, only compare
  it to `'cancelled'`, exactly as the two existing call sites already do.

### Documentation Gaps
None found — `docs/architecture-overview.md § Order Lifecycle` /
`§ Orders` and the two relevant code files carry enough detail to design and
test this without further clarification.

---

## 6. Proposed Implementation Plan

### Phase 1 — Domain port, ORM entity, repository, migration

**Goal**: Introduce the new durable signal, following the `order_holds`
precedent exactly (small side table, no FK, `IF [NOT] EXISTS` migration).

**Steps**:

1. **Domain port**
   - **File**: `libs/core/src/orders/domain/ports/order-cancellation-signal-repository.port.ts`
   - **Action**: Define
     ```ts
     export interface OrderCancellationSignalRepositoryPort {
       /**
        * Durably record that a cancellation arrived for an order OL has not
        * yet ingested (#2069). Keyed on (sourceConnectionId, externalOrderId)
        * — no internal id exists yet, and minting one would point every
        * downstream trigger at a phantom order (the #2328 lesson).
        * First-write-wins: ON CONFLICT DO NOTHING, so a redelivered cancel
        * event never disturbs an already-recorded signal.
        */
       record(
         sourceConnectionId: string,
         externalOrderId: string,
         cancelledAt: Date
       ): Promise<void>;

       /**
        * Atomically read-and-clear the signal for
        * (sourceConnectionId, externalOrderId), if one exists — one
        * DELETE ... RETURNING statement, so two concurrent ingestion
        * attempts for the same external order can never both apply it and
        * the signal is applied at most once. Runs unconditionally on every
        * `persistIncomingSnapshot` call (not only the first), which is what
        * makes it self-healing against the narrow write/consume race
        * described in the repository's own doc comment.
        */
       consume(
         sourceConnectionId: string,
         externalOrderId: string
       ): Promise<Date | null>;
     }
     ```
   - **Acceptance**: File compiles; no domain-entity class needed (matches
     the `ConnectionCursorRepositoryPort` minimalism — this is a plain fact,
     not an aggregate with behavior, per ADR-011).

2. **ORM entity**
   - **File**: `libs/core/src/orders/infrastructure/persistence/entities/order-cancellation-signal.orm-entity.ts`
   - **Action**:
     ```ts
     @Entity('order_cancellation_signals')
     @Index(['sourceConnectionId', 'externalOrderId'], { unique: true })
     export class OrderCancellationSignalOrmEntity {
       @PrimaryColumn('uuid', { default: () => 'uuid_generate_v4()' })
       id!: string;

       @Column({ type: 'uuid' })
       sourceConnectionId!: string;

       @Column({ type: 'varchar' })
       externalOrderId!: string;

       @Column({ type: 'timestamptz' })
       cancelledAt!: Date;

       @CreateDateColumn()
       createdAt!: Date;
     }
     ```
   - **Acceptance**: `synchronize`-built test schema (integration harness)
     and the migration (Step 4) produce an identical shape — no drift, since
     neither is asserted against the other automatically here (unlike
     `fulfillment_works`, this table is small enough that a dedicated parity
     spec is not warranted; the existing int-spec in Phase 4 exercises the
     real column names end to end).

3. **Repository implementation**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-cancellation-signal.repository.ts`
   - **Action**: TypeORM `Repository<OrderCancellationSignalOrmEntity>`
     injected via `@InjectRepository`. `record()` issues
     `INSERT INTO "order_cancellation_signals" ("sourceConnectionId",
     "externalOrderId", "cancelledAt") VALUES ($1, $2, $3)
     ON CONFLICT ("sourceConnectionId", "externalOrderId") DO NOTHING`
     (raw parameterized query, matching `markCancelled`'s own idiom — no
     domain-entity round trip needed for a fire-and-forget write).
     `consume()` issues
     `DELETE FROM "order_cancellation_signals" WHERE "sourceConnectionId" =
     $1 AND "externalOrderId" = $2 RETURNING "cancelledAt"`, returning
     `rows[0]?.cancelledAt ?? null`.
   - **Acceptance**: Repository unit spec
     (`order-cancellation-signal.repository.spec.ts`) asserts the exact SQL
     text and parameter order for both methods, mirroring
     `order-record.repository.spec.ts`'s `markCancelled` test style (assert
     on the mocked `Repository.query` call args).

4. **Migration**
   - **File**: `apps/api/src/migrations/1878000000000-create-order-cancellation-signals.ts`
   - **Action**: `CREATE TABLE IF NOT EXISTS "order_cancellation_signals"`
     with columns `id uuid NOT NULL DEFAULT uuid_generate_v4()`,
     `"sourceConnectionId" uuid NOT NULL`, `"externalOrderId" text NOT NULL`,
     `"cancelledAt" TIMESTAMP WITH TIME ZONE NOT NULL`, `"createdAt" TIMESTAMP
     WITH TIME ZONE NOT NULL DEFAULT now()`, `CONSTRAINT
     "PK_order_cancellation_signals" PRIMARY KEY ("id")`, plus
     `CREATE UNIQUE INDEX IF NOT EXISTS
     "UQ_order_cancellation_signals_source_external" ON
     "order_cancellation_signals" ("sourceConnectionId", "externalOrderId")`.
     `down()` drops the index then the table. `CREATE EXTENSION IF NOT
     EXISTS "uuid-ossp"` guard reused (matches `1850000000008`).
   - **Acceptance**: `pnpm --filter @openlinker/api migration:show` lists it;
     `scripts/check-migration-timestamps.mjs` (part of `pnpm lint`) passes —
     `1878000000000` is strictly greater than every timestamp already on
     `main` (core tail `1877000000000`, plugin tail
     `1869000000200`/`1850000000000`).

5. **Wire into `OrdersModule`**
   - **File**: `libs/core/src/orders/orders.module.ts`
   - **Action**: Add `OrderCancellationSignalOrmEntity` to
     `TypeOrmModule.forFeature([...])`; add
     `OrderCancellationSignalRepository` to `providers`; add the token
     binding `{ provide: ORDER_CANCELLATION_SIGNAL_REPOSITORY_TOKEN,
     useExisting: OrderCancellationSignalRepository }`.
   - **File**: `libs/core/src/orders/orders.tokens.ts`
   - **Action**: Add `export const ORDER_CANCELLATION_SIGNAL_REPOSITORY_TOKEN
     = Symbol('OrderCancellationSignalRepositoryPort');` beside the other
     small-table tokens (`ORDER_HOLD_REPOSITORY_TOKEN` etc.).
   - **File**: `libs/core/src/orders/orm-entities.ts`
   - **Action**: Add
     `export { OrderCancellationSignalOrmEntity } from
     './infrastructure/persistence/entities/order-cancellation-signal.orm-entity';`
     with a comment naming the Phase 4 int-spec as the consumer (matches the
     existing convention for every other entry in this file).
   - **Acceptance**: `pnpm --filter @openlinker/api type-check` (or the
     equivalent workspace build) passes; the app boots (an existing
     app-boot int-spec exercises the module graph).

### Phase 2 — `OrderRecordService`: record + consume

**Goal**: Give `OrderIngestionService` a place to record the signal, and make
`persistIncomingSnapshot` apply it transparently through the existing
first-write-wins machinery.

**Steps**:

6. **Interface method**
   - **File**: `libs/core/src/orders/application/interfaces/order-record.service.interface.ts`
   - **Action**: Add, beside `markCancelled`'s doc block:
     ```ts
     /**
      * Durably record that a cancellation arrived for an order OL has not
      * yet ingested (#2069). Called by
      * `OrderIngestionService.handleSourceCancellation` when
      * `getInternalId` resolves nothing. Keyed on
      * (sourceConnectionId, externalOrderId) — see
      * `OrderCancellationSignalRepositoryPort` for why no internal id is
      * minted here. Consumed by `persistIncomingSnapshot` the moment the
      * order is genuinely ingested; first-write-wins, so a redelivered
      * cancel event is a harmless no-op.
      */
     recordEarlyCancellationSignal(
       sourceConnectionId: string,
       externalOrderId: string,
       cancelledAt: Date
     ): Promise<void>;
     ```
   - **Acceptance**: Type-checks against the new implementation in Step 7.

7. **Implementation**
   - **File**: `libs/core/src/orders/application/services/order-record.service.ts`
   - **Action**:
     - Add a 6th constructor parameter:
       `@Inject(ORDER_CANCELLATION_SIGNAL_REPOSITORY_TOKEN) private readonly
       cancellationSignalRepository: OrderCancellationSignalRepositoryPort`.
     - Implement `recordEarlyCancellationSignal` as a direct pass-through to
       `this.cancellationSignalRepository.record(...)`.
     - In `persistIncomingSnapshot`, immediately **after** `const saved =
       await this.repository.upsert(orderRecord);` and the existing
       `warnOnAttributionDivergence` call, add:
       ```ts
       const earlySignalAt = await this.cancellationSignalRepository.consume(
         sourceConnectionId,
         incoming.externalOrderId
       );
       const cancellationWrote = await this.recordCancellationIfNeeded(
         internalOrderId,
         incoming.status === 'cancelled' || earlySignalAt !== null,
         earlySignalAt ?? now
       );
       ```
       replacing the existing `recordCancellationIfNeeded(internalOrderId,
       incoming.status === 'cancelled', now)` call one-for-one. **No other
       line in `persistIncomingSnapshot` changes.**
   - **Acceptance**:
     - `incoming.status !== 'cancelled'` and no signal present →
       `cancellationWrote === false`, no `markCancelled` call, no behavior
       change (regression guard).
     - `incoming.status !== 'cancelled'` and a signal is present →
       `markCancelled(internalOrderId, earlySignalAt)` is called with the
       *signal's* instant, not `now`.
     - `incoming.status === 'cancelled'` (existing case, no signal present)
       → unchanged: `markCancelled(internalOrderId, now)`.

8. **Do not touch `persistOrder`**
   - **Action**: No change. Documented in § 4.1/4.3 above: `persistOrder`'s
     `upsertWithLineItems()` excludes `cancelledAt` from its column list, so
     the value `persistIncomingSnapshot` wrote at Step 2 of
     `syncOrderFromSource` survives Step 5 untouched, and `persistOrder` is
     never called without `persistIncomingSnapshot` having already run in
     the same request.
   - **Acceptance**: Existing `persistOrder`-focused tests in
     `order-record.service.spec.ts` (the `cancellation recorded via
     markCancelled` describe block) pass unmodified.

### Phase 3 — `OrderIngestionService.handleSourceCancellation`

**Goal**: Replace the silent no-op with a durable write; update the two
stale comments the issue names.

**Steps**:

9. **Write the signal on the unknown-order branch**
   - **File**: `libs/core/src/orders/application/services/order-ingestion.service.ts`
   - **Action**: Replace
     ```ts
     if (!internalOrderId) {
       this.logger.warn(
         `Cancellation for unknown order: external ${externalOrderId} on connection ${connectionId} ` +
           `has no internal mapping — nothing to cancel`
       );
       return [];
     }
     ```
     with
     ```ts
     if (!internalOrderId) {
       // #2069: a cancel for an order OL has not yet ingested must still
       // leave a durable trace, or the later create provisions the order as
       // active at every destination. No internal id exists yet, and
       // minting one via getOrCreateInternalId would point every downstream
       // trigger at a phantom order before any real order data arrives (the
       // #2328 lesson for returns attribution) — so the signal is keyed on
       // (sourceConnectionId, externalOrderId) instead, and consumed by
       // OrderRecordService.persistIncomingSnapshot the moment the order is
       // genuinely first ingested. Left unguarded (not try/caught): the only
       // action on this branch is the write, so a DB failure should retry
       // the job rather than be silently swallowed.
       await this.orderRecordService.recordEarlyCancellationSignal(
         connectionId,
         externalOrderId,
         new Date()
       );
       this.logger.warn(
         `Cancellation for unknown order: external ${externalOrderId} on connection ${connectionId} ` +
           `has no internal mapping yet — recorded as a pending cancellation signal so the later ` +
           `create is not provisioned active`
       );
       return [];
     }
     ```
   - **Acceptance**: The unit test at line ~1725 of
     `order-ingestion.service.spec.ts` ("does NOT mark the record cancelled
     when the order was never ingested") is updated (Step 12) to assert
     `recordEarlyCancellationSignal` **is** called, while `markCancelled`
     remains **not** called (order_records still doesn't exist).

10. **Update the JSDoc atop `handleSourceCancellation`**
    - **File**: same file, the method's own doc comment (currently states
      "Resolves the existing internal order; if unknown (never ingested)
      there is nothing to cancel").
    - **Action**: Amend to state the unknown-order branch now durably
      records a signal instead of doing nothing, referencing #2069.

11. **Amend the stale `#1160` "Known residual" comment (AC6)**
    - **File**: same file, near the end of `handleSourceCancellation` (the
      block starting `// Known residual (#1160): a cancel that arrives
      *before* the order's create/sync job has run finds no targets here...`).
    - **Action**: Replace with a note that #2069 closes this residual: the
      unknown-order branch now records a durable signal (Step 9) that
      `persistIncomingSnapshot` consumes (Step 7), and `#2284`'s
      `cancelledAt IS NULL` provisioning guard is what then withholds
      destination creation — so the deferred monotonic/relay-log machinery
      this comment originally pointed at was never needed, exactly as the
      issue's own analysis concluded. State explicitly that the comment is
      corrected rather than merely removed, so a future reader does not
      wonder whether the residual was silently dropped.

### Phase 4 — Comment update on the ORM entity (AC5)

**Steps**:

12. **File**: `libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts`
    - **Action**: Update the `cancelledAt` column's doc comment (currently
      "Indexed for the future exclusion predicate (#1987/#1988: `WHERE
      "cancelledAt" IS NULL`)") to state the predicate has shipped
      (`OrderSyncService.syncOrder`, #2284), and that #2069 closed the
      remaining gap by giving a not-yet-ingested order's cancellation a
      durable home too (`OrderCancellationSignalRepositoryPort`, consumed by
      `OrderRecordService.persistIncomingSnapshot`).

### Phase 5 — Tests

**Steps**:

13. **Unit — `order-ingestion.service.spec.ts`**
    - Update the existing test "does NOT mark the record cancelled when the
      order was never ingested" (line ~1725) to also assert
      `orderRecordService.recordEarlyCancellationSignal` was called with
      `(connectionId, externalOrderId, expect.any(Date))`, while
      `markCancelled` remains uncalled.
    - Add a new test asserting a thrown error from
      `recordEarlyCancellationSignal` **propagates** (is not swallowed),
      unlike the known-order branch's `markCancelled` call — mirroring the
      contrast documented in Step 9's inline comment.
    - Add `recordEarlyCancellationSignal: jest.fn().mockResolvedValue(undefined)`
      to the `orderRecordService` mock object in `beforeEach`.

14. **Unit — `order-record.service.spec.ts`**
    - Add `record: jest.fn()` / `consume: jest.fn().mockResolvedValue(null)`
      to a new `cancellationSignalRepository` mock, injected as the service's
      6th constructor argument in the module-building `beforeEach`.
    - New `describe('recordEarlyCancellationSignal (#2069)', ...)`:
      asserts pass-through to `cancellationSignalRepository.record`.
    - Extend the existing `persistIncomingSnapshot` cancellation tests (or
      add a sibling `describe`) with:
      - `consume` resolves a `Date` and `incoming.status !== 'cancelled'` →
        `markCancelled` is called with **that** date, not `now`.
      - `consume` resolves `null` and `incoming.status !== 'cancelled'` →
        `markCancelled` is not called (regression guard, matches current
        behavior byte-for-byte).
      - `consume` resolves a `Date` **and** `incoming.status === 'cancelled'`
        → `markCancelled` is still called exactly once (no double-write),
        with `cancelledAt` preferring the signal's instant over `now`.

15. **Unit — `order-cancellation-signal.repository.spec.ts`** (new file)
    - Mirrors `order-record.repository.spec.ts`'s `markCancelled` describe
      block: assert the exact `INSERT ... ON CONFLICT DO NOTHING` and
      `DELETE ... RETURNING` statements and parameter order against a mocked
      `Repository.query`.

16. **Integration — new file**
    `apps/api/test/integration/orders/order-early-cancellation-signal.int-spec.ts`
    - Reuses `installAllegroTestSourceStub(harness)`
      (`apps/api/test/integration/helpers/allegro-test-source-stub.helper.ts`)
      for the source side.
    - Registers one minimal inline destination stub via
      `ADAPTER_REGISTRY_TOKEN` + `ADAPTER_FACTORY_RESOLVER_TOKEN`
      implementing `OrderProcessorManagerPort`, whose `createOrder` is a
      `jest.fn()` resolving `{ orderId: 'dest-1' }` — mirrors the `destStub`
      shape in `fulfillment-relay-test-stubs.helper.ts` (minus the
      `FulfillmentStatusReader` sub-capability, which this test doesn't
      need).
    - **Test A — cancel arrives first, then the sync job runs**:
      1. Create the Allegro source connection and the destination connection
         (`OrderProcessorManager`-capable).
      2. Call `ingestion.syncOrderFromSource(sourceConnectionId,
         externalOrderId, 'cancel-evt-1', 'cancelled')`. Assert: result is
         `[]`; no `identifier_mappings` row exists for `(Order,
         externalOrderId, sourceConnectionId)`; a row exists in
         `order_cancellation_signals` for `(sourceConnectionId,
         externalOrderId)`.
      3. `stub.setNextIncomingOrder({ externalOrderId, status: 'pending',
         items: [], totals: {...}, createdAt, updatedAt })` (a non-cancelled
         order — `status: 'pending'` mirrors `OrderStatusValues`' first
         member and needs no status-mapping configuration to validate).
      4. Call `ingestion.syncOrderFromSource(sourceConnectionId,
         externalOrderId, 'create-evt-1')` (no `eventType` — the ordinary
         create path). Assert: the returned `OrderSyncResult[]` contains
         exactly one entry with `status: 'skipped_cancelled'`; the
         destination stub's `createOrder` was **never** called; the
         `order_records` row for the resolved internal id has a non-null
         `cancelledAt`; the `order_cancellation_signals` row is now gone
         (consumed).
    - **Test B — normal ordering unchanged (regression guard)**: same setup,
      but call `syncOrderFromSource` with the create event **first** (no
      prior cancel), non-cancelled `IncomingOrder`. Assert: `createOrder`
      **was** called exactly once; the returned result has
      `status: 'success'`; `order_cancellation_signals` has no row for this
      pair (nothing was ever written).
    - **File**: `apps/api/test/integration/setup.ts`
    - **Action**: Add `'order_cancellation_signals'` to `tablesToTruncate`
      (per `docs/testing-guide.md`, a table must be listed there to be
      cleaned between tests even though the probe skips empty tables cheaply).

---

## 7. Alternatives Considered

### Alternative 1: Mint the internal id in `handleSourceCancellation` via `getOrCreateInternalId`
- **Description**: On the unknown-order branch, call
  `getOrCreateInternalId` to mint the mapping, then insert a minimal stub
  `order_records` row (or extend `markCancelled` to `INSERT ... ON CONFLICT`)
  so `cancelledAt` has somewhere to live.
- **Why Rejected**: Creates a phantom, operator-visible order with no real
  order data before any create ever runs — a stub row would need to satisfy
  every `NOT NULL` column on `order_records` (`orderSnapshot`,
  `recordStatus`, etc.) with placeholder values, and would show up in
  `/orders` and every list/aggregate read that scans the table. This is
  exactly the failure mode #2328 named and rejected for returns attribution.
- **Trade-offs**: Would avoid a new table, but at the cost of a much larger,
  riskier blast radius (every reader of `order_records` now has to reason
  about a possible phantom row) for no benefit over the keyed-signal design.

### Alternative 2: Reuse the existing `connection_cursors` key-value table
- **Description**: Store the signal as a `connection_cursors` row keyed
  `(connectionId, cursorKey='order.earlyCancel:{externalOrderId}')`, value =
  ISO cancellation instant.
- **Why Rejected**: `connection_cursors` is documented and consumed
  throughout the codebase as adapter *sync-position* state ("watermarks"),
  not per-entity facts. Overloading it would (a) mix an unrelated concern
  into a table whose every other consumer assumes "cursor" semantics
  (`findMostRecentUpdate`, `advanceIfGreater`'s monotonic-string precondition
  do not apply here), and (b) require an unbounded number of rows — one per
  ever-cancelled-before-ingestion order — accumulating in a table sized and
  reasoned about as "one row per (connection, cursor kind)" today.
- **Trade-offs**: Saves a migration and a new port/repository, at the cost of
  conflating two genuinely different concepts and complicating every future
  reader of `connection_cursors`.

### Alternative 3: Add a lock around `getOrCreateInternalId` + signal consumption to close the TOCTOU race entirely
- **Description**: Take a per-`(connectionId, externalOrderId)` lock (the
  `SyncLockPort` already used elsewhere in this file) around the
  read-mapping / consume-signal sequence, so the microsecond race described
  in § 8 cannot occur at all.
- **Why Rejected**: The issue's own review comment explicitly found that the
  "deferred monotonic / relay-log machinery" originally invoked to justify
  leaving this open was unnecessary — the fix is "one durable write". Adding
  a new per-order lock for a race window this narrow, on a hot path
  (`syncOrderFromSource` runs on every order poll/webhook), is
  disproportionate to the residual risk it closes, and the residual it
  leaves is materially better than today's bug (self-healing on the next
  poll/webhook, vs. never).
- **Trade-offs**: Would fully close a race that today is unbounded, at the
  cost of new lock contention and complexity on the ingestion hot path. Left
  as a documented, accepted residual (§ 8) rather than implemented.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Hexagonal layering: new port in `domain/ports/`, ORM entity + repository
  in `infrastructure/persistence/`, orchestration in `application/services/`.
- ✅ Domain layer has no framework dependency (the port interface imports
  nothing from `@nestjs/*` or `typeorm`).
- ✅ Repository ports pattern: `OrderRecordService` depends on
  `OrderCancellationSignalRepositoryPort` via a Symbol token, never the
  concrete `OrderCancellationSignalRepository` class.
- ✅ Cross-context dependency rule: no new `@openlinker/core/<ctx>` import in
  either direction; everything is intra-`orders`.

### Naming Conventions
- ✅ `*.port.ts` / `{Capability}Port` naming for the new interface.
- ✅ `*.orm-entity.ts` for the TypeORM entity; `*.repository.ts` for the
  implementation.
- ✅ Token naming `ORDER_CANCELLATION_SIGNAL_REPOSITORY_TOKEN` matches the
  `{CONTEXT}_{INTERFACE}_TOKEN` convention and the Symbol description
  matches the interface name.

### Existing Patterns
- ✅ Mirrors `order_holds` (small side table, no FK, `IF [NOT] EXISTS`
  migration, `synchronize`-parity via a plain integration test rather than a
  dedicated schema-parity spec since the table has three real columns).
- ✅ Mirrors `IdentifierMappingRepository.insertMapping` /
  `OrderHoldRepository`'s `ON CONFLICT DO NOTHING` idiom for first-write-wins
  inserts.
- ✅ Reuses the exact `recordCancellationIfNeeded` → `markCancelled` pipeline
  #1984/#2125 already built and tested, rather than duplicating a second
  cancellation-write code path.

### Risks

- **Residual TOCTOU race** (documented, accepted, out of scope — § 6/7 Alt.
  3): if `handleSourceCancellation`'s `getInternalId` read and the create
  job's `getOrCreateInternalId`/`consume()` sequence interleave at
  microsecond granularity such that `consume()` runs *before* `record()`
  commits, the order is ingested with `cancelledAt = null` and the orphaned
  signal row sits unconsumed. **Mitigation**: this is self-healing — `consume()`
  runs unconditionally on **every** subsequent `persistIncomingSnapshot` call
  for that order (every later poll/webhook), so the very next sync for that
  order applies the signal. The only unrecoverable case is an order that
  genuinely receives no further sync of any kind after this exact race — a
  materially narrower failure mode than today's bug, which never recovers.
- **Orphaned signal rows for orders that are never (re-)ingested**: if a
  cancellation signal is written and the order is truly never synced again
  by that source (rare — most sources either poll or receive further
  webhooks), the row is never consumed. Given the row is tiny (three
  columns, one per rare race occurrence) and this class of "small,
  never-swept side table" already exists elsewhere in the codebase
  (`automation_trigger_firings` is deliberately never pruned per-key), this
  is accepted without a cleanup sweep. If volume ever becomes a concern, a
  scheduled sweep mirroring `DemoAccountCleanupService`'s retention pattern
  is the natural follow-up — explicitly flagged as a **future** issue, not
  part of this plan.
- **External-id reuse after a long gap**: an extremely rare compounding
  scenario (the early-cancel race fires, the signal is never consumed, *and*
  the source later reuses the same `externalOrderId` string for an unrelated
  order on the same connection) could apply a stale cancellation to the
  wrong order. This requires two independently rare events to compound and
  is not addressed here; documented for awareness only.

### Edge Cases
- **Redelivered cancel event for an unknown order** (at-least-once delivery,
  platform-wide invariant): `record()`'s `ON CONFLICT DO NOTHING` makes a
  second `handleSourceCancellation` call for the same
  `(connectionId, externalOrderId)` a no-op — matches `markCancelled`'s own
  first-write-wins semantics.
- **Order later resolves as a destination-echo**: cannot happen for the
  unknown-order branch — see § 4.4.
- **`incoming.status === 'cancelled'` AND a signal exists simultaneously**:
  handled by the single `recordCancellationIfNeeded` call — the signal's
  instant is preferred (it is the more authoritative, dedicated cancel-event
  timestamp) and `markCancelled`'s own `COALESCE` guarantees exactly one
  write regardless of which condition true first.

### Backward Compatibility
- ✅ No breaking change. New table, new port, one new interface method, one
  new branch in an existing private method. Every existing caller of
  `persistIncomingSnapshot`/`persistOrder`/`handleSourceCancellation` is
  unaffected when no signal exists (the overwhelming majority of calls),
  verified by the explicit regression-guard tests in Steps 13/14/16-B.
- No data migration needed — the new table starts empty; there is nothing to
  backfill.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts`
  — updated + new cases per Step 13.
- `libs/core/src/orders/application/services/__tests__/order-record.service.spec.ts`
  — new cases per Step 14.
- `libs/core/src/orders/infrastructure/persistence/repositories/__tests__/order-cancellation-signal.repository.spec.ts`
  — new file per Step 15.

### Integration Tests
- `apps/api/test/integration/orders/order-early-cancellation-signal.int-spec.ts`
  — new file per Step 16, against the real Postgres Testcontainer harness.

### Mocking Strategy
- Unit tests mock `OrderCancellationSignalRepositoryPort` and
  `IOrderRecordService` exactly as the existing surrounding tests already
  mock their neighbors (`markCancelled`, `getOrderRecord`, etc.) — no new
  mocking pattern introduced.
- The integration test mocks only the two external-boundary ports
  (`OrderSourcePort`, `OrderProcessorManagerPort`) via the established
  `AdapterRegistryService` + `AdapterFactoryResolverService` test seam; every
  core layer (identifier mapping, order records, the new signal table) runs
  for real against Postgres.

### Acceptance Criteria (mapped 1:1 to the issue's remaining checklist)
- [ ] A cancel for a not-yet-ingested order persists something the later
      create can observe — `OrderCancellationSignalRepositoryPort.record`,
      wired into `handleSourceCancellation`'s unknown-order branch (Step 9).
- [ ] Integration test: cancel first, then sync — assert no destination
      order is created (Step 16, Test A).
- [ ] Integration test: normal ordering unchanged (Step 16, Test B).
- [ ] The `#1987/#1988: future exclusion predicate` comment on the ORM
      entity is updated (Step 12).
- [ ] The `#1160` residual comment is removed or amended (Step 11 — amended,
      with the reasoning for why the previously-invoked machinery was never
      needed, per the issue's own retitling comment).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries (no integration-layer change)
- [x] Uses existing patterns (`order_holds`-shaped side table,
      `ON CONFLICT DO NOTHING` idiom, existing `markCancelled` pipeline —
      no unnecessary new abstraction)
- [x] Idempotency considered (`record()` first-write-wins;
      `consume()` at-most-once via `DELETE ... RETURNING`;
      `markCancelled` already first-write-wins)
- [x] Event-driven patterns used where applicable (webhook = trigger, poll =
      reconciliation backstop — the self-healing property in § 4.3 relies on
      exactly this existing pattern)
- [x] Rate limits & retries addressed (n/a — no external call added; the one
      new write is left unguarded specifically so a DB failure retries the
      job, per Step 9's reasoning)
- [x] Error handling comprehensive (see § 8 Risks + Edge Cases)
- [x] Testing strategy complete (§ 9)
- [x] Naming conventions followed (§ 8)
- [x] File structure matches standards (§ 6)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — § Orders,
  § Cross-context dependencies in core
- [Engineering Standards](../engineering-standards.md) — Repository Ports
  Pattern, Symbol DI Token Re-export Convention
- [Database Migrations Guide](../migrations.md) — timestamp convention
- [Testing Guide](../testing-guide.md) — Testcontainers harness,
  `tablesToTruncate`
- Prior plan: `implementation-plan-order-cancellation-record-state.md`
  (#1984 — the machinery this plan builds on)
- GitHub issue: [#2069](https://github.com/openlinker-project/openlinker/issues/2069)
