# Campaign summary - host `epyc32`, 2026-09-08

_Epic #2840, branch `perf-programme-2840` @ `4ff884d8e`, stand `lab`.
Host: 32 threads / 122 GiB / KVM guest - `machine-spec-epyc32-2026-09-08.md`.
Findings and stand repairs: `campaign-notes-epyc32-2026-09-08.md`._

Every figure is **measured**, **derived** or **extrapolated**, and every
figure whose only evidence is a discarded run says so at the point of use.

---

## 1. Orders per hour, and what binds it

Three arms, same 900-order backlog, same ~295 s window, one knob changed at a
time. Service time is the **mean `lastAttemptDurationMs` over succeeded
`marketplace.order.sync` rows inside that arm's own window** - never a
summary p50, which spans requeued partial attempts.

| # | destination rate limit | realtime lane cap | orders / window | **sustained** | **service time** | queue grew? |
|---|---|---|---:|---:|---:|---|
| 1 | 60/min, 4 concurrent (stock) | 4 / 2 | 97 / 295 s | **1 184 /h** | **5 539.4 ms** (n=97) | YES |
| 2 | 6 000/min, 32 concurrent | 4 / 2 | 270 / 296 s | **3 284 /h** | **2 002.4 ms** (n=270) | YES |
| 3 | 6 000/min, 32 concurrent | **16 / 16** | 900 / 294 s | **>= 11 020 /h** | **3 121.3 ms** (n=900) | **NO - drained** |

All **measured**. The ladder is the answer to "what binds":

1. **At stock settings the destination's own rate limit binds.** 60/min with
   4 concurrent inflates per-order service time to 5.54 s.
2. **Raise it and the realtime lane cap binds.** Service time falls 2.8x to
   2.00 s - so the limiter really was the cost - but throughput rises only to
   3 284/h, because 2 per-scope slots is now the constraint.
3. **Raise both and the offered load runs out.** The backlog drained inside
   the window, so **11 020/h is a FLOOR, not a ceiling** - the scenario's own
   summary says so.

**Attribution check** (`perScope / service time`, **derived**): 1 300 and
3 596 /h against 1 184 and 3 284 measured - both land at **91%** of their slot
arithmetic, the gap being the runner's 1 s poll. The drained arm lands at 60%,
which is what a floor looks like. **18 454/h is not a result.**

> **Verdict status:** all three throughput arms are `DISCARDED`, every one on
> the same artefact - `post_guard_destination_creates` runs the instant the
> fixed 295 s window closes and counts the **one** order still completing its
> ~2.9 s destination create. Verified post-hoc across all three windows:
> **1 283 orders created, 0 still lacking a destination `syncedAt`, 0 failed.**
> The windows were healthy; the guard has no upper bound on `createdAt`.

**Single-order latency (arm `latency`, `VALID`, n=25):** **5 799 ms** p50 end
to end, p95 5 870 ms. Largest hop is the destination create at **2 875 ms**
(50%); the two queue pickups cost 1 447 ms together, which is the 1 s poll
appearing twice.

## 2. Does the operator panel stay usable at 10k / 100k / 1M orders?

**Yes on this host - nothing exceeds ~170 ms p95 at 1M.** But two routes scale
and four do not. All **measured**, ms, `VALID` at all three sizes.

| Route | 10k p50/p95 | 100k p50/p95 | 1M p50/p95 | 10k->1M | scales? |
|---|---:|---:|---:|---:|---|
| `orders_list` | 16.0 / 21.4 | 32.9 / 40.8 | **63.1 / 73.3** | 3.9x | yes |
| `orders_list_needs_attention` | 23.5 / 32.7 | 65.1 / 73.1 | **158.2 / 169.6** | **6.7x** | **worst** |
| `order_detail` | 10.5 / 16.8 | 10.0 / 18.5 | 10.5 / 20.8 | 1.0x | no |
| `products_list` | 23.5 / 31.6 | 22.9 / 29.3 | 22.9 / 31.6 | 1.0x | no |
| `product_detail` | 12.1 / 16.7 | 11.7 / 15.5 | 12.0 / 16.9 | 1.0x | no |
| `sync_jobs_list` | 56.1 / 61.9 | 55.6 / 62.7 | 55.2 / 62.3 | 1.0x | no |
| `page_shell_total` | 54 / 74.8 | 68 / 85.0 | 99 / 116.7 | 1.8x | yes (via the two above) |

**The cost is the pagination COUNT, not the page of rows.** From
`pg_stat_statements` at 1M (**measured**, mean per call):

- `SELECT COUNT(1) FROM order_records` - **48.572 ms** x 498 calls -> ~77% of
  `orders_list`
- the same COUNT with the needs-attention predicate - **143.233 ms** x 147
  calls -> ~91% of `orders_list_needs_attention`

Fetching the rows themselves costs **0.253 ms**.

> **Do not compare 158 ms against the campaign's 8.90 ms.** The two-stage
> paginated total lives on `origin/2943-two-stage-paginated-total`
> (`6944868ef`) and `git merge-base --is-ancestor 6944868ef HEAD` is **false** -
> it is not on this branch. The correct comparison is the reference host's own
> pre-split figure on this branch, **149.0 ms**, which is 6.0% from mine on
> machines with different core counts and 8x the RAM.

**The four flat routes are flat for a reason, not by luck:** two are
primary-key reads, and two are paginated over tables this scenario holds
constant (products at 10 000, `sync_jobs` at 122 758). They say nothing about
those tables growing.

## 3. Requests per product for a catalogue pull, and wall clock for 100

**Measured**, from PrestaShop's own access log over one full sweep cycle:
**500 products, 917 variants, 422 s, 2 029 requests.**

| requests | resource | per product |
|---:|---|---:|
| 1 500 | `GET tax_rules` | 3.000 |
| 500 | `GET taxes` | 1.000 |
| 10 | `GET products` | 0.020 |
| 10 | `GET combinations` | 0.020 |
| 9 | categories / options | 0.018 |
| **2 029** | **total** | **4.058** |

Three figures that must not be collapsed into one:

- **Total: 4.058 req/product.**
- **Catalogue read alone: 0.044 req/product** - the batched sweep (#2593)
  working as designed: 500 hydrated products in 20 requests.
- **Tax resolution: 4.000 req/product - 98.6% of the entire pull.**

**Wall clock:** 500 products in **422 s** (measured) = 0.844 s/product
(derived) -> **100 products in ~84 s (derived, not observed)**. The smallest
unit this sweep runs is a 100-product batch and five overlapped here, so ~84 s
is likelier an upper bound than a lower one.

**What binds it: the rate limiter, at 96% utilisation.** 2 029 / 422 s =
**4.81 req/s** against the manifest's declared 300/min = 5.00/s. Cutting the 4
tax requests per product would cut the pull by ~98% at the same limit, because
once the limiter is the ceiling, request count and elapsed time are the same
quantity.

> **Condition that must travel with this figure:** this stand had **no usable
> tax rule at all** until this campaign created one (Finding 5). These 2 000
> tax requests are the cost of a *correctly configured* shop. A stand without
> tax configured reports a far lower req/product while being unable to create
> a single order.

## 4. Two other flows measured

**F3 - webhook ingress.** **600 req/s accepted with 0 dropped iterations and
0 non-2xx**, p95 30.7 ms, k6 at 45/200 VUs (22.5%) - so this is a system
result, not a generator limit. The saturation knee is independently
**~590-626 req/s from 8 concurrent callers up**, agreeing to 3.3% across two
runs. The durability gate's second row costs **0.678 ms** of the ~8 ms accept.

**F2 - stock propagation.** Stock write -> OL's own `inventory_items`
**824 ms** p50; -> `offerQuantity.update` dispatched **1 804 ms** p50, of which
roughly 1 s is queue-pickup from the 1 s poll. **Excludes the shop's own
outbox cron cadence**, which dominates any real deployment on this image.

**F10 - dependency failure. This is the campaign's most serious behavioural
finding.** In five destination-failure arms the job ledger reports
`succeeded / outcome: ok` for **every** order while the orders do not arrive:

| arm | fault | jobs ok | attempts | deferred | orders lost |
|---|---|---:|---:|---:|---:|
| `D1` | 500 on a fraction | 12/12 | 0 | 0 | 5 of 12 |
| `D2a` | 429 **with** `Retry-After` | 12/12 | 0 | 0 | 5 of 12 |
| `D2b` | 429 without | 12/12 | 0 | 0 | 11 of 12 |
| `D3` | connection held | 12/12 | 0 | 0 | 1 of 12 |
| `D4` | cart ok, `importorder` fails | 12/12 | **0** | **0** | **12 of 12** |

**The loss is permanent**: 2.5 h after the last fault was lifted, **36 of the
131 orders created during F10 still have no destination `syncedAt`**. Nothing
re-drove them - `attempts` is 0 everywhere, because the jobs had already
declared success. `Retry-After` is ignored and `deferredTotalMs` is 0.

The **source** side behaves the opposite way: under a 100% hydration timeout
the queue simply stops draining and every order completes correctly once the
source returns. **The visible failure mode is the harmless one.**

## 5. Scenarios that produced no valid verdict, and which guard refused

| Scenario | Outcome | Refused by |
|---|---|---|
| F1 `throughput-baseline` / `-destination-raised` / `-lane-raised` | `DISCARDED` x3 | `post_guard_destination_creates` - 1 order still in flight at window close (§1) |
| F2 run 1 (`run1788875917`) | `VALID` **but measured nothing** - every hop `n=0` | **no guard exists** for "the scenario observed its own subject" (Finding 7) |
| F10 `I2` | `VALID`, but `lab-api` died mid-window and stayed dead 3 h | `post_guard_containers_stable` compares `StartedAt`; a crash does not change it (Finding 8) |
| F10 `I3` (first attempt) | aborted pre-flight | `guard_scheduler_off` - `OL_SCHEDULER_ENABLED=true`, provenance unexplained. Re-ran clean. |
| **F7** lane starvation | **not run** | `guard_stand_exclusive` - a second live session held the stand (Finding 9) |
| **F4** claim contention | **not run** | same - and it would rescale the shared `worker` service |
| **F8** lane caps | **not run** | same - and it WRITES a lane cap into the shared `.env.lab` |
| **sustained** mixed load (3 h) | **not run** | same |
| `limiter-ab` | **not run, deliberately** | arms on an env flag #2984 deleted |
| F6 / F11 / F12 | **do not exist** | #2844 / #2979 / #2980 unbuilt |

**F7/F4/F8/sustained stopped for coordination, not for a measurement
reason.** From 18:28:54 a second live Claude Code session measured the same
stand from a git worktree of this repo on branch
`2840-order-latency-and-burst-drain`. Every figure in this campaign completed
by **18:08:21Z at the latest**, verified from the manifests, so none is
affected; my checkout stayed at `4ff884d8e` with the scenarios unmodified and
the images still carrying my SHA. `guard_stand_exclusive` is the only guard
here that prevented a bad measurement rather than discarding one afterwards.

## 6. What this campaign did NOT establish

- **An order-throughput ceiling.** No arm saturated the system with the lane
  cap raised; ">= 11 020/h" is a floor.
- **Where the realtime lane's knee sits** between caps 2 and 16 - that is F8.
- **Behaviour under sustained mixed load**, cross-lane starvation, or
  multi-replica claim contention - F7 / F4 / sustained.
- **Any route's behaviour with ITS OWN table grown** - products and
  `sync_jobs` were held constant across all three F5 sizes.
- **Whether F10's lost orders are recoverable** by the operator Retry action -
  only that nothing automatic re-drove them in 2.5 h.
- **Repeat agreement** anywhere. One run per arm; #2845's policy does not
  exist.
- **Anything about a real marketplace.** Allegro is a local stub at configured
  p50s; faults are injected by a local proxy.
- **Cross-machine comparability.** 32 vs 28 threads and 122 vs 15 GB; the RAM
  gap alone makes the 1M-order page-cache figures non-transferable.
