# Re-measurement: the paginated total as a second stage (#2947, epic #2943)

**Date**: 2026-09-06
**Dataset**: the #2843 lab stand, `order_records` at **1 000 000** rows (`perfseed_ord_*`), unchanged
**Verdict**: the prediction held. Time-to-rows on the filtered orders list is **8.90 ms p50**, against **184.29 ms** for the same route before the split - a **20.7x** reduction, close to the ~21x the epic predicted from #2843's figures.

---

## What was measured, and what was not

`perf/openlinker-throughput/drivers/two-stage-total.js`, a purpose-built k6 driver, **not** `f5-read-path.sh`.

That is a deviation from #2947's own instruction and it is stated first rather than buried. The reason is mechanical: this epic merges to `main`, and the F5 harness (`lib.sh`, `scenarios/`, `seed/`, the read-path driver) lives on the performance-programme branch, not on `main`. Running F5 would have meant importing the whole harness into this branch, and its `guard_build` additionally requires a `Dockerfile` LABEL that only exists on that branch. Neither belongs in a PR about pagination.

What was kept from F5's shape, because it is what makes the numbers mean anything: one k6 `ramping-arrival-rate` scenario, one named `Trend` per route (never a blended one), `summaryTrendStats` carrying p99 and the per-route `count`, and a **status check before the sample is recorded** - the #2590 correction, without which a fast error counts as a fast sample.

**The control is in the run, not in the archive.** The unfiltered and filtered `GET /orders` routes are measured in the same window, on the same dataset, by the same binary - and they are byte-identical in behaviour to their pre-change selves, because `?withTotal=false` is opt-in and the combined path was left untouched. So the before/after here is an A/B inside one run rather than a comparison against a figure recorded on a different day on a differently-loaded machine. For a claim that is a *ratio between two routes*, that is stronger evidence than reproducing F5 would have been.

**Setup.** A container built from `0c7c2e67f` - this branch's HEAD at the time of the run, i.e. the four stage commits with no review fixes on top (`ol-2943:api`, `--target production`) on the lab network, against the same `lab-postgres` / `lab-redis` as the stand. The stand's exclusivity lock (`perf:stand:exclusive`) was held for the run. The existing `lab-api` was left untouched and idle.

**Honest caveats.**

- The absolute latencies are higher than #2843's (`184 ms` here versus its `149 ms` for the same combined route). The machine carries three other Docker stacks; this is ambient load, and it is why the report leans on the in-run ratio rather than on cross-day absolutes.
- One run, no repeats. Per-route `n` is 220-263, so the p50 and p95 are solid; the **p99s are two or three observations each and are indicative only** (at n=259 a p99 interpolates between the 2nd and 3rd worst samples, which is why `count_needs_attention` jumps 221 -> 390 between them). Nothing below rests on a p99 - the argument is entirely p50 ratios. An earlier draft cited an "n>=100 threshold"; there is no such convention in this repository and the claim is withdrawn.
- The later review rounds changed no SQL on the measured path. Diffing `0c7c2e67f` against HEAD for the two repositories involved leaves, after comments are excluded, three line-wrapping changes and nothing else - no predicate, no clause, no method body. The figures therefore still describe the shipped read.
- Only `/orders` was measured. `/listings`, `/products` and `/customers` are the same shape and are explicitly **unmeasured**, exactly as the epic states.

---

## Time-to-rows and time-to-total, separately

k6, 1450 requests, **0 non-2xx**, **20 req/s at the plateau** (17.06 averaged over the whole 85 s window: 15 s ramp + 60 s at `TARGET_RATE=20` + 10 s down, which is 1450 requests exactly, so no iteration was dropped). All figures milliseconds. Env: defaults throughout - `TARGET_RATE=20`, `DATASET_LABEL=1M`.

**"0 non-2xx" is evidenced, not assumed.** k6 omits a Counter that never received a sample, so a missing `non_2xx_responses` line is indistinguishable from a counter that was never wired. The check that does not rely on absence: the driver records a Trend sample only on a 2xx, and the six per-route `n` values sum to 220+235+259+244+229+263 = **1450**, the total request count. Every request was therefore a 2xx. The driver additionally carries a `non_2xx_responses: ['count == 0']` threshold, so a future run FAILS on an error rather than quietly reporting a fast one.

### The filtered list - `?health=needs_attention`

This is the shape the epic is about: `syncStatus @> '[{"status":"failed"}]'::jsonb`, a containment no plain index serves.

| Route | n | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| **before** - `GET /orders?...&health=needs_attention` (rows + total) | 220 | **184.29** | 214.05 | 257.60 |
| **time-to-rows** - `…&withTotal=false` | 235 | **8.90** | 13.00 | 15.80 |
| **time-to-total** - `GET /orders/count?health=needs_attention` | 259 | **178.66** | 221.56 | 390.54 |

### The unfiltered list

| Route | n | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| **before** - `GET /orders?limit=20&offset=0` | 244 | **45.49** | 60.43 | 77.27 |
| **time-to-rows** | 229 | **8.84** | 13.10 | 14.97 |
| **time-to-total** - `GET /orders/count` | 263 | **39.38** | 48.14 | 61.04 |

---

## What the numbers say

**1. The prediction held.** #2947 expected "rows in roughly 7 ms against a previous 149 ms". Measured: **8.90 ms** against **184.29 ms** on this stand today. The absolute rows figure is 1.9 ms above the prediction and the ratio (20.7x) is within a rounding of the 21x implied by #2843's own numbers. Nothing here needs restating.

**2. The page costs the same whatever the predicate, and that is the whole thesis.** Rows-only is **8.90 ms** filtered and **8.84 ms** unfiltered - indistinguishable. A paged read stops after twenty matches, so the expensive predicate costs it nothing. The count cannot stop, so the same predicate costs it 178.66 ms instead of 39.38 ms.

**3. No database work was removed, and none was expected to be.** 8.90 + 178.66 = 187.6 against a combined 184.29; unfiltered, 8.84 + 39.38 = 48.2 against 45.49. The split is additive to within noise, exactly as the epic states - the same two statements run either way, and what changed is that the operator no longer waits for the second one before seeing rows. **A loader hides 178 ms from the operator without reducing it**, and the buffer-pool pressure below is unaffected by when the query runs. That is #2927's separate subject and this measurement does not touch it.

**4. Even an unfiltered `COUNT(*)` is not free at a million rows** - 39.38 ms p50, against 8.84 ms for the page. The split pays on every orders list, not only the filtered one.

---

## The same thing at the database

`EXPLAIN (ANALYZE, BUFFERS)` on the two statements under one identical predicate, so this is comparable to #2843's own `pg_stat_statements` evidence rather than only to the HTTP figures above.

**The page** - `SELECT * FROM order_records rec WHERE <predicate> ORDER BY "createdAt" DESC LIMIT 20`:

```
Limit  (actual time=0.030..0.229 rows=20 loops=1)
  Buffers: shared hit=76
  ->  Index Scan Backward using "IDX_order_records_createdAt" ...
        Rows Removed by Filter: 53
Execution Time: 0.286 ms
```

**The total** - `SELECT COUNT(1) FROM order_records rec WHERE <the identical predicate>`:

```
Partial Aggregate  (actual time=165.492..165.493 rows=1 loops=3)
  Buffers: shared hit=14916 read=63520
  ->  Parallel Seq Scan on order_records rec
        Rows Removed by Filter: 250083
Execution Time: 175.814 ms
```

**615x apart** at the SQL layer - 0.286 ms against 175.814 ms - and the difference is visible in the plan rather than only in the clock. The page takes an index scan backward and stops after 20 matching rows, having touched **76 buffer pages**. The count takes a parallel sequential scan and touches **78 436 buffer pages in total** - 8 KiB each, so ~613 MB read through the buffer pool in one execution, which is the eviction pressure #2843 describes and the reason the cost is felt application-wide rather than on one page. (`Buffers:` is a cumulative total across the three workers, unlike `rows` and `actual time`, which PostgreSQL divides by `loops`. An earlier draft said "per worker" and then quoted the same ~600 MB, which cannot both be true.)

---

## Reproducing this

**Step 0 - the dataset.** This reuses #2843's 1M-row `order_records` seed
(`perfseed_ord_*`) and the `lab-postgres` / `lab-redis` / `lab-api` stand, both
of which live on the **performance-programme branch**, not here. This branch
carries no seed for them: `perf/openlinker-throughput/` holds only `README.md`,
`bootstrap.sh` (which seeds PrestaShop/WooCommerce/Allegro-stub, not
`order_records`), the driver below, and this report. Seed the stand from that
branch first.

```bash
# 1. Build the API from the branch under test.
docker build --target production -t ol-2943:api .

# 2. Run it against the lab stand's Postgres/Redis, on a spare port.
docker run -d --name api-2943 --network lab_default \
  --env-file <lab-api's own env> -p 19100:3000 ol-2943:api

# 3. Take the stand lock, then run the driver.
docker exec lab-redis redis-cli SET perf:stand:exclusive "<owner>" NX EX 5400
# `/results` must be MOUNTED - the k6 image has no such directory and runs as a
# non-root user, so an unmounted --summary-export silently fails, and the
# per-route `n` values above come from that file.
docker run --rm --network lab_default \
  -v "$PWD/perf/openlinker-throughput/drivers":/drivers:ro \
  -v "$PWD/perf/openlinker-throughput/results":/results \
  -e API_BASE_URL=http://api-2943:3000/v1 -e TOKEN="$TOKEN" -e DATASET_LABEL=1M \
  grafana/k6:1.0.0 run --summary-export=/results/summary.json /drivers/two-stage-total.js

# 4. Tear down and release.
docker rm -f api-2943
docker exec lab-redis redis-cli DEL perf:stand:exclusive
```

## Related

- **#2843** - measured the original cost and seeded the 1M dataset this run reuses
- **#2927** - stays open, and this measurement does not close it: the count is not cheaper, only later
