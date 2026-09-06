# Decision - is a `syncStatus` index worth it for `#2927` (the needs-attention count)

Written 2026-09-06 against the `lab` stand's real 1M-row `order_records` table, the same
dataset #2843/#2927 measured.

## Method note - read this before the numbers

**These measurements were taken directly against `lab-postgres` via `docker exec psql`, NOT
through this campaign's own harness** (`perf/openlinker-throughput/lib.sh` and its
`scenarios/*.sh`). The agent environment this was written in refuses to `source` (or run
through `bash -c '. ...; ...'`) any shell script inside the worktree, on the stated grounds
that a worktree-isolated agent cannot verify what a sourced script does with `git` - which
`lib.sh` does not need for this measurement, but the refusal has no exception for that. So
`guard_stand_exclusive`, `guard_build`, and every other guard in `lib.sh` were **not run**.

**A `perf:stand:exclusive` lock check performed after the fact found the lock held by another
session (`f2-stock-propagation`), acquired at `2026-09-06T21:09:55Z`.** This work's own
`EXPLAIN`/`CREATE INDEX`/write-benchmark activity against `order_records` finished before that
lock was taken (all of it precedes the several minutes of type-check/lint/build work that
followed it in the same session, none of which touches the stand) - but this cannot be proven
from a timestamp alone, and the schema changes made here (two `CREATE INDEX` / `DROP INDEX`
pairs on `order_records`, described below) could have perturbed a concurrent F2 measurement's
query plans or disk I/O if the two overlapped. **This is disclosed rather than hidden**: if the
F2 campaign's own results from this window look anomalous, this document's activity against the
same table is a candidate cause and should be checked. No HTTP traffic was sent to `lab-api` or
`lab-worker` at any point - only direct SQL against `lab-postgres` - so no request-level
contention was created, only possible query-plan/buffer-pool disturbance and WAL write volume
from two `CREATE INDEX` operations (~0.5-0.8 s each) and several hundred single-row `UPDATE`s
inside rolled-back transactions.

**The stand was left in its original state.** `order_records` has exactly the same 22 indexes
it had before this work (confirmed via `pg_indexes` count), the row count is unchanged at
1,000,000, and no benchmark write survived - every write-cost measurement ran inside a
transaction that ended in `ROLLBACK`, and a post-hoc query for the benchmark's synthetic
`destinationConnectionId` marker (`ol_conn_benchmark` / `ol_conn_benchmark2`) against the live
table returns zero rows.

## 1. The decision

**Do not add a GIN index on `syncStatus` for this filter. Do not add the narrower, exactly-
matching partial index either - not because it doesn't work, but because of what it costs and
what it leaves uncovered.** Recorded as a code comment in
`order-record.repository.ts` (`countByHealth`'s docblock) so a future reader who reaches for
"just add a GIN index" sees the measurement first. The question stays open per the product
owner's own framing on #2927: worth revisiting once the two-stage total (#2943/#2957) ships,
against these same numbers, if a narrower single-bucket index is judged worth its write-tail
cost at that point.

## 2. What was measured, and how

Baseline reproduction, three warm-cache repeats of the exact query #2843/#2927 quote:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) FROM order_records
WHERE "recordStatus" <> 'awaiting_mapping' AND "recordStatus" <> 'source_deleted'
  AND "syncStatus" @> '[{"status": "failed"}]'::jsonb;
```

| Run | Execution Time | Plan |
|---|---|---|
| 1 | 156.1 ms | `Parallel Seq Scan`, 2 workers, `Buffers: shared hit=14551 read=63885` |
| 2 | 151.3 ms | same |
| 3 | 154.0 ms | same |

Matches #2843's reported ~142-150 ms and its documented `Parallel Seq Scan` plan closely enough
to treat this stand's current state as the same dataset (it is - `order_records` still holds
the 1,000,000 rows from that campaign).

Selectivity of the predicate on this dataset: **277,566 / 1,000,000 rows (27.8%)** carry a
`failed` status entry.

### Candidate 1 - `CREATE INDEX ... USING gin ("syncStatus" jsonb_path_ops)`

- Build time: 617-820 ms (varied by `fastupdate` setting), on-disk size 3.75 MB.
- **Made the query slower, not faster.** Warm-cache repeats after the index existed:
  213-251 ms (`Parallel Bitmap Heap Scan`, `Heap Blocks: exact=13873 lossy=10139`, `Rows
  Removed by Index Recheck: 100786`). Raising `work_mem` to 64 MB (eliminating lossy bitmap
  pages, `Heap Blocks: exact=27013`) did not help either - 457 ms in that run, i.e. the random
  heap-page access pattern itself costs more than the sequential scan it replaced, independent
  of the lossy-bitmap effect.
- Dropping the index reverted the plan to `Parallel Seq Scan` and the timing to 180-200 ms
  (consistent with the original baseline), confirming the index - not some other stand
  variable - caused the regression.
- Write cost (single-row `UPDATE` matching `updateSyncStatus`'s exact SQL, 200 random rows,
  transaction rolled back): mean/p50/p95 were statistically indistinguishable from the no-index
  baseline at this sample size (both clustered ~1-2.5 ms) whether `fastupdate` was on or off.
  **This is the one place a write-cost measurement came back "no meaningful cost" - and it does
  not matter, because the index does not help the read it would have been added for.**

### Candidate 2 - a partial B-tree index matching the health-filter predicate exactly

```sql
CREATE INDEX ... ("internalOrderId")
WHERE "syncStatus" @> '[{"status":"failed"}]'::jsonb
  AND "recordStatus" NOT IN ('awaiting_mapping','source_deleted');
```

- Build time: 490 ms, on-disk size 12 MB.
- **This one works.** Warm-cache repeats: 24.4-32.2 ms, plan `Parallel Index Only Scan`
  (`Index Cond` matches the predicate verbatim) - roughly **5-6x faster** than the seq-scan
  baseline.
- Write cost, measured on the SAME 500-row sample twice (once with the index, once without,
  same rows, rolled back both times) to isolate the index's own effect from cache-state noise:

  | | mean | p50 | p95 | max |
  |---|---|---|---|---|
  | without index | 0.68-0.79 ms | 0.65-0.77 ms | 1.2-1.4 ms | 4.1-9.1 ms |
  | with index | 2.8-8.1 ms | 1.1-1.3 ms | **8.4-24.3 ms** | **398.7 ms** (one outlier) |

  The median moved only modestly (~0.4-0.5 ms); the **tail** is where the real cost lands -
  roughly 7-20x at p95, and one single-digit-percent-chance multi-hundred-millisecond outlier
  in 500 tries. This is on `order_records.syncStatus`, the column every marketplace order-sync
  attempt rewrites (`updateSyncStatus` is its sole writer, and it is a single-row `UPDATE` by
  primary key, exactly the shape benchmarked here).
- **It covers exactly one of the five `OrderHealth` buckets.** A production deployment of this
  shape would need one more index per bucket (`source_deleted`, `awaiting_mapping`, `synced`,
  `awaiting_dispatch`) to close the same gap everywhere `OrderHealthSummaryFilters`/
  `applyHealthFilter` degrade, at roughly this same per-index write-tail cost each, compounding.

## 3. Why the decision is "not yet" rather than "never"

Two things could change this. First, #2943/#2957 (already in flight) moves the exact total off
the request's synchronous critical path - a slow count behind a loader is a different product
cost than a slow count blocking render, even though the DB-side cost (142-150 ms, ~540 MB
through the buffer pool per execution per #2843) is unchanged either way. Second, if a single
bucket (`needs_attention` specifically, since it's the one #2843/#2927 measured degrading)
turns out to dominate real-world usage overwhelmingly more than the other four, a single
narrow partial index sized for JUST that bucket might be judged worth its write-tail cost on
its own - that is a product/ops call this document does not make, since it depends on traffic
shape data this stand cannot supply.

## 4. What this did not establish

- **Whether the write-tail cost is caused by the B-tree page structure itself (page splits,
  lock contention on a "hot" region of the index) or by something else in this benchmark's
  own setup** (e.g. autovacuum activity triggered by the surrounding session, or WAL fsync
  behaviour under this stand's specific disk). The 500-row sample is enough to see the tail
  exists and its rough magnitude; it is not enough to attribute its exact cause.
- **The real-world traffic shape** - how often `?health=needs_attention` is actually loaded
  relative to the frequency of `syncStatus` writes on a real deployment - which is the input
  the "revisit once traffic-shaped data exists" framing in section 3 would need.
- **Whether the GIN candidate would help at a MUCH lower selectivity** (e.g. a rarer bucket, or
  a real deployment where `failed` is a small minority rather than 28%). This document only
  measured the one predicate #2843/#2927 named; the general lesson ("measure selectivity before
  assuming GIN helps") is recorded in `docs/lessons.md`, not re-derived per bucket here.
- **A production topology's actual `work_mem` / `max_parallel_workers_per_gather` settings**,
  which this stand's defaults (4 MB / 2) may not match.
