# Implementation Plan — ADR-050 (workload isolation: concurrency lanes) + ADR-051 (worker topology: one artifact, roles)

**Issues**: #2167 (ADR-050), #2168 (ADR-051) — both Wave 1 "decision, pre-code input" sub-issues of epic #2162.
**Branch**: `2167-2168-adr-lanes-worker-topology`
**Layer**: DX / architecture documentation only. **No runtime code changes** — implementation is Wave 3 (#2167) and Wave 4 (#2168), out of scope by both issues' own statements.

---

## 1. Understand the task

Write two ADRs that record the workload-isolation and worker-topology decisions for the async work
layer, grounded in the live code, with rejected alternatives and observable reversal gates. The ADR
numbers are **050 and 051** — reallocated from the issue titles' 048/049 per the reservation note in
`docs/architecture/adrs/README.md` (048/049 were consumed by #2166/#2165; "read the allocation here,
not the issue titles").

**Non-goals**: any change to `sync-job.runner.ts`, `findAndLockDueJobs`, module graphs, Dockerfile,
compose, or env flags. No new `check:invariants` script (#2169 owns that); each gate is, however,
marked **countable** or **prose-only** inline so #2169 can consume both ADRs without re-litigating.

## 2. Research findings (verified against the worktree at `origin/main`)

### For ADR-050 (lanes)

- Runner: `apps/worker/src/sync/sync-job.runner.ts` — `BATCH_SIZE = 10`, `POLL_INTERVAL_MS = 1000`,
  strictly sequential `for … await` (comment: "For MVP, process sequentially"), no concurrency knob.
  `findAndLockDueJobs(limit, workerId)` takes **no jobType and no priority**; SQL is
  `status='queued' AND nextRunAt <= now ORDER BY nextRunAt ASC LIMIT $3 FOR UPDATE SKIP LOCKED` —
  one global FIFO by due time.
- Priority: every handler runs `runWithPriority({ priority: 'background' })` (runner:299); the only
  `interactive` producer is the API request interceptor. The limiter header
  (`libs/shared/src/rate-limit/rate-limiter.ts:1-16`) documents strict-priority dequeue with **no
  floor for background** ("can starve a queued background waiter indefinitely", bounded by
  `MAX_TOTAL_WAIT_MS = 120_000`).
- Rate-limit timeouts requeue via `requeueWithoutPenalty(id, msg, now+30s)` **into the same FIFO**,
  attempts not incremented.
- `EXPANDED_OFFER_CEILING = 1000` (`bulk-listing-submit.service.ts:94`) — one submit can enqueue up
  to 1000 children into the same undifferentiated queue.
- **Handler inventory: 34 registered job types** (`handler-registration.service.ts`, 34 `register`
  calls), not the issue's ~30. Provisional clustering from the research pass (primary profile) —
  **the final, authoritative lane mapping is ADR-050 § Decision 1** (12 realtime / 12 bulk /
  4 fiscal / 6 fan-out, after applying the cost-of-starvation rule below); the counts here predate
  that rule's application:
  - **realtime** (~15): `marketplace.order.sync`, `order.fxStamp`, `offerQuantity.update`,
    `offer.updateFields`, `offer.create`*, `offer.pollCreationStatus`, `offer.refreshSnapshot`,
    `offer.stockRestore`, `offer.pauseStale`, `shipment.syncByExternalId`,
    `master.product.syncByExternalId`, `master.inventory.syncByExternalId`, `shop.product.publish`*,
    `invoicing.paymentStatus.refreshByExternalId` (* = bulk-batch children — single-unit work, but
    arriving in 1000-wide waves).
  - **bulk** (~10): `order.fxStampSweep`, `offers.sync`, `offer.statusSync`, `offer.pauseStaleSweep`,
    `shipment.statusSync`, `fulfillment.statusSync`, `master.variants.autoMatch`,
    `pickupPoint.refreshFrequent`, `shop.product.statusSync`, `destination.taxonomy.sync`.
  - **fiscal** (4): `invoicing.issue` (strict: one-shot, at-most-once), plus
    `invoicing.regulatoryStatus.reconcile`, `invoicing.offlineSubmission.resubmit`,
    `invoicing.pendingRecovery.sweep` (dual-profile: paged sweeps that are deadline-bearing).
  - **fan-out** (~5): `orders.poll` (also bulk), `master.{product,inventory}.syncAll`,
    `master.product.syncDelta`, `master.product.reconcile`, `inventory.propagateToMarketplaces`.
  - The **dual-profile handlers are the hard cases** and the ADR must state the assignment rule:
    a job's lane is chosen by **what starving it costs**, not by its I/O shape (so the invoicing
    sweeps sit in `fiscal`; `orders.poll` sits in `fan-out` because its own HTTP is one page and its
    output is child jobs).

### For ADR-051 (topology)

- `ScheduleModule.forRoot()` is **api-only** (`apps/api/src/app.module.ts:59`); `SchedulerService`
  provided by `apps/api/src/sync/sync.module.ts`; ~**23 task descriptors** total (10
  `CORE_CAPABILITY_TASKS` + 1 bespoke taxonomy + 12 plugin-contributed). The worker registers no
  cron; `apps/worker/src/plugins.ts:22-24` states "Scheduler runs api-side; worker only drains."
- Consumers: `webhook-handler` in **api** (file header: "Runs in the API process for MVP"),
  `master-deletion-offer-pause` + `job-intake` in **worker**.
- Cardinality facts: job dispatch is already N-replica-safe (`FOR UPDATE SKIP LOCKED` + per-worker
  `lockedBy`); stream consumption is N-replica-safe (`OL_WORKER_ID` / `resolveConsumerName`, #2164);
  the **scheduler is singleton-by-accident** (no leader election, no lock on cron firing — N api
  replicas ⇒ N duplicate ticks, absorbed only by job idempotency keys); worker-side **stuck-job
  recovery** is an unlocked `setInterval` per replica; api-side `demo-account-cleanup` is an
  unlocked `@Cron` per replica.
- Identity split worth recording: stream identity is stable (`OL_WORKER_ID`, #2164) but the runner's
  **DB lock identity is still `worker-${process.pid}-${Date.now()}`** (runner:32) — safe (SKIP
  LOCKED doesn't need stability) but inconsistent, and stuck-job recovery keys off `lockedAt`
  timeouts rather than identity.
- `SyncLockPort` serializes **six** key families (not the issue's five): orders poll, order create,
  invoice issue, shipment dispatch, taxonomy sync, WooCommerce customer provisioning — the
  established mechanism for singleton-izing the scheduler/maintenance roles.
- Artifact: `Dockerfile:150` `FROM production AS worker`, differing only by two COPYs and CMD; base
  `docker-compose.yml` has **no worker service**; `docker-compose.demo.yml` has api + worker; no
  `replicas:` anywhere.
- Module graph: worker boots a handler provider for each of the 34 registered job types plus all
  13 plugin entries unconditionally;
  api boots the same 13; there is **zero conditional DI today** — every role-ish distinction is a
  runtime flag inside an already-instantiated provider (`WORKER_INTAKE_ENABLED`,
  `WORKER_RUNNER_ENABLED`, `OL_MASTER_DELETION_CONSUMER_ENABLED` — the last documented in **no**
  `.env.example`).

## 3. Design — what each ADR decides

### ADR-050 `docs/architecture/adrs/050-workload-isolation-concurrency-lanes.md`

1. **Lanes are workload profiles, not bounded contexts** — four lanes (`realtime`, `bulk`,
   `fiscal`, `fan-out`), assignment rule = cost of starvation; the handler-to-lane mapping recorded
   as four grouped lists (lane → jobType list) with the dual-profile cases named and resolved by
   the rule — not a 34-row table duplicating the registry (acceptance criterion still met).
2. **Per-lane concurrency caps, never strict priority** — every lane can always pull; strict
   priority rejected with the starvation reasoning (River's documented behaviour; OL's own limiter
   header as in-repo evidence of the same failure shape).
3. **The isolation key is a `scope`, not `connectionId`** — tenancy rationale (Fleet/Partner
   Console: one merchant, many connections); pg-boss `groupConcurrency` precedent.
4. **Not built: round-robin fairness** (BullMQ Pro-only in the OSS queue landscape; caps suffice at
   OL's connection cardinality). Gate: countable — a scope observed waiting behind another scope's
   full cap for > a stated window.
5. **Not built: separate deployables** — escalation ladder (per-lane caps → producer-side routing →
   role flag → second container → separate artifact), OL is before rung one. **ADR-050 carries its
   own reversal gate** (a lane whose measured contention per-lane caps demonstrably cannot fix, or
   a CPU-bound handler class appearing) — never a bare pointer at ADR-051, whose #546-M3 gate is
   the *topology* gate and stays distinct per both issues' "keep the rationales separate" rule.
6. **Caps are tunable only against metrics** (#1134) — state the observability precondition; cap
   values in the ADR are illustrative, not normative.

**Alternatives considered (dedicated section, per template)**: strict-priority queue;
per-bounded-context lanes (fifteen contexts, wrong axis); adopting an OSS queue engine (pg-boss /
River / BullMQ) as the lane implementation; separate deployables per workload.

Each reversal gate uses the exact lexical form `*Reversal gate (countable):*` /
`*Reversal gate (prose-only):*` — extending ADR-049's `*Reversal gate:*` prefix — so #2169's
future check script has one grep target across both ADRs.

### ADR-051 `docs/architecture/adrs/051-worker-topology-one-artifact-roles.md`

1. **One artifact** — roles are boot configurations of the existing worker image (whose Dockerfile
   already proves the shells-around-one-library point). Separate services rejected; gate =
   out-of-process plugins (#546 Milestone 3).
2. **Four roles with explicit cardinality**: `jobs` (N — already safe), `events` (N — already
   safe), `scheduler` (1 — currently accidental), `maintenance` (1 — stuck-job recovery, demo
   cleanup, future retention/partition work). Cardinality is a correctness driver, not scaling.
3. **Scheduling moves out of the API process** into the `scheduler` role; singleton enforced with a
   `SyncLockPort` lease (seventh key family) rather than trusted deployment discipline.
4. **Roles select conditional module imports, not runtime flags** — a `scheduler` process must not
   instantiate 34 job handlers; today's flag-inside-instantiated-provider pattern is named as the
   anti-pattern.
5. **`OL_WORKER_ROLE`, default `all`** — a small install keeps exactly today's two containers;
   documented in **both** `.env.example` files (the `OL_MASTER_DELETION_CONSUMER_ENABLED` omission
   named as the mistake not to repeat).
6. **Startup assertion**: enabled roles must cover every registered job type / consumer group —
   unclaimed work must fail boot loudly, not sit silently. Gate: countable once implemented.

**Alternatives considered (dedicated section, per template)**: separate services per role (four
shells around one library); leaving the scheduler in the API process; runtime flags on a
fully-booted module graph (today's pattern, named as the anti-pattern); external leader-election
machinery vs the existing `SyncLockPort` lease.

### Shared conventions

- Status `Proposed`, authors `@piotrswierzy`, date 2026-08-21; bare `#NNN` issue links (enforced by
  `check-repo-urls.mjs`); cross-refs to ADR-048/-049 and each other; length per the ADR-047/-049
  house precedent (the 500-word template target yields to the epic's evidence-density style, as the
  sibling ADRs already established).
- README: two index rows; amend the Reserved-numbers note (050/051 leave reservation, "Allocate 052"
  stays).

## 4. Steps

1. `docs/architecture/adrs/050-workload-isolation-concurrency-lanes.md` — new file per §3.
2. `docs/architecture/adrs/051-worker-topology-one-artifact-roles.md` — new file per §3.
3. `docs/architecture/adrs/README.md` — add two index rows; rewrite only the 049–051 claim
   sentence of the reservation note so those reservations are released, keeping the
   "Allocate 052" sentence and the #2082 pointer verbatim (the note is load-bearing for the next
   allocator).
4. Quality gate: `pnpm lint` (runs `check:invariants`, incl. `check-repo-urls.mjs`), `pnpm
   type-check`, `pnpm test` (docs-only change; gate still runs to keep the hook green).

## 5. Validation

- Architecture compliance: docs-only; no boundary risk.
- Both issues' acceptance criteria mapped: rejected alternatives + observable gates (both), lane
  taxonomy + mapping + scope key + strict-priority rejection + deployables rejection (#2167),
  cardinality-as-rationale + singleton locking + scheduler placement + default `all` (#2168), README
  row (both).
- Risk: none runtime. Main review risk is factual accuracy of code claims — mitigated by grounding
  every number in the file:line evidence above (the ADRs correct the issues where they diverge:
  34 handlers, six lock families, 23 scheduler tasks).
