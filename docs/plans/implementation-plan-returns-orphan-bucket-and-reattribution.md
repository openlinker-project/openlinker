# Implementation Plan: Orphan return bucket, downstream-trigger block and re-attribution reconcile (#2332)

**Date**: 2026-08-25
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Issue**: #2332 (`W1c-5`), epic #2337, design of record ADR-060 + `DESIGN-oms-authority-model.md` § 7.2–7.3

---

## 1. Task Summary

**Objective**: make "OL could not attribute this return to an order" a first-class,
visible, *inert* state — countable in an orphan bucket, refused by every downstream
trigger, and self-healing once the order is ingested.

**Context**: `ReturnRecord.internalOrderId` is nullable by design (#2327): a parcel can
be on its way for an order OL has never seen. #2328 persists such a return as an orphan
and #2330 feeds them in. Nothing yet **counts** them, nothing **blocks** on them, and
nothing **re-attributes** them. Wave 2's restock / refund-trigger / correction-proposal
would otherwise move stock, money or a fiscal document against an order OL cannot name —
which is the exact failure the nullable column exists to prevent.

**Classification**: CORE (domain + application + infrastructure) with a worker
`jobs`-role handler and one scheduler entry.

---

## 2. Scope & Non-Goals

### In Scope
- `ReturnRecord.isOrphan()` — pure read-only derivation (ADR-011).
- A persisted `returns.externalOrderId` column + partial index (**see § 5 O1** — the
  issue assumed this value was already stored; it is not).
- `ReturnBucket` vocabulary (`orphan | attributed`) + coercion guard, and an orphan
  **count** on the repository + service.
- `ReturnDownstreamTrigger` vocabulary + `ReturnNotAttributedError` /
  `ReturnNotFoundError`, and one service-level guard every Wave-2 trigger calls.
- A bounded, resumable, per-connection re-attribution reconcile: repository reads +
  conditional-UPDATE claim, a `ReturnReattributionService`, the
  `returns.orphan.reconcile` job type + payload, worker handler + lane registration,
  and one capability-scoped scheduler entry.

### Out of Scope
- The HTTP read API and its `?bucket=orphan` query parameter — **#2334**. This slice
  ships the core vocabulary + count the controller mounts; it adds no controller.
- The orphan-bucket FE list — **#2335**.
- Wave-2 trigger *implementations* (restock, refund trigger, correction proposal). Only
  the guard they must call ships here. AC "spec per trigger seam, including the Wave-2
  seams that exist only as interfaces today" resolves to: **no such interface exists on
  this branch**, so the guard is specced once, per trigger *value*, over the single seam
  (see § 9).
- Manual operator re-attribution ("attach this return to that order" by hand).
- The HTTP mapping for `ReturnNotAttributedError` — **#2334 hand-off**. Nothing in this
  slice mounts a controller, so the error is unmapped here; an unmapped domain error
  surfaces as a 500, and #2334 owns the filter that makes it a 409.
- Any change to ingestion's write path other than carrying `externalOrderId` through.

### Constraints
- `returns` must never import back into `orders`; the one-way edge is asserted by the
  module + port docblocks.
- Ingestion must not become able to fail because of reconcile — see § 6 Phase 4.
- Attribution stays **monotonic**: nothing in this slice may blank a resolved
  `internalOrderId`.

---

## 3. Architecture Mapping

**Target layer**: `libs/core/src/returns/{domain,application,infrastructure}`,
`libs/core/src/sync/domain/types` (job type + payload), `apps/worker/src/sync/*`
(handler + lane), `apps/worker/src/scheduler/scheduler.service.ts` (capability task),
`apps/api/src/migrations` (one migration).

**Capabilities involved**: none new. The reconcile pass touches **no adapter** — it is a
pure OL-store operation (`identifier_mappings` lookup + a local UPDATE). The scheduler
entry is gated on `OrderSource` only to scope *which connections* have returns at all.

**Existing services reused**: `IIdentifierMappingService.getInternalId` (already a
`ReturnsModule` edge, #2328), `ConnectionCursorRepositoryPort` (the scan-offset
mechanism `MarketplaceReturnsStatusSyncHandler` uses verbatim), `SyncJobHandlerRegistry`
lanes (ADR-050).

**New components**: two `*.types.ts` vocabulary leaves, two domain exceptions, five
repository methods, one application service (+ interface + token), one job payload type,
one worker handler, one migration.

**Core vs Integration justification**: re-attribution reads OL's own
`identifier_mappings` and writes OL's own `returns` row. No marketplace is asked
anything. Putting it in an integration would give every plugin its own copy of a rule
that is not platform-shaped.

---

## 4. Domain research

### The gap the issue's assumption papers over (**O1, load-bearing**)

The issue states re-attribution is *"keyed on the source order id **already stored on the
record**"*. It is not:

- `ReturnOrmEntity` has **no** `externalOrderId` column (#2327).
- `ReturnsService.buildRawPayload` enumerates `raw`, `referenceNumber`,
  `isTerminalAtSource`, `buyerEmail`, `marketplaceId` and per-line extras — and
  **omits** `observation.externalOrderId`.

So today the value is consumed once, in `resolveInternalOrderId`, and discarded. A
reconcile pass has literally nothing to key on. Options considered in § 7; the plan adds
a real column.

### Internal patterns followed

| Concern | Precedent copied |
|---|---|
| Bounded, resumable, scan-offset pass | `MarketplaceReturnsStatusSyncHandler` (#2330) / `MarketplaceOfferStatusSyncHandler` (#816) |
| Conditional-UPDATE claim (`WHERE … IS NULL`, `affected > 0`) | `ShipmentRepository.claimWaybillRelay` (#1947) |
| Capability-scoped host scheduler entry | `master-product-reconcile` / `regulatory-status-reconcile` in `scheduler.service.ts` |
| Pure entity derivation | `RefreshToken.isActive` (ADR-011) |
| `as const` vocabulary leaf + guard | `ReturnOriginValues`, `SalesDocumentAttentionReasonValues` |
| Best-effort per-item loop with counters | `ReturnStatusSyncService` (#2330) |

---

## 5. Questions & Assumptions

### Open questions
- **Q1** — Should the orphan count be connection-scoped as well as global? #2334's read
  API will want a global attention number; a per-connection breakdown is speculative.
  **Resolved in plan**: `countOrphans()` is global (matches `listOrphans`, which is
  already connection-agnostic). A connection filter is additive later.

### Assumptions
- **A1 (O1)** — Adding `returns.externalOrderId` is in scope for this issue even though
  the issue body assumed it existed. Without it the third acceptance criterion is
  unimplementable. Recorded here rather than deferred.
- **A2** — `externalOrderId` is applied with `COALESCE` on the upsert's UPDATE half, not
  latest-wins like `rawStatus`. A source that stops naming the order has not made the
  return belong to a different order; blanking the value would destroy the only
  re-attribution key for no gain. Insert-half writes it plainly.
- **A3** — Backfill is **not** attempted for rows written before this migration. Their
  source order reference was never persisted anywhere, so there is nothing to backfill
  from; those orphans stay orphaned until an operator resolves them or the source
  re-sends the return (the sweep re-upserts, which fills the column in). Stated in the
  migration docblock, not silently carried.
- **A4** — The reconcile task ships **default-ON** (`enabledDefault` unset ⇒ true). It
  makes no platform call and its worst case is a bounded local read that resolves
  nothing; the two #2330 ingestion tasks are opt-in because they *do* call a marketplace.
- **A5** — `ReturnDownstreamTriggerValues = ['restock', 'refund', 'invoice_correction']`
  matches DESIGN § 7.3's three named downstream flows exactly. A fourth value is a
  Wave-2 edit, not a shape change.

### Documentation gaps
- ADR-060 mentions the orphan bucket and the block but specifies neither the guard's
  shape nor the reconcile's keying. This plan is the first statement of both; the
  architecture-overview § *Returns* bullet is updated in Phase 5.

---

## 6. Proposed Implementation Plan

### Phase 1 — Persist the re-attribution key (schema)

1. **Add `externalOrderId` to the ORM entity**
   - **File**: `libs/core/src/returns/infrastructure/persistence/entities/return.orm-entity.ts`
   - **Action**: `@Column({ type: 'text', nullable: true }) externalOrderId!: string | null;`
     plus a class-level partial index with the migration's exact name:
     `@Index('IDX_returns_orphan_reattribution', ['sourceConnectionId', 'createdAt'], { where: '"internalOrderId" IS NULL AND "externalOrderId" IS NOT NULL' })`.
     The docblock states *why* the column exists (it is the reconcile key, and it is the
     source's own value — never an OL id) and that it is nullable because a source may
     report no order at all.
   - **Acceptance**: `synchronize`-built test schema and the migration agree on the index
     name (the #2327 rule).

2. **Migration `1847000000000-add-return-external-order-id.ts`**
   - **File**: `apps/api/src/migrations/1847000000000-add-return-external-order-id.ts`
   - **Action**: `ADD COLUMN IF NOT EXISTS "externalOrderId" text`; `CREATE INDEX IF NOT
     EXISTS "IDX_returns_orphan_reattribution" ON "returns" ("sourceConnectionId",
     "createdAt" DESC) WHERE "internalOrderId" IS NULL AND "externalOrderId" IS NOT
     NULL`. `down()` drops both. Docblock records **A3** (no backfill, and why).
   - **Acceptance**: `pnpm lint` (timestamp invariant: 1846 is the current tail on this
     branch, `1841000000006` on `origin/main`, so 1847 is strictly greater than both);
     `migration:show` lists it.

3. **Carry the value through domain + ingestion**
   - **Files**: `domain/entities/return-record.entity.ts` (constructor parameter, placed
     immediately after `internalOrderId` so the two attribution facts read together),
     `domain/types/return.types.ts` (`CreateReturnRecordInput.externalOrderId`),
     `domain/types/return-upsert.types.ts` (`UpsertReturnRecordInput.externalOrderId`),
     `infrastructure/.../return.repository.ts` (`create`, `upsertHeader` INSERT column
     list + `COALESCE` UPDATE clause per **A2**, `toDomain`),
     `application/services/returns.service.ts` (pass `observation.externalOrderId`).
   - **The positional-constructor trap, and the spec that closes it**:
     `externalReturnId`, `internalOrderId` and the new `externalOrderId` are three
     ADJACENT `string | null` parameters, so a mis-ordered `toDomain` **type-checks and
     is silently wrong** — `tsc` proves only the arity. The acceptance criterion is
     therefore a repository round-trip spec that writes three DISTINCT values and asserts
     each lands on its own field; "fixtures gain the field" does not catch it.
   - **Acceptance**: the three-distinct-values round-trip above; existing
     `returns.service.spec.ts` / `return.repository.spec.ts` still green; a new repository
     spec asserts the `COALESCE` behaviour (a later observation with
     `externalOrderId: null` does not blank a stored value).

### Phase 2 — The orphan bucket

4. **`ReturnRecord.isOrphan()`**
   - **File**: `domain/entities/return-record.entity.ts`
   - **Action**: `isOrphan(): boolean { return this.internalOrderId === null; }` — pure,
     synchronous, no parameters, reads only its own field (ADR-011's bounded allowance).
     Docblock: this is the ONE definition of orphan; every consumer (guard, count SQL
     predicate, #2334's DTO) derives from `internalOrderId IS NULL` and nothing invents
     a second rule.
   - **Acceptance**: entity spec covers both branches.

5. **`ReturnBucket` vocabulary**
   - **File**: `domain/types/return-bucket.types.ts` (new)
   - **Action**: `ReturnBucketValues = ['orphan', 'attributed'] as const`, the derived
     type, and `isReturnBucket(value: string): value is ReturnBucket` — the pure-rule
     exception to "types only" (engineering-standards § *The pure-rule exception*: the
     guard IS the coercion rule for the union it sits with). Exported from the barrel so
     #2334's DTO validates `?bucket=` against it rather than restating two literals.
   - **Acceptance**: guard spec; barrel export present.

6. **Orphan count**
   - **Files**: `domain/ports/return-repository.port.ts` (`countOrphans(): Promise<number>`),
     `infrastructure/.../return.repository.ts` (`this.returns.count({ where: { internalOrderId: IsNull() } })`
     — the same predicate `listOrphans` uses, and the same `IDX_returns_orphans` partial
     index), `application/services/returns.service.interface.ts` +
     `returns.service.ts` (`countOrphanReturns()`).
   - **Acceptance**: repository spec asserts the count matches a seeded mix.

### Phase 3 — The downstream-trigger block

7. **Trigger vocabulary**
   - **File**: `domain/types/return-trigger.types.ts` (new)
   - **Action**: `ReturnDownstreamTriggerValues = ['restock', 'refund', 'invoice_correction'] as const`
     + derived type (**A5**). Docblock names each Wave-2 flow and states the rule: a new
     downstream flow adds a value here and calls the guard; it does **not** invent its own
     orphan check.

8. **Domain exceptions**
   - **Files**: `domain/exceptions/return-not-attributed.error.ts`,
     `domain/exceptions/return-not-found.error.ts` (new)
   - **Action**: `ReturnNotAttributedError(returnId, trigger)` carrying both as readonly
     fields (so an HTTP filter can map it without string-parsing), message naming the
     trigger and stating the remedy ("attribute the return to an order first"), and
     `Error.captureStackTrace` per the standards' exception shape. **Both are exported
     from the barrel**, alongside `ReturnDownstreamTriggerValues` / the derived type —
     a Wave-2 trigger that cannot import the error cannot catch it, and #2334 cannot map
     it to a status code.
     `ReturnNotFoundError(returnId)` alongside it: the guard reads the row, and "no such
     return" and "orphan return" are different operator situations that must not collapse.

9. **The guard**
   - **Files**: `application/services/returns.service.interface.ts`, `returns.service.ts`
   - **Action**:
     ```ts
     assertAttributedForTrigger(
       returnId: string,
       trigger: ReturnDownstreamTrigger
     ): Promise<ReturnRecord>;
     ```
     Implementation: `findById` → `ReturnNotFoundError` when absent →
     `record.isOrphan()` → `ReturnNotAttributedError` → return the hydrated record.
   - **Three properties the docblock must state, because each is a decision**:
     1. **It re-reads the row.** A caller's in-memory `ReturnRecord` may predate a
        reconcile that has since attributed it (or, in the other direction, be a
        `upsertFromSource` result whose OL-owned timestamps are deliberately blanked).
        The row is the authority — the same rule `UpsertReturnObservationResult.attributed`
        already states.
     2. **It returns the record.** A trigger needs the aggregate anyway; making the guard
        the read means a caller cannot accidentally act on a *different* read than the one
        it checked.
     3. **It throws rather than returning a boolean.** A boolean is ignorable; the whole
        point is that a downstream trigger cannot proceed by omission. `restock` moving
        stock against a phantom order is not recoverable by a later log line.
   - **Acceptance**: spec per trigger value (three cases) asserting the throw, one
     asserting the pass-through for an attributed return, one asserting
     `ReturnNotFoundError` for a missing id.

### Phase 4 — The re-attribution reconcile

10. **Repository reads + claim**
    - **Files**: `domain/types/return-reattribution.types.ts` (new — the candidate
      projection and the pass's result shape), `domain/ports/return-repository.port.ts`,
      `infrastructure/.../return.repository.ts`
    - **Action**:
      - `findOrphansForReattribution(sourceConnectionId, limit, offset): Promise<ReturnReattributionCandidate[]>`
        — projection `{ id, externalOrderId }` (non-nullable in the type; the WHERE
        excludes NULL, because a return the source never attached to an order has nothing
        to resolve BY and would be re-scanned forever). Ordered `createdAt DESC, id ASC` —
        deterministic, so the scan offset means the same thing between runs, and
        newest-first because a *recent* orphan is the one whose order is most likely to
        arrive imminently. The docblock must **state the divergence from
        `findForSourceSweep`, which orders oldest-first** — the two queries sit beside
        each other, and an unexplained difference reads as one of them being a mistake. Headers-projection only, no lines (the pass renders nothing).
      - `countOrphansForReattribution(sourceConnectionId): Promise<number>` — the same
        WHERE, for cursor wrap. Separate method for the reason `countForSourceSweep` is
        separate from `findForSourceSweep`, and built from **one shared private query
        builder** so page and total can never diverge.
      - `claimAttribution(id, internalOrderId): Promise<boolean>` — conditional UPDATE
        `SET "internalOrderId" = $2, "updatedAt" = now() WHERE "id" = $1 AND
        "internalOrderId" IS NULL`, answering `affected > 0`. The `IS NULL` arm is the
        serialization point against a concurrent `upsertFromSource` and is what keeps
        attribution monotonic: this method can fill the value and can never change one.
    - **Acceptance**: repository spec covers the claim's two outcomes (fresh orphan →
      `true`; already-attributed row → `false` **and value unchanged**).

11. **`ReturnReattributionService`**
    - **Files**: `application/services/return-reattribution.service.interface.ts`,
      `application/services/return-reattribution.service.ts`,
      `returns.tokens.ts` (`RETURN_REATTRIBUTION_SERVICE_TOKEN`), `returns.module.ts`,
      `index.ts`
    - **Action**: `reconcile(connectionId, options): Promise<ReturnReattributionResult>`
      where options are `{ limit, offset }` and the result is
      `{ scanned, reattributed, alreadyAttributed, unresolved, failed, nextOffset, total }`.
      Per candidate:
      `getInternalId(CORE_ENTITY_TYPE.Order, candidate.externalOrderId, connectionId)`;
      `null` ⇒ `unresolved++` (the ordinary case — the order genuinely is not ingested
      yet); a value ⇒ `claimAttribution`, `reattributed++` on `true` and
      **`alreadyAttributed++`** on `false`.
    - **Four counters, not three — the lost race gets its own.** Counting a lost claim
      race as `unresolved` states the one thing that is false: `unresolved` means "OL
      still cannot name the order", and a peer winning the race means the opposite. An
      operator reading `unresolved: 5` must be able to believe five returns are still
      orphaned.
    - **The catch is NARROW, and that is the load-bearing part.**
      `IIdentifierMappingService.getInternalId` throws when the CONNECTION does not
      resolve — `ReturnsService.resolveInternalOrderId` documents that exact case and
      deliberately leaves it uncaught, because a connection deleted mid-run is a real
      failure the job must surface. A blanket per-candidate catch would launder it into
      `failed: N` on every page, every tick, forever, with nothing above `warn`. So the
      catch wraps **only the per-row write** (`claimAttribution`) and any row-shaped
      fault; a connection-resolution throw propagates out of the loop into the handler's
      `SyncJobExecutionError`. Same rule as the sibling service, for the same reason.
      `nextOffset` wraps to 0 at `total`, exactly like `ReturnStatusSyncService`.
    - **Why its own service, not a method on `ReturnsService`**: #2330 gave each pass its
      own service (`ReturnIngestionService`, `ReturnStatusSyncService`) and this is the
      third pass. `ReturnsService` stays the aggregate's seam; a pass is a pass.
    - **Acceptance**: unit spec covering — all-unresolved page, a successful
      re-attribution, a lost claim race counted `alreadyAttributed` (neither `unresolved`
      nor `failed`), a throwing per-row write counted `failed` with the loop continuing,
      a throwing connection resolution PROPAGATING rather than being counted, and offset
      wrap.

12. **Job type + payload**
    - **Files**: `libs/core/src/sync/domain/types/sync-job.types.ts`
      (`'returns.orphan.reconcile'` — namespaced `returns.*` rather than `marketplace.*`
      because the pass contacts no marketplace; the comment block above the three #2330
      types is extended to say so),
      `libs/core/src/sync/domain/types/returns-job-payloads.types.ts`
      (`ReturnsOrphanReconcilePayloadV1 { schemaVersion: 1; limit?: number; cursorKey?: string }`).
    - **Acceptance**: type-check; the boot lane assertion (next step) covers the new
      member.

13. **Worker handler + lane**
    - **Files**: `apps/worker/src/sync/handlers/returns-orphan-reconcile.handler.ts` (new),
      `apps/worker/src/sync/handlers/handler-registration.service.ts`,
      `apps/worker/src/sync/sync-worker.module.ts`
    - **Action**: copy `MarketplaceReturnsStatusSyncHandler`'s shape verbatim — payload
      coercion with defaults (`limit` 100, `cursorKey`
      `'returns.orphanReattribution.scanOffset'`), read offset from
      `ConnectionCursorRepositoryPort`, delegate, log the counters, **persist
      `nextOffset` only after a successful call**, wrap a throw in
      `SyncJobExecutionError`. Registered in the **`bulk`** lane: it is background
      catch-up work whose starvation costs nothing time-critical, and it must not
      contend with `realtime` order ingestion — which is precisely the pass that will
      *resolve* its orphans (ADR-050's cost-of-starvation rule).
    - **Acceptance**: `assertFullLaneCoverage` passes at boot (it fails loudly if the new
      `JobTypeValues` member has no lane); handler spec in the existing
      `__tests__/returns-handlers.spec.ts` covering cursor read → delegate → cursor write
      and the no-write-on-throw path.

14. **Scheduler entry**
    - **File**: `apps/worker/src/scheduler/scheduler.service.ts`
    - **Action**: one entry in the capability-task table — `taskId:
      'returns-orphan-reconcile'`, `jobType: 'returns.orphan.reconcile'`, `capability:
      'OrderSource'`, `enabledEnvVar: 'OL_RETURNS_ORPHAN_RECONCILE_ENABLED'`,
      `cronEnvVar: 'OL_RETURNS_ORPHAN_RECONCILE_CRON'`, `defaultCron: '*/30 * * * *'`,
      idempotency key `returns:{connectionId}:orphan:reconcile:{timestamp}`. Default-ON
      per **A4**. Comment states the capability gate is a *scoping* choice (only an
      order source has returns), not a dispatch requirement — the pass resolves no
      adapter at all.
    - **Also**: document both env vars in `apps/worker/.env.example`.
    - **Acceptance**: scheduler spec/table remains consistent; task appears once.

15. **"Never fails ingestion" — asserted structurally**
    - The reconcile is its own job type, on its own lane, on its own cron, reached
      through its own service. **No ingestion path calls it**, so it cannot fail one.
      Within the pass, every per-candidate error is caught. The interface docblock states
      this explicitly so a later change that calls `reconcile()` from
      `upsertFromObservation` is recognisably a contract break rather than a refactor.
    - **Acceptance**: a spec asserting `ReturnsService.upsertFromObservation` succeeds
      with a reattribution service that throws on every call is *not* written — there is
      no such dependency, and writing one would imply the coupling exists. Instead the
      unit spec on the pass asserts the catch-per-candidate behaviour, and the docblock
      carries the rule.

### Phase 5 — Documentation

16. **Update the returns bullet in `docs/architecture-overview.md`** (§ Core Bounded
    Contexts) with: the orphan bucket + count, the guard and its named error, the
    reconcile's keying and cadence, and the **A2/A3** decisions. Tick #2332 in the epic
    checklist mirror inside `docs/plans/oms-progress-ledger.md`.

---

## 7. Alternatives Considered

### Alt 1 — Store the source order id in `rawPayload` instead of a column
Rejected. The reconcile's driving query is *"orphans on this connection that carry a
source order reference"*; against `jsonb` that is either a sequential scan of the whole
table per tick or a second, expression-based index that is strictly more machinery than
the column it emulates. It would also make the field invisible to the read API (#2334)
and to any future manual-attribution UI.

### Alt 2 — Re-resolve on every `upsertFromSource` and drop the reconcile
Rejected. It only heals a return the source happens to re-report. Allegro's pass-2 sweep
is age-bounded (`openedSince`) and status-bounded, so a return whose source status went
terminal — or whose order was ingested a week later — is never re-read and stays orphaned
forever. The issue asks for a background pass precisely because ingestion cannot be the
trigger. (Note the reconcile is nonetheless *complementary*: re-ingestion still
COALESCE-fills attribution, which is why the claim is `WHERE … IS NULL`.)

### Alt 3 — A boolean `isAttributed()` check each Wave-2 trigger calls itself
Rejected. Three call sites each free to forget the branch, and forgetting is silent. A
throwing guard on the service makes "I did not check" unrepresentable.

### Alt 4 — Add an `isOrphan` **column** kept in sync with `internalOrderId`
Rejected. Two representations of one fact, and every write path becomes able to desync
them. `internalOrderId IS NULL` is already indexed for exactly this
(`IDX_returns_orphans`).

---

## 8. Validation & Risks

### Architecture compliance
- ✅ Domain layer stays framework-free (entity method is pure; both new `*.types.ts`
  import nothing).
- ✅ Repository port widened rather than a second port invented (the #2328/#2330 rule
  stated on the port docblock).
- ✅ Service implements a separate `I*Service` interface file; token in
  `returns.tokens.ts`; `export *` from the sub-barrel.
- ✅ No new cross-context edge. `returns → identifier-mapping` already exists.
- ✅ CORE ↔ Integration untouched — no adapter, no manifest, no capability.

### Risks
- **R1 — The migration adds a column to a table an in-flight sibling (#2333/#2334) also
  touches.** Mitigation: additive `ADD COLUMN IF NOT EXISTS`; the timestamp is claimed
  and reported to the orchestrator so a sibling picks 1848.
- **R2 — Scan-offset skew.** If a claim succeeds mid-page, the row leaves the filtered
  set and later rows shift down by one, so the next offset can skip a candidate.
  Accepted, and it is the same property `findForSourceSweep` has: the offset wraps, so a
  skipped row is picked up on the next cycle. Newest-first ordering means the skip window
  is the tail of history, not the head. Recorded in the repository docblock rather than
  papered over.
- **R3 — A very large orphan population makes the count a full partial-index scan every
  read.** Bounded by the partial index and by the fact that on a healthy install orphans
  are a vanishing fraction (the #2327 docblock's own premise).
- **R4 — Default-ON adds a cron per `OrderSource` connection on upgrade.** Cost is one
  bounded local query per connection per 30 min with no platform call. `enabledEnvVar`
  turns it off.

### Backward compatibility
- ✅ Additive throughout. `ReturnRecord`'s constructor gains a parameter — an internal,
  non-exported-construction shape (only the repository constructs it), and type-check
  catches every site.

---

## 9. Testing Strategy & Acceptance Criteria

**Unit** (`libs/core/src/returns/**/*.spec.ts`):
- `return-record.entity.spec.ts` — `isOrphan()` both branches.
- `return-bucket.types.spec.ts` — guard accepts both members, rejects anything else.
- `returns.service.spec.ts` — `assertAttributedForTrigger` throws
  `ReturnNotAttributedError` for **each** of the three trigger values (the AC's
  "spec per trigger seam"), passes through an attributed return, throws
  `ReturnNotFoundError` for a missing id; `countOrphanReturns` delegates.
- `return-reattribution.service.spec.ts` — the five cases in Phase 4 step 11.
- `return.repository.spec.ts` — `countOrphans`, the reattribution page/count pair, the
  claim's two outcomes, and the `externalOrderId` COALESCE.

**Worker** (`apps/worker/src/sync/handlers/__tests__/returns-handlers.spec.ts`): cursor
read → delegate → cursor write; no cursor write when the service throws.

**Integration**: no new int-spec — the pass touches no HTTP surface and no adapter, and
#2334's read API is where one earns its cost. The EXISTING suite is still run, because
the harness builds its schema by `synchronize` and a decorator/entity fault in the new
column or index surfaces there and nowhere else.

### Acceptance criteria (from the issue)
- [ ] An unattributable return persists with `internalOrderId = null` and appears in the
      orphan count — `countOrphans` + `isOrphan()`.
- [ ] Every downstream trigger raises the named domain error while orphaned — one guard,
      specced per trigger value.
- [ ] The reconcile pass re-attributes once the order exists and is a no-op otherwise.
- [ ] The reconcile pass never fails ingestion — structural (§ 6 step 15).
- [ ] Tests added or updated for non-trivial logic.
- [ ] No architecture boundary violations.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (scan-offset sweep, conditional-UPDATE claim, capability task)
- [x] Idempotency considered (claim is `WHERE … IS NULL`; job idempotency key per minute)
- [x] Event-driven patterns — none needed; nothing subscribes (the #2328 rule)
- [x] Rate limits & retries — no external call; retries are the runner's
- [x] Error handling comprehensive (two named domain errors; per-candidate catch)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready

---

## Related Documentation

- ADR-060 — returns aggregate above the source projection
- `docs/plans/analysis/DESIGN-oms-authority-model.md` § 7.2–7.3
- `docs/architecture-overview.md` § Core Bounded Contexts
- `docs/engineering-standards.md` § The pure-rule exception, § Symbol DI Token Re-export
