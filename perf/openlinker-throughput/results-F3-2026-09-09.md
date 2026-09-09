# F3 - webhook ingress burst, re-measured on the merged epic (2026-09-09)

Tree `1f9a52d1b` (epic `perf-programme-2840`, #3022 merged). Images rebuilt
from that sha; `guard_build` confirmed **image sha = tree HEAD, product paths
identical** on the run that followed. Host: 28 logical CPUs, 15 GiB RAM, WSL2.
Scenario start 2026-09-09T06:21:05Z, exit 0 at 2026-09-09T06:38:37Z.

Acceptance criteria for this run were pre-registered in
`PRE-REGISTRATION-remeasure-2026-09-09.md` before any window opened. They are
honoured below, including the one that constrains what this result may be
attributed to.

## Headline: a coherent set, NOT a first `VALID`

**Seven windows reached `status=VALID`, with all eight post-guards `ok`.**

An earlier draft of this report claimed this falsified the campaign's standing
claim that *no throughput window had ever reached `VALID`*. **That claim of
mine was wrong and is withdrawn.** An audit of every `f3-webhook-burst`
`verdict.txt` in the tree contradicts it:

| Worktree | `unique` windows | Notes |
|---|---|---|
| `2841-perf-harness-lib` | 4x VALID | run1788650401, 1788653420, 1788654193, 1788654599 |
| `agent-ae8990ac8c1875fd0` | 1x VALID, 5x DISCARDED | 1788885505 VALID; the five later ones discarded |
| `agent-abad74915c4bd832d` | 1x DISCARDED | `concurrent-vus-2`/`-8` there were VALID |

F3 windows have reached `VALID` repeatedly, including before tonight. What
this run adds is narrower and should be stated as such: **all seven windows of
one scenario invocation are `VALID` simultaneously, on one tree, one image and
one guard chain, each carrying a recorded guard list** (the guard list only
exists at all since #3009).

| Window | Status |
|---|---|
| `unique` | VALID |
| `replay-committed` | VALID |
| `replay-concurrent` | VALID |
| `concurrent-vus-2` | VALID |
| `concurrent-vus-8` | VALID |
| `concurrent-vus-32` | VALID |
| `concurrent-vus-128` | VALID |

Guards passed on every one: `post_guard_attempts`, `post_guard_deferrals`,
`post_guard_requeues`, `post_guard_destination_creates`,
`post_guard_limiter_degraded`, `post_guard_containers_stable`,
`post_guard_generator_saturated`, `post_guard_feed_starved`.

`concurrent-vus-sweep` and `probes` carry no `verdict.txt` - they are the
sweep index and the differential-probe directory, not measurement windows.

## Why the verdict moved against TONIGHT'S runs, and why that is not an improvement

The five `unique` windows discarded tonight were all discarded on one guard:

> `DISCARDED post_guard_generator_saturated: k6 used 2600 of 2600 virtual
> users (100% of its own ceiling, limit 90%) - the achieved rate may be the
> generator, not the system.`

Those were **saturation attempts** - the runs behind the withdrawn ~600 req/s
ceiling claim. This run drove `arrivalRatePerSec = 50` with `MAX_VUS = 300`
and used about **one** VU. It passes a generator-saturation guard that a
600/s push failed because it asked a far easier question, not because
anything got better.

**So: the verdict moved, the difficulty of the question moved with it, and no
improvement is demonstrated.** Reporting this as a system improvement would be
the same error as quoting a target rate for an achieved one.

## The cause is NOT the guard repair, and is not isolated

Pre-registered prediction **P2** said: if F3 reaches `VALID`, the cause is not
`post_guard_destination_creates`' scoping repair and must not be reported as
such. That prediction holds and is honoured here.

`run_post_guards` takes the destination connection id as its sixth argument.
`f3-webhook-burst.sh` passes `""` at both call sites (lines 799 and 1010), so
the guard takes its `else` branch, where `failed` is unscoped and `missing` is
hardcoded `0`. **The scoping repair is unreachable from this scenario.** Only
the fail-closed half (`as_count`) applies, and that half can only ever move a
verdict toward `DISCARDED`.

Candidate causes, none isolated by this run:

- the eleven merged PRs' product changes
- a quiet host - `load_average` recorded in the manifests was **1.47** at the
  first window and **2.78** at the busiest, against a campaign whose earlier
  runs contended with concurrent builds and other agents
- this run drove the correct api endpoint (see the instrument defect in the
  pre-registration); earlier runs cannot be audited for that

Per the brief's own rule, no cause is published for something this run did not
isolate.

## Figures

### Main arms - `ramping-arrival-rate`, `arrivalRatePerSec = 50`

Shape: 30 s ramp-up, 120 s plateau, 15 s ramp-down (165 s).

| Arm | Requests | Achieved rate (whole window) | Failed | p95 |
|---|---|---|---|---|
| `unique` | 7 112 | 42.91/s | **0** | 20.31 ms |
| `replay-committed` | 7 124 | 42.95/s | **0** | 13.24 ms |
| `replay-concurrent` | 7 124 | 42.99/s | **0** | 6.31 ms |

All **measured**.

**The rate is stated as achieved, not as target.** 42.9/s is the whole-window
average including ramp-up and ramp-down; the plateau was observed hitting the
configured 50.00/s. Quoting "50/s" for these p95 values would repeat the
overstatement this campaign already retracted once, where 3.40 ms was
published "at 300 events/s" having been measured at an achieved 239.6/s.

### `replay-concurrent` under a fixed VU pool - `constant-vus`, 20 s per point

| VUs | Requests | Achieved rate | Failed | p95 |
|---|---|---|---|---|
| 2 | 6 907 | 345/s | 0 | 7 ms |
| 8 | 9 274 | 459/s | 0 | 24 ms |
| 32 | 8 268 | 409/s | 0 | 104 ms |
| 128 | 10 847 | 533/s | 0 | 293 ms |

All **measured**. Throughput is flat-to-noisy across a 64x change in
concurrency (345 -> 459 -> 409 -> 533/s) while p95 rises 42x (7 -> 293 ms).
**vus=32 is slower than vus=8**, so this is not a clean knee; it is
contention, and the shape of it is not established by four 20-second points.

## Supporting evidence

**Container ages at `window_start`** - promoted into this report per the
brief, from `.container-starts`:

| Container | Started | Age at first window |
|---|---|---|
| `lab-api` | 2026-09-09T06:15:33Z | 7 min |
| `lab-worker-1` | 2026-09-09T06:15:33Z | 7 min |
| `lab-postgres` | 2026-09-06T22:31:30Z | 2 d |
| `lab-redis` | 2026-09-08T03:16:23Z | 27 h |
| `lab-prestashop` | 2026-09-08T00:50:22Z | 29 h |
| `lab-woocommerce` | 2026-09-06T22:31:42Z | 2 d |

`api` and `worker` are the two this run recreated, at identical age, and every
other container is the same age across every arm - so no arm is
distinguishable from another by container age.

**Deadlocks**: `deadlocksDelta = 0` on both `unique` and `replay-concurrent`.

**Lane caps in force**, read out of the worker's own startup line:
`realtime=4/2 bulk=12/8 fiscal=2/1 fan-out=8/4` - the merged #2594 and #2609
values.

## Comparison with the withdrawn figure

The previously published F3 webhook ceiling of **~600 req/s** is withdrawn and
this run does **not** replace it. The two measure different things:

- the withdrawn figure came from a saturation attempt whose runs today's guard
  chain discards - 19.6-26.7% of iterations never dispatched, k6 at 92-97% of
  its own VU ceiling
- this run's main arms are a 50/s arrival-rate shape, which is the harness's
  illustrative default and **not a ceiling probe**; its
  `post_guard_generator_saturated` answered `ok`, so k6 was not itself the
  limit

So: **the ceiling figure did not move, because this run did not measure a
ceiling - it measured a load an order of magnitude gentler.** The ~600 req/s
claim stays withdrawn and stays unreplaced.

## What this run did not establish

- **No webhook ingress ceiling.** 50/s was comfortable (0 failures, p95
  6-20 ms). Where ingress actually breaks is unmeasured.
- **Why the windows now pass.** Three candidate causes, none isolated.
- **The shape of the contention curve.** Four 20-second points, non-monotonic.
- **Nothing about the `unique` path under concurrency** - the VU sweep varies
  `replay-concurrent` only, which is the durability-gate contention probe
  (the same `eventId` arriving many times at once), not general ingress.
- **Whether earlier runs drove the correct api endpoint.** No manifest records
  `OL_API_URL`, so this is bounded by argument only, never by artefact.
