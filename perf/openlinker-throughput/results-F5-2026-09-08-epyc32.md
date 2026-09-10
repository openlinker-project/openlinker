# F5 - operator read path at row count

_Run 2026-09-08 on the `lab` stand, host **`epyc32`** (see
`machine-spec-epyc32-2026-09-08.md` - 32 threads, 122 GiB, KVM guest).
Scenario `scenarios/f5-read-path.sh` (#2843, epic #2840), unmodified, default
three-size path. Branch `perf-programme-2840` @ `4ff884d8e`._

**All three size steps returned `status=VALID`.** 0 non-2xx across
1 449 / 1 450 / 1 449 route requests.

---

> ## Correction 1 (added 2026-09-09) - do not read the 10k->1M curve as sub-linear
>
> Upstream `53d124f77` **withdraws the sub-linear scaling conclusion** the
> campaign had published from this range. A fourth point at **2M rows**, on the
> same table and the same predicate, measured **1.84x for a 2x step** - i.e.
> linear - and concluded that the earlier ratio "described a boundary, and the
> boundary has been crossed", with the standing instruction that **anyone sizing
> hardware past 1M orders should assume linear**.
>
> This report never used the phrase, but its own numbers invite the reading:
> 100x the rows for 6.7x the time on `orders_list_needs_attention` looks
> strongly sub-linear, and a reader could size on it. **They may not.** The
> measurements below stand for the 10k-1M range they cover; the CURVE beyond 1M
> is linear. Nothing here is deleted or rewritten - a quietly edited number is
> worse than a wrong one, because nobody can tell it moved.

## 1. Answer: does the operator panel stay usable at 10k / 100k / 1M orders?

**Yes, on this host - every route stays under ~170 ms at p95 at 1M orders.**
But the two order-list routes are the only ones that scale with the dataset,
and one of them is 7x its 10k figure by 1M.

All values **measured**, milliseconds, from `route-report.txt` per step.

| Route | 10k p50 / p95 | 100k p50 / p95 | 1M p50 / p95 | 10k -> 1M (p50) | scales? |
|---|---:|---:|---:|---:|---|
| `orders_list` | 16.00 / 21.38 | 32.90 / 40.79 | **63.14 / 73.33** | **3.9x** | yes |
| `orders_list_needs_attention` (filtered) | 23.54 / 32.66 | 65.06 / 73.11 | **158.17 / 169.57** | **6.7x** | yes, worst |

**The 6.7x is measured and true of 10k-1M. It is NOT a sub-linear curve** - see Correction 1; past 1M, assume linear.
| `order_detail` | 10.50 / 16.81 | 10.04 / 18.50 | 10.48 / 20.80 | 1.0x | no |
| `products_list` | 23.45 / 31.64 | 22.85 / 29.33 | 22.89 / 31.61 | 1.0x | no |
| `product_detail` | 12.14 / 16.65 | 11.69 / 15.53 | 11.97 / 16.88 | 1.0x | no |
| `sync_jobs_list` | 56.09 / 61.90 | 55.57 / 62.68 | 55.20 / 62.27 | 1.0x | no |
| `page_shell_total` (5-request nav fan-out) | 54.00 / 74.80 | 68.00 / 85.00 | 99.00 / 116.70 | 1.8x | yes (via the two above) |

Sample sizes at 1M: `orders_list` n=354, `needs_attention` n=147,
`order_detail` n=273, `products_list` n=294, `product_detail` n=227,
`sync_jobs_list` n=154, `page_shell_total` n=144. The scenario's own
`MIN_N_FOR_PERCENTILE=30` / `MIN_N_FOR_STABLE_P99=100` thresholds are met
everywhere, so every percentile above is reportable.

**The four flat routes are flat for a reason, not by luck.** `order_detail`
and `product_detail` are single-row primary-key reads. `products_list` and
`sync_jobs_list` are paginated over tables this scenario never grows -
products stayed at 10 000 and `sync_jobs` at 122 758 rows across all three
steps (manifest `f5.rowCounts`). They are evidence that the harness's own
overheads are constant, NOT evidence that those routes would survive their
own tables growing 100x. That was not tested.

## 2. What makes the two order routes scale: the pagination COUNT

From `pg_stat_statements` at the 1M step (**measured**, mean ms per call):

| calls | total ms | **mean ms** | statement |
|---:|---:|---:|---|
| 498 | 24 188.63 | **48.572** | `SELECT COUNT(1) AS "cnt" FROM "order_records" "rec"` |
| 147 | 21 055.28 | **143.233** | `SELECT COUNT(1) ... WHERE NOT recordStatus=$2 AND NOT recordStatus=$3 AND syncStatus @> $4::jsonb` |

Set against the route medians (**derived** - a mean against a median, so
treat as an attribution, not an identity):

- `orders_list` p50 63.14 ms, unfiltered COUNT 48.57 ms mean -> the count is
  roughly **77%** of the route.
- `orders_list_needs_attention` p50 158.17 ms, filtered COUNT 143.23 ms mean
  -> roughly **91%** of the route.

So it is not the page of rows that costs - fetching them is
`SELECT "rec"."internalOrderId" ...` at **0.253 ms** mean over 498 calls. It
is counting the whole table to render a total.

## 3. This is a PRE-pagination-split measurement, and must not be compared to 8.90 ms

The campaign's cross-machine summary carries a row reading *"Orders list,
filtered, 1M orders: 184.29 -> 8.90 ms after the pagination split"*. That
"after" figure does **not** belong to this branch.

Verified: the two-stage paginated total lives on
`origin/2943-two-stage-paginated-total` (merge `6944868ef`), and
`git merge-base --is-ancestor 6944868ef HEAD` is **false** - it is not in
`perf-programme-2840`'s history at `4ff884d8e`.

The correct comparison for this run is the reference host's own figure on
this branch, `results-F5-2026-09-06.md`, which reports
`orders_list_needs_attention` at 1M as **149.0 ms** p50 against this host's
**158.17 ms** - 6.0% apart (`|158.17-149.0| / 153.59`), on machines with
different core counts and 8x different RAM.

Quoting 158 ms against 8.90 ms would report a fix's absence as a regression.

## 4. Conditions

| | |
|---|---|
| Dataset at the 1M step | `order_records` 1 000 000, `order_line_items` 2 499 313, `sync_jobs` 122 758, products 10 000 / variants 20 000 |
| Seed RNG | `0.271828` (fixed - the distribution reproduces, not merely resembles) |
| `statement_timeout` on the api role | 30 000 ms |
| DB pool | `OL_DB_POOL_MAX=40` x 2 processes = budget 80 against `max_connections=200` |
| Container limits | **none** on `lab-api` / `lab-worker-1` (manifest `containerLimits`) - so these figures include whatever the host's other containers were doing |
| Runner / scheduler | F5 deliberately does NOT require them off, and does not purge the queue - the point is measuring against a real history |

## 5. What this run did NOT establish

- **Any route's behaviour with ITS OWN table grown.** `products_list` and
  `sync_jobs_list` read tables this scenario holds constant. Their flatness
  across the three steps says nothing about 1M products or 10M jobs.
- **Concurrency behaviour.** The browse mix runs at 20 iterations/s across
  20 VUs and the page shell at 2/s across 5. These are single-operator
  latencies, not a contended-panel result. No arm saturated anything.
- **The search / trigram sites #2843 names.** No `Offer` or
  `DestinationCategory` rows exist on this stand, so the ILIKE/trigram
  read paths were never exercised - the scenario says so itself rather than
  implying coverage.
- **The row count at which any route crosses a specific latency.** Three
  points on a curve locate a trend, not a threshold.
- **Repeat agreement.** One run per size step.
