# F3 - webhook ingress burst throughput

_Run 2026-09-08 on the `lab` stand, host **`epyc32`** (see
`machine-spec-epyc32-2026-09-08.md` - 32 threads, 122 GiB, KVM guest).
Scenario `scenarios/f3-webhook-burst.sh` (#2842, epic #2840), unmodified,
at three offered rates. Branch `perf-programme-2840` @ `4ff884d8e`._

**Every arm below returned `status=VALID`.** Nothing in this file rests on a
discarded run. The three per-rate reports the scenario wrote itself are kept
alongside as `results-F3-2026-09-08-epyc32-rate{50,300,600}.md`; this file is
the cross-rate reading.

---

> ## Correction 1 (added 2026-09-09) - MAX_VUS was the wrong knob, and this report recommends it
>
> Upstream `551567a1c` withdraws the campaign's own ~600/s figure and records the
> transferable reason: **`vus_max.max` is not the configured ceiling.** Under
> `ramping-arrival-rate` k6 grows the pool lazily from `preAllocatedVUs`, and
> `post_guard_generator_saturated` divides by the **grown** figure - so arms with
> `preAllocated=50` against a default `maxVUs=300` reported pools of 137-156 and
> **could not have fixed themselves by raising MAX_VUS at all.**
>
> **This report's own arms are unaffected, and that was checked rather than
> assumed.** All three ran `PRE_ALLOCATED_VUS=200`, and `vus.max` peaked at
> 1 / 4 / 45 - below 200 - so the pool never grew and the denominator is 200
> under either reading. Re-evaluated against the guard's thresholds:
>
> | rate | vus.max | vus_max.max (grown) | utilisation | limit | dropped | limit |
> |---:|---:|---:|---:|---:|---:|---:|
> | 50/s | 1 | 200 | 0.5% | 90% | 0% | 5% |
> | 300/s | 4 | 200 | 2.0% | 90% | 0% | 5% |
> | 600/s | 45 | 200 | **22.5%** | 90% | **0%** | 5% |
>
> **What IS wrong here is the advice**, in §0 and §6: raising
> `MAX_VUS`/`PRE_ALLOCATED_VUS` is stated as one remedy. Only
> **`PRE_ALLOCATED_VUS`** does anything - `MAX_VUS` moves the ratio by nothing,
> because it is not the denominator. The figures stand; the recommendation is
> corrected here rather than edited away above.

## 0. Why three rates, and what was changed to make 600/s reportable

The campaign's existing ~600/s figure came from runs that today's guard chain
DISCARDS: 19.6-26.7% of iterations never dispatched, k6 at 92-97% of its own
VU ceiling. That is the generator's limit, not OpenLinker's.

The only change made here was raising the generator's own headroom -
`PRE_ALLOCATED_VUS=200`, `MAX_VUS=2000` against the scenario defaults of
50/300. No product code, no guard, no threshold was touched. At 600/s k6 then
used **45 of 200** VUs (22.5%) and dropped **zero** iterations, so
`post_guard_generator_saturated` passed and the number is attributable to the
system.

---

## 1. Headline - the `unique` arm (fresh eventId per request)

The insert path: connection read, secret resolve, HMAC verify, decode, route,
and the two-row durability-gate transaction (`webhook_deliveries` +
`sync_jobs`).

| offered rate | n (measured) | median | avg | p90 | p95 | p99 | max | k6 VUs used | dropped | non-2xx |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50/s  |  7 124 | **7.117 ms** |  7.358 ms |  8.495 ms |  9.225 ms | 11.661 ms |  49.5 ms | 1 / 200 (0.5%) | 0 | 0 |
| 300/s | 42 749 | **4.533 ms** |  5.129 ms |  7.086 ms |  8.950 ms | 12.848 ms |  42.6 ms | 4 / 200 (2.0%) | 0 | 0 |
| 600/s | 85 499 | **5.981 ms** | 10.370 ms | 23.116 ms | 30.716 ms | 53.340 ms | 289.3 ms | 45 / 200 (22.5%) | 0 | 0 |

All figures **measured**. Request counts match the offered load exactly - the
scenario's shape is 30 s ramp + 120 s plateau + 15 s ramp-down, so
`30*R/2 + 120*R + 15*R/2` is 7 125 / 42 750 / 85 500 against 7 124 / 42 749 /
85 499 observed. **The full offered load was delivered at every rate**, so
none of these three is itself a ceiling.

Two readings worth stating plainly:

- **50/s is SLOWER at the median than 300/s** (7.12 ms vs 4.53 ms). This is
  not noise - it is consistent across the whole distribution. The likely
  cause is warm-path effects (connection reuse, JIT, page cache) that a
  50/s trickle does not sustain. It means a low-rate median is not a floor
  for a high-rate one, and quoting 50/s as "the fast case" would be wrong.
- **600/s is where the tail opens up.** The median barely moves (4.5 -> 6.0 ms)
  while p95 goes 8.95 -> 30.7 ms and max 42.6 -> 289.3 ms. The service is
  still accepting everything; it is queueing to do it.

## 2. Where the ceiling actually is - the fixed-VU concurrent-replay sweep

This sweep pins N virtual users all posting the **same** pre-signed eventId
(`--distinct-ids 1`), so every waiter serialises on ONE unique-index tuple.
It measures the DUPLICATE path, not the insert path - the two must not be
conflated. It ran twice, inside two independent run groups:

| VUs | run A rate | run B rate | run A median | run B median |
|---:|---:|---:|---:|---:|
|   2 | 387.6 /s | 365.5 /s |   4.567 ms |   4.786 ms |
|   8 | 608.7 /s | 590.5 /s |  12.160 ms |  12.312 ms |
|  32 | 622.1 /s | 601.7 /s |  49.872 ms |  50.801 ms |
| 128 | 616.0 /s | 626.5 /s | 201.461 ms | 197.209 ms |

All **measured**. Throughput plateaus at **~590-626 req/s from 8 VUs upward**
while median latency scales almost exactly linearly with VU count
(12 -> 50 -> 200 ms for 8 -> 32 -> 128). That is a saturated service: past 8
concurrent callers, added concurrency buys queueing and no throughput.

The two runs agree to 3.3% at 32 VUs (`|622.07-601.68| / 611.88`), which is
the closest thing to a repeat this pass has; the harness's own
`compute_agreement` threshold policy is #2845's and is not applied here.

The `constant-vus` arms report 100% VU utilisation by construction, and
`post_guard_generator_saturated` correctly skips its VU check for that
executor (`if ($executor == "constant-vus") then empty`). Their VALID
verdicts are not evidence of generator headroom, and are not read as such.

## 3. The two answers together

- **Sustained, no loss:** 600 req/s accepted with 0 dropped iterations and
  0 non-2xx, at p95 30.7 ms. **Measured.**
- **Saturation:** ~600-620 req/s on the duplicate path from 8 concurrent
  callers up. **Measured.**

These agree, and the honest headline is **~600 req/s** on this host, with the
service still lossless but visibly queueing at that point. It is a
**lower bound on the unique-insert ceiling**: the unique arm never failed to
deliver 600/s, and no arm above 600/s was run, so the insert path's own
ceiling is **not established** - see §6.

## 4. Differential probes (P1-P4)

The correctness ladder answered exactly as `README.md`'s table states, on
every run: `401` / `400` / `202 deadlettered` / `202 job_enqueued`.

Timed, n=300 each, from the 50/s group (sequential, never part of the burst):

| probe | median | mean | stdev | p95 |
|---|---:|---:|---:|---:|
| P1 auth-fail        | 6.162 ms | 6.375 ms | 2.138 ms | 8.108 ms |
| P2 decode-reject    | 3.882 ms | 3.976 ms | 0.810 ms | 5.224 ms |
| P3 routable-product | 7.497 ms | 7.323 ms | 1.237 ms | 9.111 ms |
| P4 routable-order   | 8.175 ms | 8.061 ms | 1.268 ms | 9.963 ms |

Stage deltas, with the scenario's own 90% bootstrap CI - both **derived**
from the measured probe samples:

| delta | median delta | 90% CI | distinguishable from noise? |
|---|---:|---|---|
| P3 - P2 (routing + two Redis calls + delivery INSERT) | 3.615 ms | [3.385, 3.837] | yes |
| P4 - P3 (`sync_jobs` INSERT, same transaction) | 0.678 ms | [0.574, 0.822] | yes |

So the second row of the ADR-005 / ADR-049 durability gate costs **0.68 ms**
of the ~8 ms accept. The gate is not what bounds this path.

`pg_stat_statements` corroboration is present in the per-rate reports. It is
only present because this campaign had to `CREATE EXTENSION` first - see
`campaign-notes-epyc32-2026-09-08.md`, Finding 2.

## 5. Deadlocks

`deadlocks delta (measured): 0` on every arm at every rate, including
`replay-concurrent`, where every request contends on one index tuple.

## 6. What this run did NOT establish

- **The unique-insert path's own ceiling.** 600/s was delivered in full with
  zero drops, so the ceiling is above it. No arm was run above 600/s. The
  ~600/s figure in §3 is corroborated by the duplicate-path sweep, which is a
  DIFFERENT path; treating the two as one measurement would be wrong.
- **Any figure with the runner ON.** F3 runs `guard_runner_state disabled` by
  design, so these numbers are ingress ACCEPT cost only. Nothing here says
  what happens when those `sync_jobs` rows are also being executed - that is
  F1's and the sustained run's question.
- **Repeat agreement per rate.** Each rate ran once (the VU sweep ran twice
  as a by-product). #2845 owns repeat policy and does not exist.
- **Anything about a real marketplace's delivery behaviour.** The load is
  pre-signed synthetic webhooks replayed by k6; no marketplace is involved.
- **Cross-machine comparability.** The reference host's 3.40 ms median at
  300/s vs this host's 4.53 ms is a two-machine difference with 28 vs 32
  threads and 15 vs 122 GB. Neither number transfers.
