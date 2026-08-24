# Implementation Plan — #2278: concurrency lanes — per-lane caps in the job runner (ADR-050)

**Issue**: #2278 (Wave 3 of epic #2162; implements ADR-050's migration path)
**Branch**: `2278-concurrency-lanes`
**Layer**: CORE (`libs/core/src/sync` domain types + port + repository) and worker runtime (`apps/worker/src/sync`)

---

## 1. Understand the task

`SyncJobRunner` locks up to 10 due jobs with no jobType discrimination and processes them
**strictly sequentially**, so one 1000-child publish wave puts 35–80 minutes of serial work in
front of a buyer's order sync, the stock write, and a statutory invoicing deadline. ADR-050 is the
spec: four lanes chosen by cost-of-starvation, lane declared at handler registration (boot error
when missing), lane-aware claiming, per-lane caps keyed by `scope`, never strict priority.

**Non-goals**: cap *tuning* (#1134 supplies measurements; values ship as env-overridable
illustrative defaults, ADR-050 D6); worker roles / scheduler extraction (Wave 4, #2279 —
orthogonal); round-robin fairness between scopes (ADR-050 D4 explicitly not built); any change to
retry/backoff/heartbeat/stuck-job semantics; multi-replica coordination beyond the existing
`FOR UPDATE SKIP LOCKED`.

## 2. Research findings (verified in worktree at `6a335fddd`)

- **35 registered jobTypes, not the ADR's 34.** `fiscalization.register` (#2156) was registered
  after ADR-050's mapping was authored and appears in no lane list. By the ADR's own rule
  (cost-of-starvation; deadline-bearing, at-most-once — the same profile as `invoicing.issue`) it
  belongs in **`fiscal`**, making the split **12 / 12 / 5 / 6**. This is an *addition* the
  boot-error requirement exists to catch, not lane churn; the plan records it and the ADR's lane
  table gets a one-line amendment in the same PR (ADR-050 is `Proposed`; same posture as the
  #2169 marker edit).
- **Runner** (`apps/worker/src/sync/sync-job.runner.ts`): single loop, `BATCH_SIZE = 10`,
  `for … await` over claimed jobs. Failure paths (`handleJobFailure`, rate-limit
  `requeueWithoutPenalty` +30 s, auth-flagging, heartbeat per job) are per-job and self-contained
  — they survive concurrent execution unchanged. `runWithPriority({ priority: 'background' })`
  is the *rate-limiter* priority axis (#1810), orthogonal to lanes — unchanged.
- **Claim query** (`sync-job.repository.ts:126`): raw SQL
  `WHERE status='queued' AND "nextRunAt" <= now ORDER BY "nextRunAt" ASC LIMIT $3 FOR UPDATE SKIP
  LOCKED`, then flips the rows to `running` in the same transaction. Adding
  `AND "jobType" = ANY($types)` (+ optional `AND "connectionId" != ALL($excludedScopes)`) is a
  minimal, index-friendly extension — **no schema change, no migration**: the lane is derivable
  from `jobType` at claim time, exactly the issue's preferred shape.
- **Registry** (`sync-job-handler.registry.ts`): `register(jobType, handler)` into a `Map`;
  `HandlerRegistrationService.onModuleInit` makes the 35 calls. The registry is the natural home
  for lane metadata (`getLane`, `getJobTypesByLane`) — Wave 4's role work and #2169's future
  lane-coverage check both read it.
- **A runner spec EXISTS** (pre-implement correction): `apps/worker/src/sync/__tests__/
  sync-job.runner.spec.ts` (~1060 lines — failure ladder, rate-limit requeue, heartbeat, loop
  lifecycle, with the real classifier registry), plus
  `handlers/__tests__/sync-job-handler.registry.spec.ts`. The concurrency work **extends** both;
  every existing scenario must stay green — they pin the per-job machinery this plan promises is
  unchanged.
- **Port consumers** (pre-implement audit): besides the runner and `SyncJobRepository`, the old
  `findAndLockDueJobs` is called directly by
  `apps/worker/test/integration/job-intake-execution.int-spec.ts` and mocked in two api specs
  (`connection.controller.spec.ts:94`, `sync.controller.spec.ts:52`). It is therefore **retained**
  — the new `findAndLockDueJobsForLane` lands beside it, and the old method stays as the
  claim-semantics seam those consumers exercise. Existing mocks are partial-object
  `as unknown as jest.Mocked<...>` casts, so the additive port method breaks no compilation.
- **Registry `register` gaining a required lane param breaks exactly two test files** — the
  registry spec (~8 two-arg calls) and the handler-registration service itself; the `.register(`
  hits in the WooCommerce int-test harness are `adapterRegistry.register` (a different registry).
  Regression-ledger caveat: worker int-specs compile only at int-test runtime (`pnpm lint`/
  `type-check` exclude `apps/worker/test`), so the targeted int-spec run in the quality gate is
  load-bearing.

## 3. Design

### 3a. Lane vocabulary + assignment metadata (core)

`libs/core/src/sync/domain/types/sync-job-lane.types.ts`:

- `SyncJobLaneValues = ['realtime', 'bulk', 'fiscal', 'fan-out'] as const`; `SyncJobLane` union
  (engineering-standards § Union Types).
- `resolveJobScope(job: Pick<SyncJob, 'connectionId'>): string` — the ADR-050 D3 seam: one pure
  function, `scope = connectionId` today, the future multi-merchant key changes this one body.
  Pure-rule exception applies (the function IS the rule for the type it sits with).
- Deliberately **no** jobType→lane map in core: the authoritative mapping lives where handlers
  register (ADR-050 D1 — "assigned at registration"), so worker and mapping cannot drift apart.

### 3b. Lane declared at registration (worker)

- `SyncJobHandlerRegistry.register(jobType, handler, lane: SyncJobLane)` — third parameter,
  required. Registry stores `{ handler, lane }`; new reads: `getLane(jobType)`,
  `getJobTypesByLane(lane): JobType[]`.
- `HandlerRegistrationService` passes the lane on each of the 35 calls per ADR-050 D1's table
  (+ `fiscalization.register` → `fiscal`).
- **Boot error — full-union coverage (tech-review fix)**: registration is compiler-forced
  (required param), but the assertion must be stronger than "every registered type has a lane".
  Once claiming is `"jobType" = ANY(<lane membership>)`, a jobType outside the partition is
  **silently stranded in `queued` forever** — today it would at least be claimed and loudly
  `markDead`'d ("No handler registered"). The runner's `onModuleInit` therefore asserts the lane
  partition covers **all of `JobTypeValues`** (verified satisfiable: the union's 35 values ===
  the 35 registrations) and throws naming any uncovered type — the ADR-051 D6 registry assertion
  point, and the guard that turns a future forgotten registration into a boot error instead of
  invisible row pile-up.

### 3c. Lane-aware claiming (core port + repository)

New port method — the old `findAndLockDueJobs` is **retained** (it has live consumers: the
job-intake int-spec and two api spec mocks; see §2). In-lane ordering stays
`ORDER BY "nextRunAt" ASC` (unchanged semantics, stated in the JSDoc); the `excludedScopes` SQL
arm is added conditionally so the empty-array case never reaches the query (spec covers both
branches):

```typescript
findAndLockDueJobsForLane(input: {
  jobTypes: JobType[];       // the lane's membership, from the registry
  limit: number;             // the lane's free slots this tick
  workerId: string;
  excludedScopes?: string[]; // scopes at their per-scope cap (scope = connectionId today)
}): Promise<SyncJob[]>;
```

Implementation extends the existing raw SQL with `"jobType" = ANY($2)` and, when
`excludedScopes` is non-empty, `"connectionId" != ALL($4)` — same transaction shape, same
`FOR UPDATE SKIP LOCKED`, same `running` flip. Excluding capped scopes **in the claim** is what
keeps a scope-capped job from being locked-then-requeued (churn) — it simply stays `queued` for a
later tick.

### 3d. Concurrent runner with per-lane slot accounting (worker)

`SyncJobRunner.runnerLoop` becomes:

1. Track in-flight work as `Map<SyncJobLane, Map<scope, count>>` + per-lane totals; a
   completed/failed `processJob` promise releases its slot in `finally`.
2. Each tick, for **every** lane (fixed iteration order irrelevant — every lane always pulls,
   ADR-050 D2): compute `free = laneCap - inFlight(lane)`; if `free > 0`, claim up to `free` with
   the lane's jobTypes and the scopes currently at `scopeCap` excluded.
3. Fire `processJob(job)` **without awaiting** (tracked promise, slot accounting in `finally`);
   `processJob` itself is unchanged — heartbeat, outcome persistence, failure ladder, rate-limit
   requeue all stay per-job.
4. Sleep `POLL_INTERVAL_MS` only when no lane claimed anything; on shutdown, await
   `Promise.allSettled` of in-flight jobs raced against the existing 500 ms timeout.

Rate-limit requeue safety (AC 6) holds **structurally**: a requeued job re-enters `queued` and can
only ever be claimed against *its own* lane's jobTypes and slots — asserted by a spec, not by
extra code.

**Intra-batch scope-cap overflow (tech-review fix)**: the `excludedScopes` exclusion filters only
scopes at cap *before* the claim — one claim of `free` slots can return `free` jobs sharing a
single scope (the operator-wave case itself: 1000 same-connection `marketplace.offer.create`
children), breaching the per-scope cap inside the batch. After claiming, the runner groups the
batch by scope, keeps up to each scope's remaining allowance, and **releases the surplus back to
`queued` immediately** with no attempt penalty and `nextRunAt = now` (the claim flipped them
`running`, so the release goes through `requeueWithoutPenalty` with an informational message —
no new port method needed). Surplus is bounded by `free ≤ laneCap`, so the churn is small and
only occurs in the same-scope-burst case. Covered by its own spec. SQL-side per-scope windowing
was considered and rejected as complexity disproportionate to that bound.

### 3e. Caps: env-overridable illustrative defaults (ADR-050 D6)

| Lane | Total cap env | Default | Per-scope cap env | Default |
|---|---|---|---|---|
| realtime | `OL_LANE_REALTIME_CAP` | 4 | `OL_LANE_REALTIME_SCOPE_CAP` | 2 |
| bulk | `OL_LANE_BULK_CAP` | 2 | `OL_LANE_BULK_SCOPE_CAP` | 1 |
| fiscal | `OL_LANE_FISCAL_CAP` | 2 | `OL_LANE_FISCAL_SCOPE_CAP` | 1 |
| fan-out | `OL_LANE_FANOUT_CAP` | 1 | `OL_LANE_FANOUT_SCOPE_CAP` | 1 |

Read via `ConfigService` with coercion (non-numeric/≤0 → default, mirroring the #2229 clamp
posture); every default carries a comment stating it is illustrative until #1134 measures. Total
worst-case concurrency 9 (vs 1 today) — bounded per connection by the existing rate limiter, and
per lane/scope by these caps.

## 4. Steps

1. `libs/core/src/sync/domain/types/sync-job-lane.types.ts` — union + `resolveJobScope` (+ spec).
   Export from the sync barrel/types surface as its siblings are.
2. `libs/core/src/sync/domain/ports/sync-job-repository.port.ts` — add
   `findAndLockDueJobsForLane`; JSDoc states lane membership comes from the caller (registry).
3. `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts` — implement
   it (parameterized `ANY`/`!= ALL`); unit-spec the SQL-shaping around a mocked manager if the
   existing repo spec pattern allows, otherwise cover via the int-spec below.
4. `apps/worker/src/sync/handlers/sync-job-handler.registry.ts` — lane-carrying registration +
   `getLane` / `getJobTypesByLane`; update its spec.
5. `apps/worker/src/sync/handlers/handler-registration.service.ts` — lane per call
   (12 realtime / 12 bulk / 5 fiscal / 6 fan-out); a spec asserts the full 35-type partition
   matches ADR-050's table + the `fiscalization.register` addition (exhaustive: every
   `JobTypeValues` member that is registered has a lane; count per lane pinned).
6. `apps/worker/src/sync/sync-job.runner.ts` — per-lane slot accounting per §3d; boot-time lane
   coverage assertion; caps read once at startup.
7. Extend `apps/worker/src/sync/__tests__/sync-job.runner.spec.ts` (existing scenarios stay
   green; new describe block for lane scheduling) — asserts:
   (a) saturated bulk lane (cap consumed) does not stop a queued realtime claim in the same tick;
   (b) every lane pulls under load (no strict priority);
   (c) scope at per-scope cap is passed as an exclusion and claims nothing for that scope;
   (d) rate-limit requeue releases the slot and the job's re-claim happens in its own lane;
   (e) the full-union boot assertion throws naming an uncovered `JobTypeValues` member;
   (f) intra-batch same-scope surplus beyond the scope cap is released back without penalty;
   (g) all lanes at cap with jobs still in flight → the loop sleeps rather than spinning.
8. `docs/architecture/adrs/050-workload-isolation-concurrency-lanes.md` — one-line amendment
   adding `fiscalization.register` to the `fiscal` list (12/12/5/6), noted as a post-ADR
   registration (#2156).
9. Docs: architecture-overview § Sync Manager gains a short lanes paragraph;
   `apps/worker/.env.example` documents the eight `OL_LANE_*` vars (env discoverability in this
   PR, not deferred to #2279 — whose issue text names an undocumented flag as the mistake not to
   repeat).
10. Quality gate: `pnpm lint`, `pnpm type-check`, `pnpm test`; targeted
    `pnpm test:integration` for the sync-jobs int-specs (claim-query change touches the repo).

## 5. Validation

- **Architecture**: lane types + port + repo in core with correct layering (types in
  `domain/types`, port in `domain/ports`, SQL in infrastructure); worker owns the assignment and
  scheduling policy. No CORE→Integration leak; no schema change, no migration
  (`migration:show` still run for safety).
- **Naming**: `sync-job-lane.types.ts`, `SyncJobLaneValues`/`SyncJobLane` per as-const standard.
- **ACs**: boot error (steps 4/6, spec e) ✓; bulk cannot delay realtime beyond its own lane
  (spec a) ✓; every lane always pulls (spec b) ✓; scope-keyed caps, `scope = connectionId`
  (§3a/§3c, spec c) ✓; env-overridable illustrative caps (§3e) ✓; requeue lane-safety (spec d) ✓;
  tests ✓; boundaries ✓.
- **Risks**: (1) concurrency in the runner is the first parallel execution of handlers in-process
  — mitigated by unchanged per-job machinery, per-scope caps, and the existing per-connection
  rate limiter beneath; (2) the 34→35 discrepancy — resolved explicitly, ADR amended;
  (3) `excludedScopes` list could grow large on many-connection installs — bounded by
  (lanes × in-flight scopes) ≤ total cap (9 by default), so trivially small.
