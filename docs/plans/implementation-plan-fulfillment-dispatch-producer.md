# Implementation Plan: the first (and only) producer of `fulfillment.work.dispatch`

**Issue**: #2955
**Date**: 2026-09-07
**Status**: Ready for Review
**Estimated Effort**: ~0.5 day

---

## 1. Task Summary

**Objective**: give `fulfillment.work.dispatch` a producer, so a router-created
`FulfillmentWork` actually reaches its holder and moves `unsubmitted -> submitted
-> accepted`.

**Context**: everything downstream of that job exists and is test-exercised —
the `JobTypeValues` entry, the `realtime`-lane registration, `FulfillmentHandshakeService`
with its `assignmentAttempt` claim (#2399), and `OlFulfillmentExecutorAdapter`'s
auto-accept (#2409). **Nothing enqueues it.** Since #2408 wired the router,
`RoutingCommitService` creates `fulfillment_works` rows that never leave
`unsubmitted`, so the pack bench — which filters on `BENCH_WORK_REQUEST_STATUSES`
(accepted, not closed) — stays permanently empty on a routed install, and Wave
3a's exit criterion (#2412, *"works the resulting tasks to shipped"*) is
unreachable.

**Classification**: CORE (a pure derivation in the `fulfillment` leaf) + App
(two thin host call sites).

### Investigation result (recorded, because the issue asks for it)

The issue says #2869's M8 *"claims to be this first producer"*. **#2869's manual
bench routing did not ship** — only #2905 (Wave 3b pack bench) did. Repo-wide
grep for `fulfillment.work.dispatch` against `main` at `e3d9604ed` finds only:

- the job-type entry (`libs/core/src/sync/domain/types/sync-job.types.ts:189`)
- the payload type (`fulfillment-job-payloads.types.ts`)
- the handler + its registration + its spec
- one doc comment in `libs/oms/src/oms.plugin.ts`
- `apps/api/test/integration/fulfillment-router-wiring.int-spec.ts:49`, which
  says in as many words that the job *"deliberately has zero producers in the tree"*

So this is **outcome A: no producer exists**, and this issue builds it.

---

## 2. Scope & Non-Goals

### In scope
- Widen `RoutingCommitOutcome`'s `routed` arm to carry each created work's holder.
- A pure derivation in the `fulfillment` leaf: which work rows are dispatchable,
  and under what enqueue dedupe key.
- Two thin host call sites that hand those intents to `SyncJobQueuePort`.
- Unit coverage for the derivation and both call sites.

### Out of scope (stated by the issue)
- Any change to `FulfillmentHandshakeService` or the `assignmentAttempt` claim.
- ADR-054's timeout-as-rejection sweep for `submitted` work whose holder never
  answers (named, issue-less).
- A cancellation job type.
- The re-source loop that consumes a blocking rejection (#2395's).

### Constraints
- `fulfillment` is a registered **zero-sibling-edge leaf**
  (`ZERO_SIBLING_EDGE_LEAVES` in `barrel-purity.spec.ts`, allow-set =
  `@openlinker/core/fulfillment-authority` only), so it may **not** import
  `SyncJobQueuePort` from `@openlinker/core/sync`. `scripts/check-no-injection-contracts.mjs`
  enforces the sibling prohibition independently.
- No new job type, so no lane declaration and no `assertFullLaneCoverage` change.

---

## 3. The three design questions this issue owns

### Q1 — which host enqueues it?

`RoutingCommitService.route()` is reached from exactly two places:

| Call site | Status on `main` |
|---|---|
| `OrderIngestionService.interceptFulfillmentRouting` (`libs/core/src/orders`) | **LIVE** — calls it inline during ingestion |
| `FulfillmentWorkRouteHandler` (`apps/worker`) | dead — `fulfillment.work.route` has zero producers of its own |

**Answer: ONE derivation body, two thin call sites.** The derivation
(`deriveFulfillmentDispatchIntents`) lives once, in the leaf; each call site maps
its intents onto `EnqueueJobRequest` and calls `enqueueBulk`. That is the honest
reading of *"one producer, not two"* — one implementation of the decision, and
the I/O split forced by the leaf rule, exactly as #2399 forces the executor and
ship-to to arrive as arguments.

Three things make two call sites safe rather than the two-bodies hazard:

1. **The hazard is two routing DECISIONS, not two enqueues.** Both sites go
   through the same `RoutingCommitService.route`, guarded by the per-order lock
   and by `UNIQUE (orderId) WHERE state = 'live'` (#2394). At most one of them
   can ever observe `status: 'routed'` for a given order — the other gets
   `already-routed`.
2. **The enqueue is idempotent under `dedupeKey`** (see Q2).
3. **`claimDispatchAttempt` is a conditional UPDATE**, so even a duplicate job
   claims nothing and the handshake no-ops.

Wiring only the live site was considered and rejected: `fulfillment.work.route`
is registered and may gain a producer, and a handler that silently fails to
dispatch is the "dead code that type-checks" failure this programme keeps hitting.

### Q2 — under what idempotency key?

**`fulfillment:dispatch:{workId}`** — a namespace of its own, deliberately NOT
`work:{workId}:{assignmentAttempt}`.

That second key is the **handshake's** key, and #2399 made it minted only through
`claimDispatchAttempt`'s `RETURNING` precisely so a key cannot exist without the
row already holding that value. Re-deriving it at enqueue time would reintroduce
exactly the shape that guarantee removes. The enqueue key answers a different
question — *have we already asked the worker to run this dispatch?* — and
`workId` alone is sufficient and correct for it:

- A **retry of the ingestion/route job** re-runs `route()`, which answers
  `already-routed` and enqueues nothing at all, so the key is not even reached.
- A **genuine re-route** mints NEW work rows with new ids, hence new keys — which
  is right, because a new work object is new work.
- The key is **not quantity- or attempt-derived** (#2285 / #2039), so it cannot
  silently re-mint.

`expectedAssignmentAttempt` is enqueued as **`null`**, and that is REQUIRED
rather than merely acceptable. `claimDispatchAttempt` itself bumps the counter,
so any pre-claim value this producer could pass is stale the moment the first
run succeeds: on a retry `claimOrResume` finds the claim refused,
`requestStatus === 'submitted'`, and `current.assignmentAttempt !== expectedAttempt`
— and declines to resume. Passing `0` would therefore make the producer's own
retry send nothing and lose the dispatch outright. `RoutedWorkRef` deliberately
does NOT carry `assignmentAttempt`: it would be a field whose only correct use is
not to use it.

**Constraint recorded against #2395**: the enqueue dedupe key is `{workId}` alone
and `sync_jobs.idempotencyKey` is globally unique with no TTL, so a SECOND
dispatch for the same work row would be silently swallowed — no job, no error.
`CLAIMABLE_FROM = ['unsubmitted', 'rejected']`, so a rejected work is re-claimable
on the same row, which is exactly what a router-driven re-request does. Nothing
bumps `assignmentAttempt` in the tree today, so this is unreachable; the day a
re-request or re-source path lands it must give this key a generation component
or the re-dispatch is lost. The note lives on `buildFulfillmentDispatchDedupeKey`
itself, not only here.

### Q3 — does a re-route re-dispatch?

**Yes, and correctly**: a re-route commits new work rows, so new ids, new dedupe
keys, new dispatches. A router-driven **re-request** on the SAME row (bumping
`assignmentAttempt`) is a different mechanism this producer does not perform,
and `null` on the payload is what says so. The producer fires **per work row
created by a routing commit**, never per job-runner attempt.

---

## 4. Architecture Mapping

| Layer | Change |
|---|---|
| CORE `fulfillment` (leaf) | new pure `fulfillment-dispatch-enqueue.types.ts`; widen `RoutingCommitOutcome`'s `routed` arm; `commit()` returns holders |
| CORE `orders` | `OrderIngestionService` enqueues on the `routed` arm |
| App `apps/worker` | `FulfillmentWorkRouteHandler` enqueues on the `routed` arm |

**No new cross-context edge in either direction.** The leaf gains a pure
function and imports nothing new; `orders` already injects `SYNC_JOB_QUEUE_TOKEN`
and already imports `@openlinker/core/fulfillment`; the worker handler already
composes both.

### Why the outcome arm has to widen

`SyncJob.connectionId` is non-nullable and #2399/#2609 require it to be the
work's own `assignedConnectionId` — never a synthetic id, because a shared scope
collapses per-lane per-scope accounting installation-wide. The `routed` arm
carries only `workIds: readonly string[]`, so a caller cannot build the enqueue
without a second read. `commit()` already holds the created `FulfillmentWork`
objects, so it costs nothing to report the holder.

`workIds` is **replaced**, not supplemented:

```ts
| { readonly status: 'routed';
    readonly decisionId: string;
    readonly works: readonly RoutedWorkRef[] }   // { workId, assignedConnectionId }
```

Adding a parallel field would leave two shapes describing one fact. Replacement
is compile-checked at all four readers (two log sites, one unit spec, one
int-spec).

---

## 5. Questions & Assumptions

- **Assumption**: a work row created by `route()` always carries the holder the
  router assigned. Verified — `RoutingCommitService.commit` passes
  `assignment.connectionId` straight into `works.create`, and the column is
  insert-only (#2392).
- **Assumption**: `connectionId` may legitimately be `null` (the create input
  allows it). Handled by the derivation SKIPPING such rows — see §7.
- **Open, and stated rather than closed**: an enqueue lost after a committed
  route leaves the work `unsubmitted` for ever, because the retry answers
  `already-routed` and therefore reaches no enqueue. See §8.

---

## 6. Implementation Plan

### Phase 1 — the leaf

1. **`libs/core/src/fulfillment/domain/types/fulfillment-dispatch-enqueue.types.ts`** (new)
   - `RoutedWorkRef = { workId: string; assignedConnectionId: string | null }`
   - `FulfillmentDispatchEnqueueIntent = { workId; connectionId; orderId; dedupeKey }`
   - `buildFulfillmentDispatchDedupeKey(workId): string`
   - `deriveFulfillmentDispatchEnqueueIntents(works, orderId): readonly FulfillmentDispatchEnqueueIntent[]`
   - **Named `…EnqueueIntent`, not `FulfillmentDispatchIntent`** — that name is
     already taken by #2401's relay intent
     (`orders/application/interfaces/fulfillment-dispatch-relay.service.interface.ts:16`,
     re-exported from the `@openlinker/core/orders` barrel). `OrderIngestionService`
     lives in `orders`, so the un-prefixed name would put two same-named types
     meaning different things ("tell the participants it shipped" vs "ask the
     holder to ship") in one file.
   - **The intent is NEUTRAL and carries its own `dedupeKey`; it is never an
     `EnqueueJobRequest`** — because the two hosts use different enqueue ports
     with incompatible request shapes (see §6a).
   - Pure; no I/O; no import beyond same-context relatives. Follows the
     `engineering-standards.md § pure-rule exception` (the rule IS the type's rule,
     both halves change together).
   - **Acceptance**: unit spec covers skip-on-null-holder, key format, mapping.

2. **`routing-commit.types.ts`** — replace `workIds` with `works: readonly RoutedWorkRef[]`.
3. **`routing-commit.service.ts`** — `commit()` collects `{workId, assignedConnectionId}`.
4. **Barrel** — export the new module from `libs/core/src/fulfillment/index.ts`.

### Phase 2 — the two call sites

5. **`OrderIngestionService.toInterceptOutcome`** — on `routed`, derive intents and
   `enqueueBulk` them, inside **its own `try/catch`**.
   **This is load-bearing, not defensive.** `toInterceptOutcome` is called at
   `order-ingestion.service.ts:866`, INSIDE `interceptFulfillmentRouting`'s
   fail-open `try`, whose catch returns `{ held: false, block: null }`. An
   unguarded enqueue throw would therefore not merely lose the dispatch — it
   would convert a `routed` outcome into "not held", and ingestion would mirror
   to every destination an order whose `fulfillment_works` rows are already
   committed. That is an order fulfilled twice. The inner catch is what keeps
   `{ held: true }` unconditional; a spec asserts `held: true` when
   `enqueueBulk` rejects.
6. **`FulfillmentWorkRouteHandler.toJobResult`** — same derivation, same swallow.
   Gains `@Inject(JOB_ENQUEUE_TOKEN) private readonly jobEnqueue: JobEnqueuePort`.
   Both log sites update to `outcome.works.map(w => w.workId)`.

### 6a. The two hosts use DIFFERENT enqueue ports

| Site | Port | Method | Request shape |
|---|---|---|---|
| `OrderIngestionService` (core `orders`) | `SyncJobQueuePort` (`SYNC_JOB_QUEUE_TOKEN`) | `enqueueBulk` | `{ type, connectionId, payload, options: { dedupeKey } }` |
| `FulfillmentWorkRouteHandler` (`apps/worker`) | `JobEnqueuePort` (`JOB_ENQUEUE_TOKEN`) | `enqueueJob` | `{ jobType, connectionId, payload, idempotencyKey }` |

`grep -rn "SYNC_JOB_QUEUE_TOKEN" apps/worker/src` returns nothing; every worker
handler that fans children out injects `JOB_ENQUEUE_TOKEN`. This does not weaken
the one-body design — it is why the derivation returns a neutral intent rather
than a request: there are two mutually incompatible request types, and each site
maps the intent onto its own in about four lines.

### Phase 3 — tests

7. Unit: the derivation; `order-ingestion.service.spec.ts` (enqueued once per
   holder-bearing work, skipped for a null holder, swallowed on failure);
   `fulfillment-work-route.handler.spec.ts` likewise.
8. Fix every `routed`-arm reader. There are TEN, not four — all compile-checked:
   `routing-commit.types.ts:56` (decl), `routing-commit.service.ts:381,417`,
   `order-ingestion.service.ts:900` (log), `fulfillment-work-route.handler.ts:185`
   (log), `routing-commit.service.spec.ts:411,447`,
   `order-ingestion.service.spec.ts:2208,2223,2299,2367`,
   `fulfillment-router-wiring.int-spec.ts:242`.
   **Do NOT touch** the identically-named `workIds` on
   `FulfillmentWorkLinkResolution.ambiguous` (`fulfillment-work-link.types.ts:35`)
   or the repository/port parameter names — different type, unrelated.

---

## 7. Decisions inside the derivation

- **A holder-less work is SKIPPED, not enqueued.** `SyncJob.connectionId` is
  non-nullable, and the handler throws the retryable `FulfillmentWorkUnassignedError`
  for unassigned work — so enqueueing one can only burn the ten-attempt ladder
  and produce a dead row. It is warn-logged at the call site rather than silently
  dropped.
- **Enqueue failure is swallowed and error-logged at both sites.** The ingestion
  intercept never throws by contract (an optional routing layer must not cost a
  paid order its destination mirror), and on the handler side a throw would retry
  into `already-routed`, which enqueues nothing — so a throw buys a burnt ladder
  and no dispatch. The honest treatment is a loud log naming the work ids.

---

## 8. Risks & known gap

| Risk | Treatment |
|---|---|
| **A lost enqueue strands the work `unsubmitted` for ever** — the retry answers `already-routed` and never reaches the enqueue. | **Stated, not closed.** ADR-054's timeout-as-rejection sweep is the named, issue-less owner of reaping `submitted` work; the same sweep is the natural home for `unsubmitted`-with-a-committed-decision. Recorded in the derivation's header and in the PR body. |
| Two call sites drift | One derivation body; both sites are ~6 lines of mapping over it. |
| A duplicate job for one work | `dedupeKey` + `claimDispatchAttempt`'s conditional UPDATE; the handshake no-ops. |
| Backward compatibility | `RoutingCommitOutcome` is internal to core + worker; no HTTP DTO or persisted shape carries it. Compile-checked at every reader. |

---

## 9. Testing Strategy & Acceptance Criteria

- [ ] A `routed` outcome enqueues one `fulfillment.work.dispatch` per created work
      that carries a holder.
- [ ] `SyncJob.connectionId` is the work's own `assignedConnectionId`.
- [ ] The dedupe key is `fulfillment:dispatch:{workId}` and never the handshake key.
- [ ] `expectedAssignmentAttempt` is `null`.
- [ ] A holder-less work enqueues nothing and warns.
- [ ] An enqueue failure never changes the routing outcome at either site —
      specifically, `enqueueBulk` rejecting still yields `held: true`.
- [ ] A router-less install is byte-identical (no enqueue on any non-`routed` arm).
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm check:invariants`, `pnpm test` green.

---

## 10. Alignment Checklist

- [x] Hexagonal layering respected; the leaf stays sibling-edge-free
- [x] No new job type, no lane change, no migration
- [x] Idempotency considered and its key justified against #2399's
- [x] Error handling stated per call site
- [x] Naming follows `docs/engineering-standards.md`
- [x] Execution-ready
