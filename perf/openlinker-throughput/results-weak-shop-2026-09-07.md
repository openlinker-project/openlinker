# Is 300 req/min safe on a WEAK PrestaShop? (epic #2840)

**Run**: `results/weak-shop/run-a1d53-sweep`, 2026-09-07 20:18:19Z - 21:43:11Z,
one 85-minute window held under `guard_stand_exclusive` throughout.
**Scenario**: `scenarios/weak-shop-ramp.sh`. **Six profiles + one sustained
window, 38 measurement steps, 10 800 status-checked samples.**
**Instrument**: `probes/ps-latency-ramp.sh` + `drivers/ps-latency-probe.mjs`,
reused **verbatim** from #2977, so every number here is directly comparable to
that report's curve.

---

## Before the numbers: why a "FREE" verdict here is worth believing

This report concludes that the change we were hoping to make is safe. That is
exactly the situation in which a reader should be suspicious, so the two things
that guard against it are stated first rather than buried in § 2.

**The verdict rule was written down and timestamped BEFORE any constrained
profile produced a sample.** It is committed at
`results/weak-shop/run-a1d53-sweep/threshold-fixed-in-advance.md`, written
20:12Z; the sweep it governs started at 20:18Z, and at the moment of writing the
only samples in existence anywhere were from the **unconstrained** control.
`probes/weak-shop-verdict.sh` then applies it mechanically to every profile,
including the ones whose answer is inconvenient - and **that classifier was
itself validated against ten synthetic known-answer fixtures** (free, degrading
by ratio, degrading by absolute, unsafe by ratio / absolute / non-ok-status /
undelivered-rate, free-but-refusing, and two soak-shaped directories) before it
was ever pointed at real data.

**And the threshold was NOT retightened when its own rationale turned out to be
wrong.** The 250 ms bar was justified by "~8 destination requests per order";
F1 actually measured ~16, which makes the bar twice as permissive as intended
(§ 2.1). Moving a pre-registered threshold after seeing the data is precisely
what pre-registration exists to prevent, so it was left alone and the
robustness check was published instead: **at the stricter bar the corrected
arithmetic implies, the headline answer does not move** - the boundary still
sits between half a core and a quarter core.

Nothing else in this campaign carries that guarantee.

---

## 0. The answers, in one page

| Question | Answer | Label |
|---|---|---|
| **Weakest profile at which 5 req/s is FREE** | **0.5 cpu with the database squeezed to 0.5 cpu beside it** (`P3-shared`) - p99 78.1 ms, 300/300 samples ok | measured |
| **Weakest profile at which it is NOT** | **0.25 cpu** (`P4-shared-min`) - p99 143.2 ms, **DEGRADING, never UNSAFE** | measured |
| **Does a constrained shop REFUSE or DEGRADE?** | **Degrades.** 100% expected status at every step of every profile - including 0.1 cpu at 10 req/s, where p99 was 4.1 s. Zero 429, 503, resets or timeouts anywhere. | measured |
| **Did the CPU limit actually engage?** | Yes, and provably: **0** throttle events at 1.0 cpu and above, first engagement at 0.5 cpu, scaling with the tail to 38 events at 0.1 cpu | measured |
| **Sustained, not just a 60 s step?** | 2 x 5 min at exactly 5 req/s on the quarter-core profile: **3000/3000 ok**, p99 186.6 then **166.3** - it got *better*, so no accumulation | measured |
| **Does this license 600 req/min?** | **No.** 10 req/s is free at >= 1.0 cpu (p99 20.0 ms) but p99 **616.7 ms** at 0.5 cpu and **2125.6 ms** at 0.25 cpu | measured |
| **What about the heavy catalogue reads?** | A `display=full` page costs **395 ms** unconstrained and **1021 ms** at a quarter core - ~70x a create-path read. The limiter is **weight-blind**; what bounds the damage is `maxConcurrent: 4`, which this change leaves alone | measured |
| **Recommendation** | **Raise PrestaShop's `requestsPerMinute` 60 -> 300. Only PrestaShop's.** | judgement, from the above |

---

## 1. The question, and why #2977 does not settle it

`libs/integrations/prestashop/src/prestashop-plugin.ts:79-84` declares

```ts
  // Conservative resolution-time fallback for a connection with no
  // explicit config.rateLimit (#1810/#1772) - a shared-hosting PrestaShop
  // VPS is the platform this issue's reporter hit an abuse block on.
  // Placeholder values pending the reporter's actual abuse-notice text
  // (see #1810's own open question); never written into stored config.
  defaultRateLimit: { requestsPerMinute: 60, maxConcurrent: 4 },
```

Somebody hit an abuse block on shared hosting, a provisional number was written
pending details, and the details never arrived. `docs/lessons.md:301` names the
failure mode - *"an uncalibrated manifest default is a silent throughput
regression"* - and rules that such a default should exist only with a
documented quota to calibrate against.

#2977 measured the shop free to ~6.5 req/s with the tail moving at 10 req/s.
300 req/min is 5 req/s, inside that. But it was measured on a **28-core host
with an unconstrained container**, and the shop the block came from was on
shared hosting. A default is for everyone, so the figure that decides it has to
come from the weakest shop a real operator runs, not the strongest one we own.

### 1.1 What `requestsPerMinute` does, because it decides both the instrument and the risk

It is **strict minimum-interval spacing, not a token bucket**.
`libs/shared/src/rate-limit/rate-limiter.ts:196-199` advances a single
`nextAvailableAt` by `60000/rpm` on each admission, and
`redis-rate-limiter.adapter.ts:12-24` does the same through a CAS'd
`ratelimit:pace:{connectionId}` key using Redis's own `TIME`. Since #2015 that
key is shared by every process and replica, so it is the **aggregate** cap.

**So 300/min means the shop sees an evenly spaced 5 req/s and never a burst.**
That is a materially safer shape than "300 requests in a minute" sounds:
OpenLinker at 300/min *cannot* send 300 requests in the first second, or 10 in
any one second. Anyone reading this change as a fivefold increase in peak load
is reading it wrong - peak load is unchanged at one concurrent request; only
the interval between requests shortens, from 1000 ms to 200 ms.

It is also why the instrument is right: the probe offers requests on a fixed
arrival schedule (`start + n/rate`), which is that same shape.

`maxConcurrent: 4` is not binding at these rates - with an ~11 ms shop and
200 ms spacing, in-flight is ~1 - and is neither changed nor measured here.

### 1.2 Blast radius

`libs/shared/src/http/http-transport-factory.ts:148` resolves
`connection.config?.rateLimit ?? defaultRateLimit ?? {}`, so the manifest value
applies to **every PrestaShop connection with no explicit `config.rateLimit`** -
on an untouched install, all of them. This is not opt-in.

The operator override already exists
(`apps/web/src/features/connections/components/rate-limit-section.tsx` renders
`Default: 60` and accepts 1-6000), which is the asymmetry shaping the
recommendation: **an operator who knows their shop can already raise it, so the
default's job is to be safe rather than fast.**

---

## 2. Method

### 2.1 The verdict rule was fixed and timestamped BEFORE any constrained profile produced a sample

`results/weak-shop/run-a1d53-sweep/threshold-fixed-in-advance.md`, written
20:12Z. At that moment the only samples in existence were from the
**unconstrained** control of an aborted first attempt; no constrained profile
had produced a single sample, and none had when the sweep this report covers
was launched at 20:18Z. This is pre-registration, and it is the reason a reader
has grounds to believe the verdicts below rather than merely the numbers.

A profile is judged at its **5 req/s** step against **its own 1 req/s step** as
the idle control, so a weak box is judged against itself:

* **FREE** - 100% expected status; achieved within 5% of offered with no
  in-flight-cap skips; p99 <= 2x the profile's own idle p99; **and** p99 <=
  250 ms absolute. Both p99 conditions are required, because a box whose idle
  p99 is already 300 ms passes a ratio test while being unusable.
* **DEGRADING** - status and rate hold, but p99 is 2-10x idle, or 250 ms - 1 s.
* **UNSAFE** - any unexpected status, an undelivered rate, p99 > 10x idle, or
  p99 > 1 s.
* **REFUSING** is reported *separately* and is not a latency judgement: any
  429, 503, reset or timeout. A shop that stays fast and then blocks you is a
  different failure from one that slows down, and it is the one the original
  abuse notice describes.

`probes/weak-shop-verdict.sh` computes it, so the same arithmetic reaches every
profile including the ones whose answer is inconvenient. **The classifier was
itself checked against ten synthetic known-answer fixtures** - free, degrading
by ratio, degrading by absolute, unsafe by ratio / absolute / non-ok-status /
undelivered-rate, free-but-refusing, and two soak-shaped directories with no
idle control - before being pointed at real data.

#### A correction to the rule's own rationale, which I am NOT using to move the rule

The 250 ms figure was justified in the pre-registered text by *"F1 measured ~8
destination requests per order, so a 250 ms p99 is a ~2 s worst-case shop-side
contribution"*. **That count is wrong.** F1 measured **~16** requests per order
(`results-F1-2026-09-07.md:161-163`: 14.06 `/api/` + 2.00 module POSTs), so a
250 ms p99 is really a ~4 s worst case, and the absolute bar is **twice as
permissive as its own rationale intended**.

The threshold is left at 250 ms anyway, because silently retightening a
pre-registered rule after seeing the data destroys the only thing
pre-registration buys. What is owed instead is the robustness check: **at the
125 ms bar the corrected arithmetic would have produced, the headline answer
does not move.** P3 (78.1 ms) is still FREE and P4 (143.2 ms) is still not - the
boundary sits between half a core and a quarter core either way. The one
verdict that *would* flip is the quarter-core **soak** (186.6 ms), from FREE to
DEGRADING, and § 3.3 states that explicitly rather than resting on it.

### 2.2 Two mechanisms for the constraint, and why neither alone is enough

Applied with `docker update`, removed with a compose recreate. That split is a
measured necessity.

`docker update` keeps the container alive, so PHP's opcache, the Apache worker
pool and every warm page survive the whole sweep and the **only** thing
differing between two profiles is the cgroup quota. A recreate per profile
would hand each one a cold shop and confound the constraint with the warm-up.

But **`docker update` cannot undo itself.** Measured here (Docker 29.5.2,
cgroup v1) on a throwaway container:

| command | `HostConfig.NanoCpus` | `HostConfig.Memory` | `memory.limit_in_bytes` | exit |
|---|---:|---:|---:|---:|
| `--cpus 0.25 --memory 512m --memory-swap 512m` | 250000000 | 536870912 | 536870912 | 0 |
| `--cpus 0 --memory 0 --memory-swap -1` | **250000000** | **536870912** | **536870912** | **0** |
| `--cpu-quota -1` | **250000000** (stale) | 536870912 | 536870912 | 0 |

Row two is the point: the documented reset **exits 0 and changes nothing**. Row
three clears the CPU cgroup but leaves `HostConfig.NanoCpus` reporting a limit
the container no longer has - and `manifest_container_limits` (`lib.sh`) reads
exactly those fields into every later run's manifest, so the next scenario
would record the lie. Only a fresh container from the unmodified compose spec
returns both to zero. Hence `stand/weak-shop.override.yml` as a scenario-local
override (#2854 owns `docker-compose.lab.yml`; it is untouched) and a restore
that recreates from the base spec and **verifies** the result.

**That restore path then survived the measuring process being KILLED mid-run,
which is unusual evidence and worth stating plainly.** The agent driving this
sweep was terminated partway through by an unrelated spend limit. The sweep
itself continued in the background, completed all six profiles, ran its
restore, and logged `restore verified: lab-prestashop NanoCpus=0 Memory=0` /
`restore verified: lab-mysql NanoCpus=0 Memory=0` plus `restored_ok=yes`. The
stand was then re-checked **independently, by a third party, before this agent
was resumed**, and again by the agent on resumption: `docker inspect` reporting
`NanoCpus 0 / Memory 0 / CpuQuota 0`, the containers' own
`cpu.cfs_quota_us = -1`, the stand lock free, and the peer-seeded catalogue
intact at 50 006 products.

Given the table immediately above - that `docker update` **cannot** restore
this host, and that its documented reset exits 0 while changing nothing - a
restore that holds through the death of the process that scheduled it is worth
considerably more than one that runs on a tidy exit. The trap handling
(`EXIT` plus explicit `INT`/`TERM`, since a default-disposition SIGTERM does
not run an EXIT trap) is what makes that true by construction rather than by
luck.

Before recreating anything, PrestaShop's own entrypoint (`/tmp/docker_run.sh`)
was read in the running container to confirm the already-installed guard fires:
the install branch requires `settings.inc.php`, `app/config/parameters.php` and
`install.lock` to be **all** absent, and `parameters.php` exists - so a recreate
falls straight through to *"PrestaShop Core already installed"* and cannot reach
`PS_ERASE_DB`. A recreate that silently reinstalled would have destroyed a
peer's 50 000-product catalogue.

### 2.3 Every applied constraint is read back from two independent places

`docker update` exiting 0 is not evidence the kernel accepted the value. Each
profile is verified against **both** the daemon's `HostConfig` **and** the
container's own cgroup files, and any disagreement is fatal. All six profiles
passed both; the log carries lines such as
`verified lab-prestashop: HostConfig NanoCpus=250000000 Memory=1073741824;
cgroup quota=25000/100000 limit=1073741824`.

### 2.4 A third, mechanistic axis: did the quota engage at all?

Latency alone cannot separate *"this box had headroom"* from *"the limit was
never reached"*. `cpu.stat`'s `nr_throttled` / `throttled_time` answer it
directly, sampled every 5 s **from the host's own cgroup filesystem**
(`/sys/fs/cgroup/cpu/docker/<id>/cpu.stat`) rather than with `docker exec` - an
exec spawns a process inside the container being measured and, at a 0.1-cpu
quota, would consume a visible share of the very quota it observes. Counters
are differenced across each step's own window, taken from the probe's own
`# window` timestamps, so throttling is attributed to a profile rather than
reported as one meaningless cumulative total.

### 2.5 The profiles

CPU is the swept variable. **Memory is held realistic and non-binding, and that
is a decision**: measured before the sweep, the PrestaShop container's whole
cgroup usage is 117 MiB and MySQL's 416 MiB (`innodb_buffer_pool_size`
128 MiB), so a limit tight enough to bind would OOM-kill a container rather
than slow it - and an OOM-kill is an artefact of the container, not a property
of shared hosting, since a real host selling a 512 MB account does not also
hand PHP a 512 MB per-request `memory_limit`, which this image does. (The
first attempt at this sweep was aborted before it constrained anything, for
exactly this reason: the originally planned 512m database limit sat only
~76 MiB above MySQL's measured footprint.)

| profile | PrestaShop | MySQL | represents |
|---|---|---|---|
| `P0-baseline` | unconstrained | unconstrained | control - #2977's conditions on today's 50k catalogue |
| `P1-vps2` | 2.0 cpu / 2 GiB | unconstrained | small dedicated VPS |
| `P2-vps1` | 1.0 cpu / 1 GiB | unconstrained | entry VPS, 1 vCPU |
| `P3-shared` | 0.5 cpu / 1 GiB | 0.5 cpu / 1 GiB | shared hosting: half a core, PHP and database on one squeezed box |
| `P4-shared-min` | 0.25 cpu / 1 GiB | 0.25 cpu / 1 GiB | worst realistic shared hosting |
| `P5-boundary` | 0.1 cpu / 1 GiB | 0.1 cpu / 1 GiB | **below any real hosting plan** - to locate a boundary the realistic profiles might not reach |

A sweep in which every profile passes has not located a boundary, which is why
the ladder ends below anything a customer buys.

### 2.6 Stand condition

* Host: 28 cores, 15.5 GiB, Docker 29.5.2, **cgroup v1**, WSL2.
* **Host load over the measurement window: p50 0.13, p90 0.37, p99 1.00,
  max 1.02** across 490 samples on 28 cores - quieter than #2977's own
  clean-window run (p50 0.56).
* Catalogue: **50 006 products**, 2 847 orders, 116 692 stock rows, read
  immediately before the window (a peer had reseeded the stand to 50k). Every
  profile is preceded by its own warm-up, so no curve is measured against a
  cold cache, and each profile's drift control confirms the shop was not left
  degraded.
* **The dataset did not move under the measurement.** Re-read afterwards:
  products and stock rows **identical** (50 006 / 116 692); the order count had
  drifted to 3 030 through peer activity *outside* the locked window, and is
  not load-bearing here (the probe's `orders` call is a deliberate
  filter-miss). The exclusive stand lock was held for the whole 85 minutes, and
  the per-profile drift controls are the direct empirical check that nothing
  shifted mid-run.
* **#2949's reseed, which landed on the epic branch during this work, does not
  touch these numbers.** That pass rebalances the `syncStatus` distribution of
  OpenLinker's own `order_records` in **Postgres**; this report drives
  PrestaShop's webservice in **MySQL** directly and reads no OpenLinker table
  at all. Stated because both changes touch `perf/openlinker-throughput/` on
  the same day and a reader is right to ask which dataset these curves are on.
* Shop: `prestashop/prestashop:9.0.2-2.0-classic-8.4`, Apache **mpm_prefork**,
  PHP `memory_limit=512M`. CFS period 100 ms.
* The `lab` project was brought up from a sibling agent worktree, so the
  scenario resolves compose file, env file and project directory from the
  running container's own labels - recreating from a different checkout would
  bind different module sources in.

---

## 3. Results

All **measured**. 60 s per step, ~60 s settling between (see § 6), one shared
instrument. `ok/total` counts samples returning the status their endpoint
expects; the 401s are the `configurations` probe, which is *supposed* to answer
401.

### 3.1 The curve, per profile, at the rate the question is about

| profile | shop cpu | idle p99 (1 req/s) | **p50 @ 5** | **p90 @ 5** | **p99 @ 5** | ok/total @ 5 | throttle events in that window | **verdict** |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `P0-baseline` | unconstrained | 51.4 | 11.0 | 14.2 | **19.8** | 300/300 | 0 | **FREE** |
| `P1-vps2` | 2.0 | 51.2 | 11.7 | 15.4 | **18.5** | 300/300 | 0 | **FREE** |
| `P2-vps1` | 1.0 | 62.4 | 10.8 | 14.4 | **18.5** | 300/300 | 0 | **FREE** |
| `P3-shared` | 0.5 + db 0.5 | 46.4 | 10.9 | 15.0 | **78.1** | 300/300 | 1 (354 ms) | **FREE** |
| `P4-shared-min` | 0.25 + db 0.25 | 49.8 | 10.7 | 14.8 | **143.2** | 300/300 | 5 (1.3 s) | **DEGRADING** |
| `P5-boundary` | 0.1 + db 0.1 | 179.2 | 10.7 | 93.3 | **598.1** | 300/300 | 38 (14.9 s) | **DEGRADING** |

**So: 5 req/s is free down to half a core with the database squeezed alongside
it, and stops being free at a quarter core.** P4 is flagged by the *ratio*
half of the rule (143.2 > 2 x 49.8) and is still **under** the 250 ms absolute
bar; it is DEGRADING, never UNSAFE.

Five readings, in order of how much they matter.

**1. Nothing ever refused.** `ok/total` is **100% at every step of every
profile** - 10 800 samples, including 600/600 at 0.1 cpu and 10 req/s where p99
was 4069 ms and the worst single sample 6.8 s. No 429, no 503, no reset, no
timeout, no in-flight-cap skip. **A constrained PrestaShop queues; it does not
shed.** That distinction is only available because the probe checks status per
sample - the instrument the campaign built after ADR-066's store-impact figure
was withdrawn for not doing so.

**2. The quota provably engaged, and only where the latency says it did.**
Zero throttle events at 1.0 cpu and above, so "FREE" there means genuine
headroom rather than a limit that was never reached. First engagement at
0.5 cpu (one event, 354 ms), then 5, then 38 as the tail grows. The
`throttled_time` column and the p99 column are two independent instruments
telling the same story.

**3. The median never moves.** p50 is 10.7-11.7 ms at 5 req/s on *every*
profile, from 28 unconstrained cores down to a tenth of a core. Even at 0.1 cpu
and 10 req/s, p50 is 74.4 ms. The cost of a constrained shop is entirely in the
tail, which is the shape CFS throttling predicts: a request arriving after its
period's quota is spent waits for the next 100 ms period.

**4. The x-axis is real.** Achieved rate matched offered to within 0.4% at
every step of every profile, so no point is a rate the probe failed to deliver
and then mislabelled.

**5. The drift controls hold.** Every profile's repeat of 1 req/s, run last,
comes back at or below its opening value (P0 45.9 vs 51.4; P2 55.1 vs 62.4; P3
47.4 vs 46.4; P4 54.5 vs 49.8; P5 94.9 vs 179.2). The ramps measured rate, not
cumulative damage, and no profile left the shop degraded for the next.

A note on the idle column: at 60 samples, p99 *is* the maximum, so those
figures are inflated by a single cold outlier apiece - which is why several
profiles read *slower* at 1 req/s than at 5. It makes the ratio test lenient,
and is the reason the absolute ceiling is the half that actually binds.

### 3.2 What this says about 600 req/min, which is a different question and a different answer

#2977 concluded *"600 req/min is supportable **on this shop**"*. The italics
were load-bearing, and this sweep shows why:

| profile | p99 @ 10 req/s | worst sample |
|---|---:|---:|
| `P0-baseline` | 19.6 ms | 2 094 ms |
| `P1-vps2` | 47.7 ms | 2 585 ms |
| `P2-vps1` | **20.0 ms** | 63.5 ms |
| `P3-shared` | **616.7 ms** | 2 623 ms |
| `P4-shared-min` | **2 125.6 ms** | 2 227 ms |
| `P5-boundary` | **4 069.0 ms** | 6 768 ms |

**10 req/s is free at 1.0 cpu and above and collapses below it.** So #2977's
conclusion does not transfer to a small shop, and nothing in this report should
be read as support for 600 as a default. The knee for 600/min sits between one
core and half a core; the knee for 300/min sits between half a core and a
quarter.

### 3.3 The sustained window - the result that matters most for an abuse rule

A 60 s step cannot see an accumulating problem, and the condition this whole
question is about is accumulating by nature. So the worst *realistic* profile
was held at exactly the proposed rate for two back-to-back five-minute windows:

| window | offered | achieved | ok/total | p50 | p90 | p99 | max |
|---|---:|---:|---:|---:|---:|---:|---:|
| soak, first 5 min | 5 | 5.00 | **1500/1500** | 10.6 | 14.3 | 186.6 | 240.5 |
| soak, second 5 min | 5 | 5.00 | **1500/1500** | 10.4 | 14.3 | **166.3** | 204.8 |

**3000 consecutive requests at 5 req/s against a quarter-core shop with a
quarter-core database, and the tenth minute was *better* than the first.** No
accumulation, no leak, no degradation, and nothing resembling a refusal. The
worst single sample in ten minutes was 240 ms.

Two honest qualifications. First, sustained load *is* worse than a 60 s step -
p99 186.6 against the ramp's 143.2 - which is precisely why the soak was worth
running rather than inferring. Second, under my pre-registered rule the soak is
FREE only because the absolute ceiling is the only applicable half (a soak
directory has no idle control of its own); and under the **corrected** 125 ms
bar of § 2.1 it would be DEGRADING. I am not claiming the quarter-core shop is
comfortable at 5 req/s. I am claiming it never fails, never refuses, and does
not get worse with time.

### 3.4 The heavy path: a catalogue page costs 70x a create-path read, and the limiter is weight-blind

The mix above is the create path's single-row reads. The biggest consumer of a
raised limit is the catalogue/inventory sweep, which issues `display=full`
pages. `probes/ps-heavy-request-cost.sh` measures the per-request cost of the
three shapes a sweep really sends - sequentially, no offered rate, because what
is needed here is service COST, not capacity - at the unconstrained baseline
and at the quarter-core profile. Run `results/weak-shop/run-a1d53-heavy2`,
4 samples per shape, offsets varied so nothing is answered from a warm repeat
of the identical query, **12/12 ok at each profile**.

| request shape | P0 unconstrained | P4 0.25 cpu | response |
|---|---:|---:|---:|
| `products?display=full&limit=100` (the batched prefetch, #2593) | **394.8 ms** | **1020.9 ms** | 627 KiB |
| `products?display=[id]&limit=100` (the enumeration) | 129.4 ms | 360.1 ms | 5 KiB |
| `stock_availables?display=full&limit=100` (#2648) | 25.7 ms | **25.3 ms** | 50 KiB |

Three readings.

**1. A catalogue page is ~70x a create-path read** (395 ms against ~11 ms) even
unconstrained, and 1021 ms at a quarter core. So `5 req/s` is not one workload:
five catalogue pages per second would demand 5.1 s of service per second of
wall clock on the quarter-core shop, which is impossible.

**2. What stops that being a disaster is `maxConcurrent: 4`, not the pacing.**
The two knobs bound different things - pacing bounds ARRIVAL, concurrency
bounds SIMULTANEOUS WORK - and the limiter is **weight-blind**: it admits five
requests per second whether each costs 11 ms or 1021 ms. With 1021 ms pages and
an in-flight cap of 4, OpenLinker's own throughput self-limits to roughly four
pages in flight and the shop is never asked for five per second. Raising the
pacing therefore does not let OL push heavy pages five times faster at a weak
shop; it removes an artificial 1 req/s floor on the cheap requests that are the
overwhelming majority of the traffic.

**3. The inventory prefetch is genuinely insensitive to the constraint**
(25.7 -> 25.3 ms), so #2648's batched stock read is not a concern at any
profile measured.

**The remaining gap is now narrow and specific rather than open**: every
measurement in this report is at an in-flight concurrency of about one. Four
*concurrent* 1021 ms catalogue pages against a quarter core were not measured,
and that is the one shape where the raised pacing could plausibly bite. It is
bounded by `maxConcurrent: 4`, which this change does not touch.

### 3.5 Two instrument bugs found and fixed in this analysis

**The verdict tool reported a false UNSAFE.** Its first run over the soak said
`UNSAFE - no p99 could be computed (every sample non-ok)`, which was wrong in
both halves: all 3000 samples succeeded and the p99 was perfectly computable.
The cause was that a soak directory has no `step-rate-1`, so an *absent idle
control* and an *uncomputable p99* had been collapsed into one branch. The fix
separates them, applies the absolute half of the rule alone when there is no
control, and says so in the output; two soak-shaped fixtures were added and the
original eight still classify identically.

**The heavy-cost probe failed completely on its first run, and said so.** All
18 samples came back status `000`. curl exits 3 (*URL malformed*) on
PrestaShop's own webservice syntax, because `display=[id]` and `sort=[id_ASC]`
put square brackets in the query string and curl reads `[...]` as a glob range;
`--globoff` is required, and no socket was ever opened without it. **The run
produced no plausible-looking numbers to be misread** - every sample was
recorded non-ok and every aggregate was empty - which is the entire reason each
sample carries its status and each endpoint declares the status it expects.
This is the second instrument in this campaign to be caught by that discipline
and the first that would otherwise have produced *silence* rather than
flattering data.

---

## 4. Recommendation

**Raise `requestsPerMinute` from 60 to 300 in
`libs/integrations/prestashop/src/prestashop-plugin.ts`. Change nothing else's
value.**

The reasoning, with the uncomfortable parts included:

**1. The load argument for 60 is gone at every realistic profile.** 5 req/s is
free down to half a core with a squeezed database, and at a quarter core the
shop degrades in the tail while remaining under the absolute usability bar,
never refusing, and holding steady for ten minutes.

**2. Even on the weakest realistic profile the change makes orders faster, and
by a wide margin.** F1 measured ~16 destination requests per order. Pacing
alone costs `16 x 1000 ms = 16 s` per order at 60/min and `16 x 200 ms = 3.2 s`
at 300/min. The quarter-core shop's own p99 contribution rises from
`16 x 49.8 ms = 0.8 s` to `16 x 143.2 ms = 2.3 s`. **Net: about 11 s faster per
order**, on the worst realistic shop. The limiter dominates the shop by an
order of magnitude; this is not a trade of throughput against shop health.

**3. The shape is safer than the number sounds.** 300/min is strict spacing
with no burst, shared across replicas - one request every 200 ms, never a
spike. Peak concurrency is unchanged.

**4. The heavy path does not overturn this, and the reason is the OTHER knob.**
The limiter is weight-blind, and a catalogue page costs 1021 ms at a quarter
core against ~11 ms for a create-path read (§ 3.4). Five of those per second is
arithmetically impossible on that shop - but `maxConcurrent: 4` bounds
simultaneous work independently of pacing, so OpenLinker's own throughput
self-limits there and the shop is never asked for five per second. That knob is
deliberately left at 4. Anyone later tempted to raise `maxConcurrent` should
read § 3.4 first: it, not the pacing, is what protects a weak shop from the
heavy path.

**5. The failure mode, if we are wrong, is visible and recoverable.** The shop
queues rather than refusing; the transport already honours `Retry-After`
reactively; and the operator can set `config.rateLimit` on the connection.

**What I am NOT claiming, and what would change my mind.** This measures load,
not policy. The original report was an **abuse notice** - a hosting provider's
policy action - and no CPU cgroup can reproduce a rule that counts requests per
hour. Worse, raising the ceiling genuinely raises sustained volume for a busy
install: a 20-minute catalogue tick admits at most `60 x 20 = 1200` requests at
the old limit and `300 x 20 = 6000` at the new one, so an install with enough
queued work really can send ~5x more per hour. (It will not always: #2977's arm
BD used only 378 of its 600 req/min because lane caps and work availability
bound it first - but 378 > 300, so at 300 the limiter *is* still the binding
constraint for a busy install, which is exactly why 5 req/s was the right rate
to test.) **If the reporter's abuse-notice text ever arrives and names a
request-count quota, this number should be re-derived from that quota and not
from this measurement.**

### 4.1 Scope: only PrestaShop's value may move

The identical `{ requestsPerMinute: 60, maxConcurrent: 4 }` appears in three
manifests - `prestashop-plugin.ts:84`, `woocommerce-plugin.ts:100` and
`subiekt-plugin.ts:49` - and is cited by name in two more comments
(`inpost-plugin.ts:39`, `ksef-plugin.ts:64`). `docs/lessons.md:301` exists to
forbid exactly that copying; it stopped the figure reaching InPost and KSeF and
did not stop WooCommerce and Subiekt.

**WooCommerce and Subiekt are therefore left at an unmeasured 60, and that is
the correct outcome rather than an omission.** Moving them on the strength of a
PrestaShop measurement would be the very mistake that lesson records - a guess
about someone else's platform dressed as evidence. What the change *must* do is
correct the comments that will otherwise become false: WooCommerce's says it
"mirrors PrestaShop's conservative merchant-hosted default", and InPost's
describes PrestaShop's 60/4 as "the only manifest default in the repo", which
has been untrue since WooCommerce and Subiekt added theirs. Measuring
WooCommerce on this stand is a well-defined follow-up - `lab-woocommerce` is
already running - and is out of scope here.

### 4.2 The replacement comment

```ts
  // Resolution-time fallback for a connection with no explicit
  // config.rateLimit (#1810/#1772). A self-hosted PrestaShop is the operator's
  // OWN webserver - simultaneously the throughput bottleneck and busy serving
  // customers - which is why a default belongs here at all (#1815).
  //
  // 300/min is one request every 200 ms. `requestsPerMinute` is strict
  // minimum-interval spacing with NO burst, CAS'd in Redis across every
  // replica (#2015), so the shop sees an evenly spaced 5 req/s and never a
  // spike; peak concurrency stays at ~1 and `maxConcurrent` is not binding.
  //
  // MEASURED, not inherited (#2840, perf/openlinker-throughput/
  // results-weak-shop-2026-09-07.md). PrestaShop 9.0.2, 50 000-product
  // catalogue, driven at 1-10 req/s of create-path reads across six CPU
  // profiles with the database squeezed alongside the shop on the small ones:
  //
  //   5 req/s (this default) is FREE down to 0.5 cpu (p99 78 ms), and
  //   DEGRADES but never fails at 0.25 cpu (p99 143 ms; 3000/3000 ok over a
  //   sustained 10 min, tail flat). Nothing refused at any profile or rate -
  //   a constrained shop QUEUES, it does not shed.
  //
  // THE BOUND: do NOT read this as support for 600. 10 req/s is free at
  // 1.0 cpu (p99 20 ms) and collapses below it - p99 617 ms at 0.5 cpu,
  // 2126 ms at 0.25. The knee for this value sits between 0.5 and 0.25 cpu.
  //
  // WHAT IT DOES NOT COVER: synthetic cgroup limits on one host are not a
  // hosting provider's abuse policy. The original report (#1810) was an abuse
  // NOTICE, and a rule counting requests per hour is not reproducible here -
  // a busy install really can send ~5x more per hour at this ceiling. If that
  // notice's text ever surfaces a request quota, re-derive from the quota.
  //
  // Deliberately NOT copied to any other manifest: WooCommerce and Subiekt
  // carry their own unmeasured 60/4, and moving them on a PrestaShop
  // measurement is the mistake docs/lessons.md:301 exists to prevent.
  defaultRateLimit: { requestsPerMinute: 300, maxConcurrent: 4 },
```

---

## 5. What this did NOT establish

* **Whether a hosting provider refuses.** A CPU/memory cgroup is not shared
  hosting. A real provider adds concurrent-process caps, I/O throttling,
  per-account request accounting and an abuse rule that may key on request
  *count* rather than on load. This measures how a small box **degrades**; it
  cannot measure whether a provider **blocks**. That is the single largest gap,
  and it is the same gap 60 was chosen under.
* **Memory pressure.** Memory was deliberately held above measured usage (§ 2.5)
  so the CPU sweep had one variable. No reading here is evidence about a
  memory-starved shop.
* **The write path.** The mix is the create path's **GET half** only
  (`ps-latency-probe.mjs` explains why: the POSTs mint real rows). A GET-only
  mix under-represents a write-heavy create path, so a flat curve here is
  necessary and not sufficient.
* **Heavy catalogue reads AT CONCURRENCY.** § 3.4 measured the per-request cost
  of a `display=full` page (395 ms unconstrained, 1021 ms at a quarter core),
  so the weight-blindness of the limiter is now quantified rather than
  hand-waved. What is still unmeasured is four such pages **concurrently**
  against a quarter core - the one shape where raised pacing could plausibly
  bite, bounded by the `maxConcurrent: 4` this change does not touch.
* **WooCommerce, Subiekt, or any other platform.** One shop, one image, one
  host.
* **Concurrency above ~1.** Strict pacing at these rates never puts more than
  about one request in flight, so `maxConcurrent` is untested.

---

## 6. Two process findings, both now in `docs/lessons.md`

**`docker update` cannot restore "unconstrained"** - § 2.2's table. This is the
seventh instance in this campaign of a command succeeding while doing nothing,
and the reason the restore path recreates and verifies rather than trusting an
exit status.

**A scenario-local env knob silently inherited `lib.sh`'s default.** The
scenario wrote `SETTLE_SECS="${SETTLE_SECS:-10}"` *after* sourcing `lib.sh`,
which already declares `SETTLE_SECS="${SETTLE_SECS:-60}"` for the unrelated
guard-to-window settle. The library wins: the script said 10 and did 60. It is
harmless here - a longer settle is *more* isolation between steps, not less, so
no figure above is affected, only the run's length - but the script said one
thing and did another, which is the defect regardless of its sign. Found by
reading the child's `/proc/<pid>/environ` and cross-checking against the
probe's own window timestamps (a real 63.5 s gap), not by re-reading the code,
where the assignment looks correct in isolation. The knob is renamed
`RAMP_SETTLE_SECS`; **the steps in § 3 ran with a ~60 s settle**, which is
stated here rather than silently corrected in the scenario.
