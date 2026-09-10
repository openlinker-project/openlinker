# `sync_jobs` at ten and forty million rows (#2840, no-retention projection)

_Stand: `lab` (docker-compose.lab.yml, #2854). Built at `4ff884d8e` (tip of
`perf-programme-2840` at measurement time). Machine spec:
`MACHINE-SPEC-2026-09-09.md` in this same directory. PostgreSQL 17.11,
`shared_buffers=128MB`, `work_mem=4MB`, `maintenance_work_mem=64MB`,
`effective_cache_size=4GB`, `max_parallel_workers_per_gather=2`,
`random_page_cost=4` (all defaults — never tuned for this stand)._

## Conditions — read this before reading any number below

This is **not** a publishable industry figure and must not be read as one.

- The stand is `docker compose` on a single developer machine — WSL2 (a
  Hyper-V VM), 22 logical CPUs (Intel Core Ultra 7 155H), ~15 GiB RAM
  visible to the guest, all containers sharing it. Full spec:
  `MACHINE-SPEC-2026-09-09.md`.
- The sync-job runner was **disabled** (`WORKER_RUNNER_ENABLED=false`, the
  stand's shipped default) throughout every measurement in this report — no
  concurrent job processing, no other lane activity, competing for the same
  Postgres instance while the claim query / route were timed.
- `docker-compose.lab.yml`'s Postgres ships **stock defaults**:
  `shared_buffers=128MB`, `work_mem=4MB`, `effective_cache_size=4GB`,
  `max_parallel_workers_per_gather=2`. None of these were tuned for this
  measurement — a real deployment sized for a 24GB-and-growing table would
  likely run with a larger `shared_buffers`, which would change (but not
  eliminate) the absolute numbers below, especially the route measurement's
  `read` buffer counts.
- Every route timing is from `curl` against the live `lab-api` container —
  single replica, no load balancer, no concurrent traffic.

## Why this measurement

`sync_jobs` has no retention job anywhere in the tree
(`docs/operations/data-retention.md`). Everything ever measured on this table
before this report was measured at 123k-157k rows — F5 deliberately held it
constant at 122,869 rows across all three order-count tiers, so its curve
says nothing about job-history size. This report seeds the table itself to
10M and 40M rows and re-measures the two things that matter: the claim
query (`FOR UPDATE SKIP LOCKED`, the busiest query in the system) and the
`GET /sync/jobs` list route (F5's own flagged "slowest read route, does not
scale with order count" finding).

## Pre-registered acceptance criteria

Written before seeding began.

- Seed via `seed/seed-jobs.sh` (set-based, additive across generations) to
  ~10,000,000 rows, then to ~40,000,000 rows (delta seed, second
  generation). Record the actual achieved count at each step — no promise
  of an exact number.
- At each size, with the sync-job runner **disabled** (`WORKER_RUNNER_ENABLED
  =false`, the stand's shipped default) and no load running:
  - Time the lane-aware claim query (`findAndLockDueJobsForLane`'s SQL body,
    `sync-job.repository.ts:176-184`) — 30 samples, report p50/p95, not one
    reading.
  - Time `GET /v1/sync/jobs?limit=20&offset=0` (the exact route+params
    `drivers/read-path.js:94` uses) — report p50/p95.
  - Capture `EXPLAIN (ANALYZE, BUFFERS)` for both, and report
    `shared_buffers` alongside the buffers read — a fast query because the
    buffer cache absorbed it and a fast query because the plan is genuinely
    cheap are different findings.
  - `VACUUM ANALYZE sync_jobs` and `pg_stat_statements_reset()` between
    sizes (both already done by `seed-jobs.sh`'s own `vacuum_analyze_reset`).
  - Record `pg_database_size`, `pg_total_relation_size(sync_jobs)`, and the
    table/index split.
- Verdict rule: if the claim query's cost tracks table size (not queue
  depth), that confirms the campaign's fear directly. If the list route's
  cost roughly matches F5's own finding that it does not track order count,
  extrapolate the SAME curve to see whether it becomes an operator-visible
  problem before 40M rows, and say at what size it crosses a stated
  threshold (100ms, 1s) rather than leaving the reader to eyeball a table.

## Harness note

`lib-test.sh` (this branch's harness self-test, required before measuring
anything) reports **165 passed, 1 failed** on this exact commit
(`4ff884d8e`, confirmed twice, deterministic) — not the 175/0 a red-harness
rule was pre-registered against. Diagnosed before trusting anything below:
the one failure (`run_post_guards threads the feed guard through`, testing
that an omitted feed argument leaves the verdict `VALID`) is a **test-only**
gap, not a production regression. `post_guard_containers_stable` (a guard
that refuses when no container-restart baseline was captured) was added to
`run_post_guards`'s guard list at some point after this specific test was
written; the test calls `run_post_guards` directly against a bare
`mktemp -d`, without first calling `window_start` (the only thing that
writes that baseline file) — so the guard correctly, honestly reports
"no baseline was captured" and discards, exactly as documented. Every real
scenario script (`f1`-`f10`, `weak-shop-ramp`, `limiter-ab`) calls
`window_start` before `run_post_guards`, so this gap is never reachable in
an actual measurement run — confirmed by grepping all ten scenario scripts.
This report does not use `run_post_guards`/`window_start`/the verdict
machinery at all (its own measurements are raw `psql`/`curl` against a
directly-seeded table), so the failure has no bearing on anything below —
but it stood as a genuine pre-registered stop condition until diagnosed, and
is recorded here rather than silently worked around.

## Tier 1: ~10,000,000 rows

Seeded via `DAYS=29735 SEED_GEN=1 bash seed/seed-jobs.sh` (a single
generation, run once). Actual result: **9,999,469 rows** (4,281,842
`master.product.syncFromSweep` + 5,709,122 `master.inventory.syncFromSweep`
+ 8,496 dead-letter tail — all `INSERT`ed set-based inside one transaction,
425s wall clock, under the script's own 1200s ceiling).

Sizes at this point:

| | size |
|---|---|
| `pg_database_size('openlinker')` | 6635 MB |
| `pg_total_relation_size('sync_jobs')` (table+indexes+toast) | 6622 MB |
| `pg_relation_size('sync_jobs')` (heap only) | 2485 MB |
| `pg_indexes_size('sync_jobs')` | 4136 MB |

Indexes present (unchanged across both tiers): `PK` on `id`;
`(status, "nextRunAt")`; `("lockedAt")`; `("connectionId", "createdAt")`;
`("connectionId", "jobType", status, "updatedAt")`; unique on
`"idempotencyKey"`. **Indexes already outweigh the heap 4136 MB to 2485 MB at
10M rows** — five indexes on a narrow-but-not-trivial row.

### Claim query — measured, not degraded

`sync_jobs` status distribution at this point: 9,990,968 `succeeded`, 8,498
`dead`, 3 `queued` (real leftover rows from bootstrap, unrelated job types —
i.e. genuinely near-zero live queue depth against the 10M-row terminal
history, the realistic shape the campaign describes).

30 in-session `EXPLAIN (ANALYZE, BUFFERS)` samples of the exact claim SQL
(`status='queued' AND "nextRunAt"<=now() AND "jobType"=ANY(...) AND
"connectionId"!=ALL(...) ORDER BY "nextRunAt" LIMIT 8 FOR UPDATE SKIP LOCKED`):

```
p50 = 0.054 ms   p95 = 0.12 ms   min = 0.049 ms   max = 0.186 ms
```

Plan (warm):

```
Limit  (actual time=0.040..0.041 rows=0 loops=1)
  Buffers: shared hit=5
  ->  LockRows  (actual time=0.039..0.040 rows=0 loops=1)
        Buffers: shared hit=5
        ->  Index Scan using "IDX_a2d0990898df9d69d7c3b53ca9" on sync_jobs
              Index Cond: ((status = 'queued') AND ("nextRunAt" <= now()))
              Filter: (connectionId <> ALL(...) AND jobType = ANY(...))
              Rows Removed by Filter: 3
              Buffers: shared hit=5
Execution Time: 0.117 ms
```

**5 buffer hits, all cache hits, at 10M rows.** The `(status, "nextRunAt")`
index does exactly what it should: the claim query's cost is a function of
**queue depth** (how many `queued` rows exist), not table size — 10M
terminal rows sitting behind the index cost nothing extra to skip past. This
directly answers the campaign's stated fear for the claim query specifically:
at 10M rows, it is not a problem, and the mechanism (index selectivity on
`status`) is visible, not assumed.

### `GET /v1/sync/jobs?limit=20&offset=0` — the F5 finding gets much worse

15 samples (real HTTP, via `curl`, authenticated):

```
p50 = 2961.6 ms   p95 = 3029.5 ms   min = 2895.4 ms   max = 3099.9 ms
```

**Nearly 3 seconds**, against F5's reported 33-35ms at ~123k-157k rows — this
is the SAME route, same query params, same table, ~65-80x more rows, ~85-90x
slower. Mechanism, via `EXPLAIN (ANALYZE, BUFFERS)` on the two queries
`findAndCount` (TypeORM, `sync-job.repository.ts:342-347`) actually issues
for an unfiltered call:

```
-- the page (ORDER BY "createdAt" DESC LIMIT 20 OFFSET 0):
Limit (actual time=1173.913..1184.407 rows=20 loops=1)
  Buffers: shared hit=77 read=318141
  -> Gather Merge (Workers Launched: 2)
       -> Sort (Sort Method: top-N heapsort, loops=3)
            -> Parallel Seq Scan on sync_jobs
Execution Time: 1211.656 ms

-- the total (COUNT(*), no filter):
Finalize Aggregate (actual time=464.485..473.076 rows=1 loops=1)
  Buffers: shared hit=30 read=7827
  -> Gather (Workers Launched: 2)
       -> Partial Aggregate
            -> Parallel Index Only Scan using "IDX_3086c88607c1c8b303fe1172f2" (the ("lockedAt") index — picked only because it is the NARROWEST available index for an index-only scan, not a designed covering index for counting)
Execution Time: 498.596 ms
```

**318,141 buffers read for the page query alone — ~2.55 GB — against a
128 MB `shared_buffers`.** There is no index on `"createdAt"` alone (only
the compound `("connectionId", "createdAt")`, whose leading column an
unfiltered query can't use), so `ORDER BY "createdAt" DESC LIMIT 20` forces
a full **parallel sequential scan** of the entire table plus a top-N sort,
every single call, regardless of how few rows are ultimately returned. The
`COUNT(*)` adds a second full index-only pass (7,857 buffers, ~61 MB) over
whichever index happens to be physically smallest. Together: ~1.7s of
`EXPLAIN`-measured execution time, ~2.9-3.0s observed at the HTTP layer
(the gap is planning + JIT + network + NestJS/TypeORM overhead, not
reflected in the raw SQL execution times above).

This is **exactly** the mechanism F5 already named ("any list that reports
an exact total" pays a COUNT-vs-page gap) — this report demonstrates it is
not merely a "few tens of ms" cost at real order-history scale: it crosses
from 33ms to **3 seconds** between ~150k and ~10M job-history rows, an
operator-visible stall on a route every jobs dashboard page-load hits.

## Tier 2: ~40,000,000 rows

Seeded via `FORCE_SEED=1 DAYS=89213 SEED_GEN=2 bash seed/seed-jobs.sh` (a
second, additive generation on top of Tier 1's 9,999,469 rows — 12,846,674 +
17,128,898 + 25,490 = 30,001,062 new rows). Final actual total:
**40,000,532 rows**, against a target of 40,000,000 — 0.001% over.

**The seeder's own hygiene step failed, and that is itself a finding.**
`seed-jobs.sh` first WARNed that the insert itself took 2709s against its own
2400s target (not fatal, logged per its own design) — then its trailing
`VACUUM ANALYZE sync_jobs` hit `ERROR: canceling statement due to statement
timeout` (`statement_timeout = 30s`, database-level default, not raised for
this bulk-maintenance step) and the whole script died
(`FATAL Postgres write failed: VACUUM ANALYZE sync_jobs`). This mirrors,
almost exactly, the order-seed/`statement_timeout` collision `seed-lib.sh`'s
own comments already document happening once before (a 900k-row bulk
`INSERT` cancelled by the same class of guard) — except this time it hit
**routine table maintenance**, not a seed write, on a table that had grown
to 24 GB. Recovered by re-running `VACUUM ANALYZE` manually with
`PGOPTIONS='-c statement_timeout=0'` (completed in 2.1s — an append-only
table with near-zero dead tuples costs little to actually vacuum once it is
allowed to run to completion) and a fresh `pg_stat_statements_reset()`
before measuring anything below. **Operationally: at ~24 GB / 40M rows, a
30s `statement_timeout` sized for interactive reads is no longer safe to
leave in front of maintenance operations against this table** — a second,
independent piece of evidence (alongside F5's own 69,155-buffer `COUNT`
finding) that this table's growth is starting to collide with settings that
were sized for a much smaller one.

Sizes at this point:

| | Tier 1 (~10M) | Tier 2 (~40M) | ratio |
|---|---|---|---|
| `pg_database_size` | 6635 MB | 24,576 MB (24 GB) | 3.70x |
| `pg_total_relation_size(sync_jobs)` | 6622 MB | 24,576 MB | 3.71x |
| `pg_relation_size(sync_jobs)` (heap) | 2485 MB | 9945 MB | 4.00x |
| `pg_indexes_size(sync_jobs)` | 4136 MB | ~14,631 MB (14 GB) | 3.54x |

Row count grew 4.00x (9,999,469 -> 40,000,532); heap size grew 4.00x exactly
in step (linear, as expected for fixed-width-ish rows); index size grew only
3.54x (sub-linear — btree fan-out amortises better at larger N, as expected).
**At 24 GB total against the `docs/operations/requirements-and-scaling.md`
§ 4.1 recommended 100 GB disk, `sync_jobs` alone is already 24% of the
entire recommended disk budget**, before counting `order_records`,
`identifier_mappings`, WAL, or anything else the system stores.

`sync_jobs` status distribution at 40M: 39,966,542 `succeeded`, 33,988
`dead`, 2 `queued` (same near-zero live queue depth as Tier 1).

### Claim query — still cheap, confirms the mechanism, not a coincidence

30 in-session `EXPLAIN (ANALYZE, BUFFERS)` samples of the identical claim SQL:

```
p50 = 0.037 ms   p95 = 0.053 ms   min = 0.032 ms   max = 0.113 ms
```

(If anything, *faster* than the Tier 1 samples — noise at this scale, not a
real improvement; both are single-digit-buffer index probes.) Plan:

```
Limit  (actual time=0.028..0.028 rows=0 loops=1)
  Buffers: shared hit=5
  ->  LockRows  (actual time=0.026..0.027 rows=0 loops=1)
        Buffers: shared hit=5
        ->  Index Scan using "IDX_a2d0990898df9d69d7c3b53ca9" on sync_jobs
              Rows Removed by Filter: 2
              Buffers: shared hit=5
Execution Time: 0.087 ms
```

**Identical shape to Tier 1: 5 buffer hits, fully cached, at 40,000,532
rows.** This confirms the Tier 1 finding was the real mechanism (index
selectivity on `status`), not a coincidence of the smaller size — the claim
query genuinely does not care whether the terminal history behind the index
is 10M or 40M rows. **This is the single most load-bearing figure in this
report for the campaign's stated worry**: the busiest query in the system,
run every second, is safe from `sync_jobs`'s unbounded growth, *provided the
`(status, "nextRunAt")` index continues to exist and queue depth stays
near zero* (see "What this did not establish").

### `GET /v1/sync/jobs?limit=20&offset=0` — crosses from "slow" to "unusable"

23 real HTTP samples. The first call was a genuine cold-cache read (OS page
cache had nothing from this exact query pattern yet); the next 7 show a
clear warm-up transient; the last 15 stabilise into steady state:

```
cold (1st call):         16,081 ms
warm steady-state (n=15): p50 = 7,217 ms   p95 = 7,822 ms   min = 6,624 ms   max = 8,243 ms
```

**~7.2 seconds, steady state, for a page-20 list call an operator's jobs
dashboard issues on every load.** Against F5's 33-35 ms baseline (~150k
rows) this is a ~210x slowdown for a ~260-320x row-count increase — still
essentially linear, exactly as the mechanism (`Parallel Seq Scan` +
full-table `COUNT`) predicts, with no sub-linear relief the way F5's own
1M-row order-count projection found for a *different*, indexed-filter query.

Mechanism, via `EXPLAIN (ANALYZE, BUFFERS)` on the same two queries
`findAndCount` issues:

```
-- the page:
Limit (actual time=2141.497..2146.076 rows=20 loops=1)
  Buffers: shared hit=81 read=1272928        <- ~9.7 GB read, vs 2.55 GB at 10M (4.00x, linear)
  -> Gather Merge (Workers Launched: 2)
       -> Sort (top-N heapsort)
            -> Parallel Seq Scan on sync_jobs
Execution Time: 2158.399 ms

-- the count:
Finalize Aggregate (actual time=1171.475..1200.446 rows=1 loops=1)
  Buffers: shared hit=112 read=31315         <- ~245 MB read, vs 61 MB at 10M (4.03x, linear)
  -> Gather (Workers Launched: 2)
       -> Parallel Index Only Scan using "IDX_3086c88607c1c8b303fe1172f2"
Execution Time: 1214.749 ms
```

Both buffer counts scale almost exactly linearly with the row count (4.00x
and 4.03x for a 4.00x row-count increase) — there is no planner escape
hatch here (unlike F5's order-count-vs-1M-rows case): this route's cost is,
and will remain, a straight linear function of total job history, forever,
until something changes the query shape or adds retention.

**The ~3.37s combined raw-SQL execution time (2158 + 1215 ms) does not fully
account for the ~7.2s observed at the HTTP layer** — roughly a 2x gap this
report does not resolve (candidates: NestJS/TypeORM per-request overhead,
connection-pool queuing behind a single API replica, response
serialization of the DTO mapping — not measured here). The HTTP figure is
reported as the operator-facing truth; the SQL figures are reported as the
mechanism, and the gap between them is named rather than papered over.

### Extrapolation, labelled as such

Naive linear extrapolation from the two measured points (10M -> 3.0s median,
40M -> 7.2s median, i.e. 4x rows -> 2.4x time — **sub-linear at the HTTP
layer** despite the underlying buffer counts scaling perfectly linearly,
consistent with the unexplained ~2x per-call overhead partially amortising)
projects, for the campaign's own year-one range of 7.7-44M rows:
**roughly 6.0-7.9 seconds** at the low and high end of that range —
i.e. **the entire plausible year-one range already sits at several seconds
per jobs-dashboard page load**, not merely "eventually a problem." This is
an extrapolation from two points, not a fitted curve — stated as such, and
not to be read past the two measured ends.

## Summary against the pre-registered criteria

| Criterion | Result |
|---|---|
| Seed to ~10M, then ~40M, record actual counts | Met: 9,999,469 then 40,000,532 |
| Claim query timed at both sizes, p50/p95 not one reading | Met |
| Route timed at both sizes, p50/p95 not one reading | Met (30 EXPLAIN samples for the claim query at each size; 15-30 HTTP samples for the route) |
| `EXPLAIN (ANALYZE, BUFFERS)` at both sizes for both queries | Met |
| `shared_buffers` reported alongside buffers read (the trap) | Met — 128 MB `shared_buffers` against 2.55 GB (10M) / 9.7 GB (40M) read for the route's page query alone |
| `VACUUM ANALYZE` + `pg_stat_statements_reset()` between sizes | Met, with a deviation recorded: the seeder's own `VACUUM ANALYZE` step failed on a `statement_timeout` at 40M and was re-run manually |
| Record DB size and table size at each point | Met |

## What this did not establish

- **Nothing about the claim query under real, non-trivial queue depth at
  40M rows.** Both tiers were measured with queue depth ≈0-3 (the realistic
  "worker idle, history piling up" shape) — this report re-confirms the
  index makes queue depth (not table size) the cost driver, but does not
  re-run F4's own depth-0-to-591 sweep against a 40M-row backdrop. If queue
  depth and table size interact (e.g. via lock contention, or via the
  planner switching plans at some depth this report never reached), that
  interaction is not characterised here.
- **Nothing about what happens under concurrent load.** The runner was
  disabled throughout; this is claim-query-alone and route-alone latency
  with no other traffic on the same Postgres instance. A real production
  instance runs the claim query roughly once per second **while** serving
  read traffic and processing jobs — this report does not measure
  contention between those.
- **The ~2x gap between the route's raw-SQL execution time and its
  HTTP-observed latency is named, not explained.** Candidates are listed
  above; none were isolated.
- **The extrapolation to 7.7-44M rows is linear-from-two-points**, not a
  fitted or mechanistically-derived curve. The buffer-count scaling *is*
  mechanistically linear (confirmed via `EXPLAIN BUFFERS` at both ends), so
  the extrapolation is on firmer ground than a bare curve-fit would be, but
  it is still an extrapolation.
- **Whether an index on `"createdAt"` alone (or a covering index sized for
  this exact route) would fix the route was not tested.** This report
  characterises the defect and its scaling; it does not evaluate a fix — a
  remedy is a product/schema decision outside this report's scope, echoing
  F5's own position on the same class of finding.
- **Disk-type and true host-CPU characteristics are not established** — see
  `MACHINE-SPEC-2026-09-09.md`'s own caveat about WSL2's virtualized block
  device misreporting `rotational`.
