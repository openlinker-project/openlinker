# Will a 5 000 orders/day shop work? The same Tuesday, with the limiter fix in

> **DRAFT - the window has not run yet.** Every `TBD` is a figure this run has
> not produced. Nothing here may be quoted until this banner is gone.

**Run**: TBD. **One continuous measurement window, 3 hours** - the same length,
offered rate, sample cadence, fault timing and dataset as the baseline below.
**Scenario**: `scenarios/sustained-mixed-load.sh`, unmodified.

**Baseline this is compared against**:
`results-sustained-mixed-load-2026-09-08.md`, run `run1788846800`, window
`2026-09-08T05:54:21Z` + 10800s, image
`fabab189eda90f7a09bbe64301449b092b00d5ff`.

**The one variable**: the worker's job-intake loop now holds its own Redis
client unconditionally (#2984, `c0f366ee9`). Nothing else about the stand, the
scenario, the dataset or the offered load was touched. § 1.2 proves that
rather than asserting it.

## 0. The answers, in one page

| Question | Answer | Label |
|---|---|---|
| Steady-state drain, against the baseline's ~216 orders/h | TBD | TBD |
| Does the queue converge now, or still diverge - and at what rate? | TBD | TBD |
| What binds, now that the limiter degradation is gone? | TBD | TBD |
| Did the destination-fault stranding rate change? | TBD | TBD |
| Is 500-600 orders/h at peak sustainable? | TBD | TBD |

> Every figure is labelled **measured**, **derived** or **extrapolated**.
> § 6 "What this did not establish" is not optional reading.

### 0.1 Do not quote 200.6 orders/h as "what OpenLinker does"

This is the sharpest thing to say about arm A and it governs how the whole
A-versus-B comparison should be read, so it comes before the comparison rather
than after it.

**Arm A is not "OpenLinker before the fix". It is a configuration that never
shipped in either direction.** It ran the **new** destination rate limit
(300 req/min, #2982's manifest default) against the **old** shared Redis client
(#2984 not yet in the image). No release ever combined those two. The
pre-#2982 world paced the destination at 60 req/min; the post-#2984 world has
the dedicated client. Arm A sits between them and matches neither.

That makes arm A a **valid control for exactly one comparison** - it isolates
the intake client, because it differs from arm B in four files and one
variable (§ 1.2) - and an **invalid figure to quote on its own**. "200.6
orders/h" describes no shipped OpenLinker. Anyone reaching for a
before-and-after number for a release note or a client document should take
arm B's figure and the service time behind it (§ 2.1), not arm A's.

The same caution applies in the other direction and is why § 6.1 exists: arm
B's throughput was measured on a **saturating** window, so it is a floor on
what the fixed code sustains, and the 1 197/h ceiling derived from it is
arithmetic rather than an observation.

## 1. Conditions

### 1.1 Why this run exists

The limiter A/B (`results-limiter-ab-2026-09-07.md`) measured the dedicated
intake client at **+47%** - 226 orders/h shared, 333 dedicated, with the
destination rate limit raised tenfold in a third arm to show the destination
budget was never the bind. That was measured on an **isolated** stand: no
crons, no catalogue sweeps, one flow at a time.

The sustained mixed-load window (the baseline here) is the only run in this
campaign whose orders/hour figure an operator can apply to their own Tuesday -
scheduler on, 30 crons ticking, catalogue sweeps competing - and it ran on the
**shared** client, because it was measured before #2984 landed. So the two
numbers an owner needs are from different worlds: the improvement is isolated,
and the realistic figure is un-improved.

This run closes that gap by changing one thing and re-running the realistic
window. It answers the owner's actual question - *will a 5 000 orders/day shop
work?* - with a measurement rather than the product of two.

### 1.2 "One variable" is a tree diff, not a claim

The baseline's images carried commit `fabab189e`. This run's carry HEAD. Over
exactly the paths `guard_build` compares:

```
git diff --stat fabab189e HEAD -- apps/worker apps/api libs Dockerfile \
    package.json pnpm-lock.yaml pnpm-workspace.yaml

 apps/worker/src/sync/__tests__/job-intake.consumer.spec.ts | 49 ++++-
 apps/worker/src/sync/job-intake.consumer.ts                | 14 +-
 apps/worker/src/sync/sync-worker.module.ts                 | 95 +++++-----
 apps/worker/src/sync/sync-worker.tokens.ts                 |  9 +-
 4 files changed, 112 insertions(+), 55 deletions(-)
```

Four files, all under `apps/worker/src/sync/`, one of them the change's own
spec. **`apps/api` and `libs` hash identically** across the two commits, so
the api image is equivalent product code and the entire runtime delta is the
worker's intake-client wiring.

Everything else was held: same scenario file, same
`MIXED_DURATION_SECS=10800`, `MIXED_ORDERS_PER_MIN=60`,
`MIXED_SAMPLE_INTERVAL_SECS=30`, `MIXED_FAULT_AT_SECS=6600`,
`MIXED_FAULT_SECS=300`, `MIXED_TENANT=perf-allegro-a`, same stub image and
pinned upstream latencies (`eventsMs 276`, `checkoutMs 1106`), same five
active connections, same 1 worker replica, same lane caps, same
`operational_settings` cadence row (empty), scheduler ON, and the same
destination-rateLimit handling (the stand's
`{maxConcurrent: 4, requestsPerMinute: 60}` override removed for the window so
the plugin manifest's 300/4 applies, then restored).

Those knobs are taken from the baseline's **`manifest.json`**, not from its
report's § 8 reproduce block: that block documents the planned 4-hour shape
(`14400` / fault at `9000`) and is stale against the 3-hour window that
actually ran. The manifest is what the run recorded about itself.

### 1.3 Verifying the fix is in the image, three ways, none of them a log line

The obvious check is worthless here, and the reason is worth stating because
it is exactly the shape of a mistake this campaign has already made.

`guard_build` and the scenario both read the worker's startup line. Post-#2984
that line says `DEDICATED` **unconditionally**, so reading it proves only that
the process booted. Worse, the *pre*-#2984 image contains the string
`client: DEDICATED` too - it logged on both branches - and its shared-branch
message is

```
Job intake Redis client: SHARED (OL_JOB_INTAKE_DEDICATED_REDIS is not true)
```

which **contains the substring `DEDICATED` inside the variable's own name**.
The baseline's own smoke run recorded DEDICATED for a worker that had logged
SHARED, on exactly that bug. And `printenv OL_JOB_INTAKE_DEDICATED_REDIS` now
answers empty on any stand, because `docker-compose.lab.yml` still passes the
variable through even though no code reads it.

So the fix was verified by reading values back, three independent ways
(`results/verify-fix-in-image.sh`):

1. **Structural.** The image label's commit, compared tree-by-tree against the
   working tree over `guard_build`'s own path set, plus
   `git merge-base --is-ancestor c0f366ee9 <image revision>`. This is the
   strongest of the three because it does not depend on any string surviving
   compilation.
2. **Artefact.** The compiled `sync-worker.module.js` *inside the running
   container*: the deleted flag must be mentioned **0** times (the pre-#2984
   image mentions it 3 times) and `client: DEDICATED` must be present with
   `client: SHARED` absent (the pre-#2984 image carries both).
3. **Behavioural.** The worker's Redis connection census on the stand's Redis
   (`CLIENT LIST`, filtered to the worker's container ip). Pre-#2984 the worker
   held **two** connections and **both** were parked in `xreadgroup`: the
   events consumer's own dedicated client, and the shared client sitting in the
   intake block - which *is* the defect, since that shared client is what
   `RateLimitModule` builds the outbound limiter on. Post-#2984 there must be
   **three**, with the extra one not in a blocking read.

**The verifier was proven red-first**, run against the old image before the
rebuild, and all three read-backs failed - each for its own distinct reason. A
check that has never been observed to fail is not evidence.

**Results, against the running image** (`results/verify-fix-AFTER.txt`):

```
1. STRUCTURAL
   worker image revision : 629921c5fe000f24dd66a02836a52a32ac58d877
   working tree HEAD     : 629921c5fe000f24dd66a02836a52a32ac58d877
   ok  apps/api  apps/worker  libs  Dockerfile  package.json
       pnpm-lock.yaml  pnpm-workspace.yaml
   ok  c0f366ee9 is an ancestor of the image's commit

2. ARTEFACT
   mentions of the deleted flag : 0        (pre-#2984 image: 3)
   intake-client strings        : [client: DEDICATED]   (pre-#2984: both)

3. BEHAVIOURAL
   connections from the worker  : 3        (pre-#2984: 2)
   by in-flight command         : 1 set, 2 xreadgroup
   parked in xreadgroup         : 2 of 3   (pre-#2984: 2 of 2)
```

The third read-back is the most direct evidence the change does what it says:
the extra connection is **not** in a blocking read, it is executing a `SET` -
that is the shared client, no longer parked in the intake block and therefore
available to the outbound rate limiter, which is the entire mechanism.

`guard_build` independently agreed at the scenario's own pre-flight:
`guard_build ok (image sha=629921c5f, tree HEAD=629921c5f, product paths
identical)`.

**And the running configuration is identical, not merely similar.** The
worker's own `printenv`, taken inside both windows and sorted, differs in
**exactly one variable**:

```
7c7
< HOSTNAME=d48db2d997fe      (baseline)
> HOSTNAME=32298b5ba289      (this run)
```

All 29 others match byte for byte - including `OL_JOB_INTAKE_DEDICATED_REDIS=`
(still passed through by compose, still empty, now read by nothing), all eight
`OL_LANE_*_CAP` unset so the code defaults apply, `OL_SCHEDULER_ENABLED=true`,
`WORKER_RUNNER_ENABLED=true`, and the Redis host and port. The lane caps the
runner then resolved are the same string in both:
`realtime=4/2 bulk=12/8 fiscal=2/1 fan-out=8/4`.

#### 1.3.1 Two guard failures, in OPPOSITE directions - and only one of them is in the standing lesson

The campaign already knows that a counting guard must be proven able to
**fail** before a zero from it is trusted. Both failures below are outside
that lesson, and a reader who has only seen the false-negative version will
not recognise either. **The generalisation is the finding: a guard's output
has to be verified in both directions, because a false pass sends someone to
rebuild something that was already correct, and a false fail hides a real
defect.**

**A guard reported a FALSE FAIL on a correct image.** On its first run against
the fixed image the verifier printed `VERDICT: FAILED` while every individual
read-back was green. The mechanism: `grep -c` **prints its count and exits 1
when that count is zero**, so the defensive `|| printf 0` fallback fired *on
success* and appended a second zero. The variable became `"0\n0"`, which
compares unequal to `"0"`, so the arm that was supposed to confirm "the
deleted flag is mentioned zero times" failed **precisely because it was
mentioned zero times**. The correct answer produced the failing branch. Had it
been believed, the next step would have been to rebuild a correct image and
re-measure - burning the window this run exists to spend.

It is the mirror of the known `grep -q` / `| head -1` trap, which reports
failure on success via SIGPIPE under `pipefail`. Same root, opposite surface:
a shell builtin whose exit status encodes a *count* rather than an *error*.

**A poll observed itself, and therefore always reported the condition it was
waiting for.** Three background waiters built on

```
until ! pgrep -f 'docker build --target worker'; do sleep 20; done
```

never terminated, because `pgrep -f` matches full command lines and each
waiter's own command line **contains the string it is searching for** - as did
its two sibling waiters'. So the wait could not end even after the build
finished, and a separate check printing `api build running? yes` was reading
the same self-match rather than a build. **The api image was never built at
all for ten minutes while a poll asserted it was in progress.** This is the
false-pass shape one layer out: not a guard that miscounts, but a poll whose
own existence satisfies its predicate.

**And a third, which is why the first one was nearly missed.** `exit=$?` after
`... | tee file` reports **tee's** status, not the script's - so the false FAIL
was printed with `exit=0` on the line directly below it. Two contradictory
signals, and the reassuring one was the artefact.

All three were fixed rather than worked around: the count is read without a
success-swallowing fallback, the waiters were replaced with condition checks
that cannot match themselves, and exit status is read from the command rather
than from the end of a pipeline.

### 1.4 Dataset, and how it differs from the baseline's

The baseline ran first, on the same stand, so its own window left the dataset
slightly larger. Stated rather than assumed away:

| Axis | Baseline at its window start | This run at its window start | Delta |
|---|---|---|---|
| `order_records` | 2 003 176 | 2 004 573 | +1 397 (+0.07%) |
| `sync_jobs` rows | 140 772 | 143 512 | +2 740 (+1.9%) |
| `sync_jobs` queued/running | 0 | 0 | - |
| `products` / `product_variants` | 60 006 / 111 678 | 60 006 / 111 678 | unchanged |
| PrestaShop catalogue | 50 006 active | 50 006 active | unchanged |
| `pg_database_size` | 4 817.7 MB | 4 839 MB | +21 MB (+0.4%) |
| Allegro offer mappings (`perf-allegro-a`) | 200 | 200 | unchanged |
| Active connections | 5 | 5 | unchanged |

The scenario's own teardown deletes only the `queued`/`running` rows it
created *inside* its window, so the baseline's 13 070 unreached rows went and
its 602 succeeded plus 352 dead rows stayed - which is the +2 740. Nothing
here is large enough to move an orders/hour figure, and the catalogue the
sweeps enumerate is byte-identical.

**One leftover had to be cleared by hand, and it is the same one the baseline
cleared.** Twelve `queued` rows (10 `marketplace.order.sync`, 2
`marketplace.offerQuantity.reconcile`) carried `createdAt` of
05:54:01-05:54:11 - i.e. *inside the baseline's 60 s settle, before* its
window opened at 05:54:21Z - so its `createdAt >= WS_ISO` purge did not reach
them and `guard_queue_empty` would have refused this run. They were deleted
before the window. This run will leave its own equivalent handful behind for
the same structural reason.

### 1.5 Memory is read from cgroups, not from `docker stats`

Both samplers inside the harness record `docker stats` MemUsage, which
**includes the page cache**, so for any container that reads files it cannot
be read as memory growth. The baseline measured `lab-postgres` at 1.412 GiB by
that figure against **17.4 MiB** of anonymous RSS and 1.53 GiB of reclaimable
cache, and nearly published a 7.7x "leak" that was not one.

The baseline author started a cgroup sampler **by hand, mid-window, at
~t+2900s**, and recommended the scenario sample RSS from `window_start` in
future. This run does that, out of band
(`drivers/cgroup-rss-sampler.sh`), started at window open - so its RSS series
covers the whole window while the baseline's covers the last ~2/3. That is an
**observation asymmetry between the two runs and is stated rather than
glossed**; it changes no load (one `cat` of `memory.stat` per container per
30 s) and it is deliberately *not* wired into the scenario, because this
re-run's whole value is that the instrument did not change between the two
windows.

### 1.6 The method, written down before the numbers exist

Recorded here so the analysis cannot be chosen after seeing which answer it
gives.

**The queue slope is not the convergence answer, and must not be sold as one.**
The scenario offers **60 orders/min = 3 600 orders/h**, and its own header
says that rate is chosen to saturate. `allegro-orders-poll` runs
`*/1 * * * *` and takes up to 100 events a tick, so it keeps up with the
offered rate and enqueues ~3 600 `marketplace.order.sync` an hour against a
baseline drain of ~216/h. The queue therefore diverges **by construction**,
and would still diverge at 333/h. `verdict=growing` is a property of the
offered load, not a capacity finding, and the only honest reading of a slope
*change* between the two arms is `delta(slope) ~= -delta(drain)` - a
cross-check on the drain figure, nothing more. Any claim about whether a real
shop's queue converges has to compare that shop's arrival rate against the
measured **drain**.

**The owner's question, in the only arithmetic that answers it.** 5 000
orders/day is **208/h averaged**; concentrated into four to six hours it is
**500-600/h at peak**. So the install converges at its daily average iff
drain > 208/h, and survives its peak iff drain > 500-600/h. The baseline's
~216/h is marginally above the first line and far below the second.

**The question this run answers is narrow, and the baseline is what narrows
it.** `marketplace.order.sync` is registered on the **`realtime`** lane
(`handler-registration.service.ts:150-154`), whose caps this stand resolved to
`realtime=4/2` - total 4, **perScope 2**. Every order from one source
connection shares one scope, so at most two order-sync jobs run at once, and
the ceiling is

```
orders/h  =  2 slots  x  3600  /  mean-seconds-per-order
```

The baseline did not leave that as arithmetic. It established the ceiling is
**slot-bound, not budget-bound**, and confirmed the concurrency twice over:
Little's law read **1.941**, and an interval-overlap count found a maximum of
**2 concurrent of 105 probes, with none above**. Meanwhile the destination ran
at roughly **12% of its 300 req/min** allowance, so the rate limit was nowhere
near binding. And the lane cap is not the lever either: **arm ED raised it and
throughput FELL 12.5%.**

So exactly one term in that equation is in play here, and it is the service
time. The baseline's mean per-order service time was **31.4 s**, which at two
slots gives 229 orders/h against the 217.3 it measured. **The question is
therefore: does removing the intake block cut the 31.4 s, and by how much?**
The ceiling then moves as `2 / new service time` and nothing about the rate
limit or the lane cap enters into it.

**Consequently no throughput number appears anywhere in this report without
the service time it came from.** A reader handed "N orders/h" and no service
time will attribute the change to the wrong lever - most likely to the rate
limit, which arm ED already showed is not it, or to the cap, which arm ED
showed moves it the wrong way.

Pre-registered prediction, kept as written: *if the fix removes the same ~10 s
the isolated A/B implies (226/h ⇒ 31.9 s, 333/h ⇒ 21.6 s), drain lands near
300-330/h with per-order duration near 21-23 s.* One correction to how that
was derived - it inferred ~33.3 s per order from the baseline's own drain, and
the baseline's directly measured mean is 31.4 s, so the inference was close but
the measurement supersedes it. Note also that summary § 8's **p50 of
16 776 ms is not this statistic** and must not be substituted for it: that
percentile is over every attempted row including requeued partial attempts, so
it is far below the mean service time of a completed order.

**The early limiter reading is early, not the result.** At t+68 s this window
recorded `limiter_degraded_delta = 0` against 87% of baseline samples carrying
at least one - but the baseline's degradations ran at roughly 8/min in steady
state, so 68 s is inside the noise for that rate. The claim that carries
weight is the **whole-window** count against the baseline's authoritative
**1454**, and that is the only limiter figure quoted in § 3.

**Both arms come out of one query.** The teardown purges only
`queued`/`running`, so the baseline's *succeeded* order-sync rows and their
`lastAttemptDurationMs` survive in `sync_jobs` and can be sliced by
`createdAt` alongside this run's. NULL is excluded and the non-null `n` is
printed beside every figure, per #2611: the column is null on rows predating
its migration and is reset on every enqueue, so counting nulls as zero
understates every duration.

**Stranding** reproduces the baseline's § 3.4 method exactly - the
summarizer's § 7 counts, plus the signature of a stranded order (every
`syncStatus` entry failed while its job reads `succeeded / ok`). The
expectation is **no change**, because exposure is bounded by how many orders
sit in the dispatch step at the instant the destination goes away - the same
`realtime` per-scope cap of 2 - and not by queue depth or by the limiter. A
null result confirmed is still worth having: the baseline could only observe
it once.

**Things that will fire and are not findings.** `post_guard_attempts`,
`post_guard_deferrals` and `post_guard_destination_creates` fire structurally
on any window that ends with work queued, which a deliberately saturating
window always does; the baseline's `verdict.txt` reads DISCARDED for the same
reasons, so the two arms stay comparable and § 5 says which figures may
travel. If `post_guard_limiter_degraded` now answers `ok`, that is the fix
landing, not the instrument breaking. And the summarizer's § 4 extrapolation
compares against the retest campaign's shared-client arm - a configuration
that no longer exists in the product - so if observed episodes are 0 it will
print `0.00x` against a predicted 1 440-1 764. **That ratio is meaningless now
and is not quoted as a finding anywhere in this report.**

## 2. What happened - INTERIM, read at t+853s of 10800s

> Everything in § 2 is an **interim** read taken 14 minutes into the window,
> committed because the service-time measurement is durable and the pushed
> record should not sit only in a session. The whole-window figures are § 3's
> and supersede these. The fault had not yet fired.

### 2.1 Per-order service time, both arms, one statistic

The only term of `orders/h = 2 slots x 3600 / service-seconds` that was in
play (§ 1.6). Mean `lastAttemptDurationMs` over **succeeded**
`marketplace.order.sync` rows, NULL excluded, sliced by `createdAt`:

| Arm | n | mean | p50 | p95 |
|---|---|---|---|---|
| A baseline, shared client | 602 | **32 404 ms** | 30 488 | 35 667 |
| B fixed, dedicated client | 223 | **6 014 ms** | 6 194 | 8 700 |

**5.39x reduction in per-order service time** - measured, both arms, same
query, same window boundaries, same statistic. Arm A's 32.4 s agrees with the
31.44 s the baseline reported for itself; the small difference is slice
(this is succeeded-only across A's whole window).

A third slice of 59 rows sits between the two windows (`createdAt` between
08:54:23Z and 09:29:28Z - jobs the scheduler minted during arm B's own 60 s
settle) at mean 6 270 ms. It is excluded from both arms and is noted only
because it is consistent with the fixed image.

### 2.2 The slot arithmetic, with the measured service times in it

| | Arm A | Arm B (interim) |
|---|---|---|
| mean service time | 32.404 s | 6.014 s |
| ceiling `= 2 x 3600 / service` | **222 orders/h** | **1 197 orders/h** |
| observed completed | 200.6/h | ~986/h |
| Little's law `L = throughput/s x service` | 1.81 | 1.65 |

`L` stays **under the `realtime` perScope cap of 2 in both arms**, so the
structure is unchanged and the fix moved only the service time inside it -
which is exactly what the baseline's slot-bound finding predicted would
happen if anything moved at all.

### 2.3 The orders are real, and that was checked rather than assumed

A 5x jump is the kind of result that is usually an artefact - most cheaply, a
job that "succeeds" without reaching a destination. It is not that here:

```
ingested 263 | with syncedAt on the PrestaShop destination 262 | any failed entry 262
```

262 of 263 orders carry a `syncedAt` for the destination under test, so the
shop really created them. `lab-prestashop` read `Up 9 hours (healthy)`
throughout. The 262 with a failed entry are the WooCommerce
`No WC product mapping` failures - the same shape arm A shows
(652 / 649 / 650), and the subject of § 7.4(b).

### 2.3.1 Cross-check against an independent mid-window read

An independent read of the same window at **t+8622s** recorded **2 304 orders
completed in 8 622 s = ~962 orders/h**, with the degradation counter at
**0** against arm A's 1 454. That agrees with § 2.2's ~986/h to within 2.5%,
and the two are taken 8 000 s apart, so the rate is stable rather than a
sampling accident.

**Which figure this report quotes, and why.** § 3's headline is the
**whole-window** figure the summarizer computes - first sample to last, no
trim - because that is the statistic arm A's 217.3/h is, and comparability
beats flattery. A mid-window rate and a whole-window rate can legitimately
differ on a saturating window: the first minutes drain a primed backlog at an
inflated rate (this window's first 305 s read 1 027/h), and the fault plus
recovery pull the whole-window average down. If the final figure differs
materially from ~962/h, the difference is that trim, not a change in the
system, and § 3 says so explicitly rather than leaving a reader to reconcile
two numbers.

### 2.4 Limiter degradation, interim

**0 episodes** at t+853s. Held as interim per § 1.6: arm A degraded at roughly
8/min in steady state, so this is now beyond the noise window that made the
t+68s reading meaningless, but the figure that will be quoted is the
whole-window count against arm A's authoritative **1454**.

### 2.5 The pre-registered prediction was wrong, in the conservative direction

§ 1.6 predicted **300-330 orders/h** with service time **21-23 s**, on the
reasoning that the mixed window would see the same ~10 s saving the isolated
A/B implied. Measured: **6.0 s** and ~986/h. The prediction was not
conservative by a little, it was out by a factor of four, and the reason
matters more than the miss.

The likely mechanism - stated as a **hypothesis**, not a measurement - is that
the defect's cost scales with **co-tenancy**. The shared Redis client is what
`RateLimitModule` builds the outbound limiter on, and under 30 ticking crons
plus catalogue and inventory sweeps there is far more traffic contending for
it than in an isolated single-flow arm. If so the isolated A/B's **+47% was a
floor, not the headline**, and this is the first measurement of the defect
under the co-tenancy an operator actually runs. What would confirm it is a
limiter-wait measurement per arm, which neither arm carries; § 6 records that
as unestablished.

## 3. Findings - arm B, whole window

Window `2026-09-08T09:29:28Z` + 10802s, 10800 orders offered, 299 samples.
These supersede § 2's interim.

### 3.1 The comparison

| | A shared | B dedicated | change |
|---|---|---|---|
| **service time** mean, succeeded `order.sync` | **32 404 ms** (n=602) | **6 344 ms** (n=2 919) | **5.11x faster** |
| p50 / p95 | 30 488 / 35 667 | 6 234 / 9 232 | |
| orders/h ingested, whole window | 217.3 | **988.4** | 4.55x |
| orders/h completed, whole window | 200.6 | **971.3** | 4.84x |
| orders/h completed, steady phase | 193.3 | 986.7 | 5.10x |
| ceiling `2 x 3600 / service` **[derived]** | 222/h | 1 135/h | |
| Little's law `L` | 1.81 | 1.71 | both **under 2** |
| **limiter degradation, authoritative** | **1 454** | **0** | eliminated |
| queue last-third slope | +4 298/h | +3 859/h | -10% |
| jobs with `attempts>1` | 474 | 1 321 | |
| dead jobs | 352 | 15 | |

Per your rule, no throughput figure without its service time: **971.3
orders/h at a 6 344 ms mean service time.** The whole-window figure is quoted
because it is the statistic arm A's 200.6/h is; the steady phase reads
986.7/h and an independent mid-window read gave ~962/h, so the three agree
within 2.5% (§ 2.3.1).

### 3.2 Limiter degradation went to zero, and that is the authoritative count

`post_guard_limiter_degraded` **is absent from arm B's `verdict.txt`** - it
answered `ok`, i.e. **zero** degraded-mode lines in a whole-window single
grep, against arm A's **1 454**. The CSV sum agrees at 0. `post_guard_deferrals`
also went from firing to `ok`.

So #2984 did not reduce the degradation, it **removed it**, under exactly the
co-tenancy an operator runs.

### 3.3 The mechanism, and it is more specific than the hypothesis I published

§ 2.5 guessed "co-tenancy" loosely. The per-type durations say something
sharper. Four *unrelated* job types in arm A all sit at a p50 of roughly
**4.4-4.6 s**, and in arm B they collapse to **milliseconds**:

| jobType | A p50 | B p50 | ratio |
|---|---|---|---|
| `inventory.propagateToMarketplaces` | 4 589 ms | **17 ms** | 270x |
| `master.inventory.syncByExternalId` | 4 392 ms | **206 ms** | 21x |
| `marketplace.offerQuantity.update` | 9 282 ms | **130 ms** | 71x |
| `marketplace.orders.poll` | 9 692 ms | **326 ms** | 30x |

A job that does 17 ms of work cannot have been doing 4 589 ms of work. That
floor is not the work; it is **a wait**, and its magnitude is the signature
#2984's own commit message predicts: `JobIntakeConsumer` blocks on
`xReadGroup` with `BLOCK: 5000`, and any command queued behind an in-flight
block waits out its residual - a mean of ~2.5 s for uniform arrival, more with
several commands queued. **Every Redis-touching job in the worker was paying a
share of one five-second blocking read.**

That is why the whole system sped up ~5x rather than just the order path, and
it refines the hypothesis rather than confirming it: co-tenancy is not the
mechanism, it is the **multiplier** - it decides how many commands pay the
residual, which is precisely why an isolated single-flow A/B measured +47%
where this measures 5x. **Still short of proof**: these are per-job totals,
not a limiter-wait distribution, and § 6.2's named experiment is unchanged.

### 3.4 The bottleneck did NOT move to the offer-quantity fan-out - hypothesis refuted

§ 2 flagged that `marketplace.offerQuantity.update` queue depth tripled
(504 -> 1 719) and that this might mean the freed capacity had merely shifted
the constraint. **Tested and refuted.** Over the same arms that type went from
150 attempted rows at a 9 282 ms p50 to **2 574 attempted rows at a 130 ms
p50**. Its depth grew because **17x more of it was completed**, not because it
backed up.

Nothing became the new bottleneck. The offered rate is still 3 600 orders/h
against a 988/h drain, so everything downstream still accumulates - which is
the load shape, not a constraint (§ 6.1).

### 3.5 The queue still grows, and the slope barely moved - which is arithmetic, not a disappointment

`verdict = GROWING`, last-third slope **+3 859 jobs/h** against a ±1 132
noise band, depth 66 -> 11 809. Arm A was +4 298.

A 4.8x throughput gain moving the slope only 10% looks wrong until the
subtraction: queue growth is `offered - drained`, so it went from
`3 600 - 200 = 3 400` to `3 600 - 971 = 2 629` on the order path - a 23% fall -
partly offset by the sweeps completing far more work and enqueuing more
children. **The slope is dominated by the offered rate, not the drain**, which
is exactly why § 1.6 pre-registered that it cannot answer the convergence
question and why arm C exists.

### 3.6 The fault behaved as arm A's did

Fault at t+6603s, cleared t+6902s. Order processing stopped almost completely
for its duration (**2 orders ingested and 2 completed across 257 s of
samples**, 28.0/h) and resumed immediately: the recovery phase ran at
1 015.7/h ingested and 1 016.6/h completed, i.e. **at or slightly above the
steady phase**. No `marketplace.order.sync` job died. **15** dead jobs across
the window, against arm A's 352.

## 4. The owner's question: will a 5 000 orders/day shop work?

**Yes, with room - and the number that carries the answer is the service
time, not the throughput.**

5 000 orders/day is **208/h averaged**, and 500-600/h at a four-to-six-hour
peak. The measured facts:

| | Required service time at 2 slots | Measured | Verdict |
|---|---|---|---|
| 208/h daily average | <= 34.6 s | **6.34 s** | clears with 5.5x margin |
| 500/h peak | <= 14.4 s | **6.34 s** | clears with 2.3x margin |
| 600/h peak | <= 12.0 s | **6.34 s** | clears with 1.9x margin |

The arithmetic is `orders/h = 2 slots x 3600 / service-seconds`, and every
input is measured except the slot count, which is `OL_LANE_REALTIME_SCOPE_CAP`
observed in force in both arms.

**Before the fix the answer was no.** At 32.4 s, two slots give 222/h - so a
5 000/day shop was marginal at its *daily average* and could not have carried
its peak at all. That is the change #2984 makes, and it is why the service
time is the figure to quote rather than the throughput.

**Three bounds on that "yes", stated because they are the difference between
an answer and a sales figure:**

1. **971.3 orders/h is a floor, not a ceiling.** It was measured on a
   *saturating* window - 3 600/h offered - so it is what the system sustained
   while permanently behind, not what it can do. The 1 135/h ceiling is
   **derived arithmetic** and nothing here observes it (§ 6.1). **Arm C, at
   600/h, is the first window that puts weight on the peak figure**, and its
   result belongs in this section when it closes.
2. **One worker replica.** Lane caps bound one *process*, so a real
   deployment multiplies by replica count - this is a per-process answer, not
   a deployment one.
3. **The peak is answered at 600/h, not above it.** Nothing here measured
   700/h or 1 000/h, and the honest form of the claim is "600/h is inside the
   measured service time's envelope with ~1.9x margin", not "the system does
   1 135/h".

**What to do about it operationally**: nothing. No cap needs raising - arm ED
measured that raising the lane cap made throughput *fall* 12.5%, and the
destination ran at ~12% of its 300 req/min budget in arm A. The lever was the
intake client, it has shipped, and the next one is § 8.3's unowned 3.1x.

## 5. Verdict, post-guards, and whether any figure here is VALID

**Arm B: `status=DISCARDED`, on two guards - one fewer than arm A.**

```
reason=DISCARDED post_guard_attempts: 1318 job(s) in the window show attempts>1
reason=DISCARDED post_guard_destination_creates: 2967 order(s) carry a failed
       syncStatus entry, 1484 lack syncedAt on the declared destination
```

| Guard | Arm A | Arm B | reading |
|---|---|---|---|
| `post_guard_attempts` | fired (474) | fired (1 318) | structural - scheduler-minted jobs carry the entity default of 10 attempts |
| `post_guard_destination_creates` | fired (650/729) | fired (2 967/1 484) | **the § 7.4(b) defect** - see below |
| `post_guard_limiter_degraded` | **fired (1 454)** | **ok (0)** | **the actual defect, actually fixed** |
| `post_guard_deferrals` | fired | **ok** | |
| `post_guard_requeues` | ok | ok | |
| `post_guard_containers_stable` | ok | ok | |
| `post_guard_generator_saturated` | ok | ok | n/a on this path |
| `post_guard_feed_starved` | ok | ok | `minAvailableWork=128` throughout |

**Arm B eliminated one of arm A's three discard reasons by repairing the thing
it measured**, which is the cleanest possible confirmation: the guard that was
supposed to notice the limiter defect stopped firing when the defect went
away.

**And `post_guard_destination_creates`' count is now impossible on its face**,
which is § 7.4(b) confirmed rather than argued: it reports **2 967** orders
carrying a failed entry against **2 961 ingested from the source**. A count
exceeding the population it claims to describe can only come from an
unscoped predicate - it is counting orders from other sources, and counting
WooCommerce mapping failures on essentially every order. The measured
destination-scoped figures for arm A were **1 and 1**.

**Why this section is not a formality.** All four F1 order-path runs are
`DISCARDED`, and #2847 records that their **66 s** and **182-295 orders/h**
figures are **withdrawn**. Two client-facing documents currently read
"measurement in progress" for that flow. So the question of whether this
window's `verdict.txt` reads `VALID` is not bookkeeping - it decides whether
there is an order-path number anybody may publish.

**The honest expectation, stated before the verdict is read**, is that this
window is also `DISCARDED`, for the same three structural reasons the baseline
was: `post_guard_attempts` (scheduler-minted jobs carry the entity default of
10 attempts, and `PERF_MAX_ATTEMPTS` is deliberately not applied here),
`post_guard_deferrals`, and `post_guard_destination_creates` (which counts
every window order lacking a `syncedAt` on the declared destination, and a
deliberately saturating window always ends with work queued). A window built
to saturate cannot satisfy guards that assume it drained.

That does **not** make the two arms incomparable - both carry the same
structural discards, which is exactly why a like-for-like re-run was the right
instrument. But it does mean § 3's figures travel with a named scope rather
than as a clean `VALID`, and this section says which ones and why. If the
verdict does come back `VALID`, that is stated explicitly and prominently,
because it would be the first valid order-path measurement in the campaign.

`post_guard_limiter_degraded` is the one guard whose answer here is a
**finding rather than an artefact**: it fires on any degraded-mode line inside
the window, and the baseline's authoritative count was 1454.

## 6. What this did not establish

### 6.1 The 5.39x is a SERVICE-TIME measurement. The 1 197/h is not a measurement at all.

These two numbers are the most consequential in the campaign and they have
very different standing. Quoting them at the same confidence is the single
easiest way to misuse this report.

**Measured.** Per-order service time fell from **32 404 ms to 6 014 ms**, mean
`lastAttemptDurationMs` over succeeded `marketplace.order.sync`, n=602 against
n=223, same query, same statistic, same window boundaries. And it is not fast
failures: **262 of 263** arm B orders carry a `syncedAt` for the destination
under test, with `lab-prestashop` healthy throughout. That check was run
*before* the number was believed, because a 5x jump is usually an artefact and
the cheapest artefact is a job that succeeds without reaching anything.

**Derived.** The **1 197 orders/h** ceiling is `2 slots x 3600 / 6.014 s` -
**slot arithmetic over a measured service time, never an observed
throughput.** Nothing in arms A or B put weight on it: both were offered
3 600/h and both saturated, so the highest throughput either one *observed* is
a lower bound on the ceiling, not the ceiling. **Arm C at 600/h is the first
measurement that puts any weight on it**, and even a clean pass there
constrains it only from below (600 sustained ⇒ ceiling ≥ 600). The figure that
would establish it is a ramp to refusal, which no arm here performs.

### 6.2 The co-tenancy hypothesis is unconfirmed, and the measurement that would settle it is named

§ 2.5 records the miss plainly: **300-330 orders/h predicted, ~986/h
measured** - out by a factor of four, in the conservative direction. The
hypothesis is that the defect's cost scales with **co-tenancy**: the shared
Redis client is what `RateLimitModule` builds the outbound limiter on, so 30
ticking crons plus catalogue and inventory sweeps contend for it far harder
than an isolated single-flow arm, which would make the isolated A/B's **+47% a
floor rather than the result**.

**That is a hypothesis and nothing here tests it.** What would settle it is a
**per-arm limiter-wait measurement** - the time an outbound call spends
waiting for a pace token, distributed, on the shared client versus the
dedicated one, under identical co-tenancy. Neither arm carries it: the only
limiter observable in this harness is the *degraded-mode log line count*,
which says the limiter gave up, not how long callers waited before it did. A
run that instruments the wait (or a histogram exported from
`rate-limit.module.ts`) is the experiment; a fourth mixed-load arm is not.

A campaign that records only its confirmed predictions is advertising rather
than measuring, so the miss stays in § 2.5 at full size and this section names
what would close it.

### 6.3 A withdrawn memory figure from arm A, and the mechanism that produced it

Arm A's own report claims **worker RSS +0.67 MB/h** with `first = 133.1`,
`last = 133.6` and the conclusion *"no leak is detectable over three hours"*.
**That is withdrawn**, and it matters here because it is the fourth instance
on this branch of the same failure: the arithmetic completed, nothing errored,
and the answer was quietly wrong.

**The mechanism.** The sampler was started by hand and was still appending
after the run ended. Its series ends `08:57:35Z` against a run that ended
`08:54:25Z`, and inside those three minutes the worker RSS goes
`116.21 -> 75.06` (shutting down), `80.84 -> ~0` (container gone - the raw
sample is a signed underflow), then `~0 -> 133.64` (**a fresh container's
startup RSS**). So the quoted `last = 133.6` is not the run's last sample at
all, it is **a different, restarted process**, and the quoted `min = 75.1` is
a shutting-down one. A least-squares fit over well-formed rows returned a
plausible number across a container boundary it had no way to see.

Put beside § 1.3.1's three: `grep -c` exiting 1 on a zero count (a guard
passing a correct image as FAILED), a `pgrep -f` poll matching its own command
line (a wait that could never end), `exit=$?` after `| tee` (reading the
wrong process's status), and now **a restarted container silently entering a
slope**. None of the four threw. All four produced a confident wrong answer.

Cut at the run's own end (n=131, `06:40:39 -> 08:53:27`) the slope is
**+1.81 MB/h** - 2.7x the withdrawn figure - and first-versus-last is
`133.09 -> 116.21`, **16.9 MB apart rather than 0.5**. And the corrected
reading is *weaker*, not stronger: +1.81 MB/h sits **inside** the ±1-2 MB/h
that three hours cannot separate from jitter against a 45 MB oscillation band,
so the honest answer is **not measured**, not *no leak*. Arm A's own stated
bound was right even though its number was not - a leak slower than ~1 MB/h is
invisible at this window length, and no 24-hour window was run.

**For a sizing reader the guidance is the measured maxima, not any slope** - a
slope this run cannot resolve must not enter a provisioning decision in either
direction.

The verbatim withdrawal block lives in PR #2992
(`docs/operations/requirements-and-scaling.md` § 6) and is written in the
`results-F7-2026-09-06.md` withdrawal-in-place style. It has to be copied into
**arm A's own report § 4**, which is not reachable from
`perf-programme-2840` - it exists only on `2840-sustained-mixed-load` and this
branch. That paste is queued behind arm C rather than done now: arm A's branch
has advanced by two commits since this branch merged it, and one of them edits
`scenarios/sustained-mixed-load.sh` (adding the `attributionImpossible`
manifest flag #2840 asked for - metadata and comments, no behaviour). Merging
it mid-flight would have arm C running a scenario file arm B did not, and
instrument parity across the three arms is the whole reason the comparison
carries weight (§ 7.4(b).2). The merge and the paste happen together, after
arm C closes.

### 6.4 Everything else this run does not answer

- **The composition #2840 asked for is still incomplete.** Arms A, B and C
  carry sweep crons and an order ramp; **none carries stock churn**. Inherited
  from arm A, which named the same gap.
- **One replica.** Lane caps bound one worker *process*, so every figure here
  multiplies by replica count in a real deployment and none of it is a
  deployment-level statement.
- **One destination shape.** The fault arm is timeout-shaped (`docker pause`);
  an error-response-shaped fault is unmeasured here, as arm A also recorded.
- **RSS coverage is asymmetric between arms.** Arm A's cgroup sampler started
  by hand at ~t+2900s; arms B and C sample from window open (§ 1.5). Load is
  unaffected; the comparison window is not the same length.
- **No read-path cost at this history.** `order_records` grew by ~2 000 rows
  across the three arms on a 2.0M-row table; nothing here measures operator
  read latency against it.
- **The service time is a mean over an attempt that succeeded.** It says
  nothing about the tail an operator waits on when a retry ladder engages;
  p95 is reported beside it precisely so the mean is not read as the whole
  distribution.

## 7. Arm C: a window built to DRAIN - pre-registered before it opened

> Everything in § 7 was written and committed **before arm C's window
> opened**. Its results appear in § 7.5 and nowhere above.

### 7.1 Why a third arm, and why it is not a re-run

Arms A and B (baseline and fixed) both offer **3 600 orders/h against a
~200/h ceiling**, and the scenario's own header says that rate is chosen to
saturate. Meanwhile `post_guard_destination_creates`,
`post_guard_attempts` and `post_guard_deferrals` all assume the window
**drained**.

Those two facts are incompatible. **That scenario can never return `VALID`,
however healthy the system is** - not because anything is broken, but because
the load shape and the guards disagree about what the window is for. It is a
scenario-versus-guard mismatch, and its consequence is that the campaign
currently has **no instrument capable of producing a valid order-path figure
at all**. All four F1 runs are `DISCARDED` and #2847 has withdrawn their 66 s
and 182-295 orders/h figures.

Arm C exists to close that gap: offer *below* the ceiling so the window
provably drains, and see whether the guards then pass.

### 7.2 Design, and one constraint that forced a deviation

Every variable is held at arms A and B's value except the offered rate, and
the fault is switched off (`MIXED_FAULT_AT_SECS=0`, which the scenario skips
on a `-gt 0` gate, so no edit is needed). A dependency fault guarantees a
backlog and would reintroduce exactly the non-drainage the guards refuse;
#2978 and arm B already cover fault behaviour.

**The requested 150 orders/h is not expressible, and I did not round toward
the ceiling.** `MIXED_ORDERS_PER_MIN` is passed straight to `of_push_orders`
as an integer count per one-minute tick (`sustained-mixed-load.sh:829-830`),
so the reachable rates are 60, 120, 180, 240 orders/h. 150 would be 2.5/min.

| Option | Offered | Headroom under A's 200.6/h completed |
|---|---|---|
| `3`/min | 180/h | 10% |
| **`2`/min** | **120/h** | **40%** |

I chose **`2`/min = 120 orders/h**. 180/h leaves 10% headroom, which makes
drainage a coin flip - the precise thing the instruction warned against by
saying not to offer at the ceiling. 120/h over-delivers on "below the ceiling,
not at it" rather than under-delivering on it, and it is robust to arm B's
result in both directions: if the fix raised the ceiling, the headroom is
wider still; if it did not, 40% is ample.

#### 7.2.1 SUBSTITUTION: the rate was raised to 600 orders/h before the window opened

**The design above is left standing rather than rewritten, because a changed
design has to be legible as changed.** What follows replaced it, and why.

The 120/h figure was sized against a **200.6/h** ceiling - the only one that
existed when § 7.2 was written. Arm B then measured per-order service time at
6.014 s (§ 2.1), which puts the slot-arithmetic ceiling at **~1 197/h**. The
brief's own rule - below the ceiling with real headroom, around 25% - resolves
against *that* number to roughly 900/h, so 120/h is no longer 40% headroom, it
is **10% utilisation**.

Three reasons the substitution was accepted:

1. At 10% utilisation the window would measure service time **at almost no
   contention**, which is the one condition the campaign already has plenty of
   data for. It would answer an easier question than the one asked.
2. **600/h is the harder test**, so a pass cannot be read as manufactured -
   which matters more here than usual, because this arm exists to produce the
   campaign's first `VALID` order-path figure and will be read sceptically.
3. It is **the owner's own question** (500-600/h at peak) rather than a proxy
   for it, so one window answers the convergence question and the capacity
   question together.

`MIXED_ORDERS_PER_MIN=10` = **600 orders/h**, 50% of the measured-service-time
ceiling. Everything else in § 7.2 is unchanged, including no fault and the
prime defaulting to the offered rate. **C1, C2 and C3 are unchanged** - they
are rate-independent by construction, which is why raising the rate does not
touch them.

`MIXED_PRIME_ORDERS` defaults to the offered rate, so the stub is primed with
**2** orders rather than 60 - no artificial starting backlog, which matters for
a convergence test.

### 7.3 Acceptance criteria, pre-registered

Two criteria at two grains, both declared now so neither can be selected after
the fact.

**C1 - PRIMARY, aggregate convergence.** `drivers/queue-curve.awk`'s
last-third verdict over `g_queued_due` must be `plateau` or `converging`.
`growing` is a **reject**. The awk decides on the last-third least-squares
slope against a noise band of the tail's own standard deviation, so `plateau`
means the slope is not distinguishable from jitter - which is the correct
reading of "statistically indistinguishable from zero".

**C2 - PRIMARY, depth.** `g_queued_due` at the last sample must be **no
greater than** at the first sample.

**C3 - the order path on its own, un-confounded.** `ord_sync_queued` at close
no greater than at open, and `ord_sync_succeeded` over the window at least
**95%** of orders offered.

**Reject means reject.** If C1 comes back `growing`, arm C did not converge and
that is what gets reported. I will not re-run at a lower rate to manufacture a
pass, and I will not move a criterion after reading it.

### 7.4 Two things I expect to go wrong, named in advance

**(a) The aggregate queue may fail to converge for reasons that have nothing
to do with orders.** `g_queued_due` is install-wide across every job type. At
arm A's close, ~1 090 of ~12 800 queued rows were **not** order-sync:
`marketplace.offerQuantity.update` 504, `master.inventory.syncByExternalId`
366, `marketplace.offerQuantity.reconcile` 180,
`marketplace.offer.updateFields` 41. Those come from the catalogue and
inventory sweeps, whose enqueue rate is set by their crons and is
**independent of the offered order rate**. Arm A's own numbers show
`master.inventory.syncByExternalId` enqueuing ~217/h and draining ~95/h by
itself.

So C1 may fail while the order path is perfectly healthy. If that happens I
will decompose the residue by job type, report which types carry it, and treat
a non-order residue as **a separate finding about the sweeps** - not as a
failure of the order path, and **not** as grounds to retro-fit C1 to exclude
those types. C3 exists precisely so the order path gets a verdict that cannot
be confounded this way. Both criteria are reported whichever way each lands.

**(b) `post_guard_destination_creates` will very likely fire even on a
perfectly draining window, and that is a defect in the guard.** Its `failed`
arm carries **no destination filter at all**:

```sql
SELECT COUNT(*) FROM order_records
WHERE "createdAt" >= '$window_start_iso'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements("syncStatus") e
              WHERE e->>'status' = 'failed')
```

It counts an order with a failed entry on **any** destination, while the
guard's message calls it "the declared destination". The stand's five
connections include WooCommerce, which has no product mappings for the seeded
catalogue and therefore fails **every** order with
`No WC product mapping for OL product ...`. Arm A's § 7 shows the shape
exactly: **652 ingested, 649 with `syncedAt` on the declared destination, 650
carrying a failed entry.** Nearly every order both succeeded on the
destination under test and carried an unrelated second-destination failure.

So this guard reports non-drainage for a condition that is not non-drainage
and cannot be drained away, and it will do so at 600 orders/h just as at
3 600. **I will not disable the WooCommerce connection to make it pass** - that
would change a held variable and hide the defect. If it fires, it is reported
as a guard defect with this SQL as the evidence, in the same class as § 1.3.1's
two instrument failures: a guard that refuses a healthy window is worse than no
guard.

#### 7.4(b).1 Measured: the unfiltered arm does not merely over-report, it HIDES the finding

Four candidate definitions, run over arm A's own window
(`createdAt` in [05:54:21Z, 08:54:23Z), declared destination
`c4710417-…-prestashop`):

| Definition | Count |
|---|---|
| A) `failed`, unfiltered - **what the guard does today** | **650** |
| B) `failed`, scoped to the declared destination | **1** |
| C) `missing`, unfiltered - **what the guard does today** | **729** |
| D) `missing`, only where the destination was actually attempted | **1** |

The decomposition by source explains all four:

| source | ingested | `syncedAt` on declared dest | failed **on** dest | failed anywhere | `syncStatus` empty |
|---|---|---|---|---|---|
| `perf-webhook-ingress` | 726 | 0 | 0 | 0 | **726** |
| `perf-allegro-a` | 652 | 649 | **1** | **650** | 2 |

Two separate defects, and the first is worse than noise:

- **The `failed` arm buries the one order that mattered.** Scoped to the
  declared destination the count is **1** - and that one order is the
  genuinely stranded order arm A's § 3.4 spent a whole section on. The guard
  exists to surface exactly that, and it reported it as 650, indistinguishable
  from 649 unrelated WooCommerce mapping failures. **An unfiltered count did
  not just cry wolf; it hid the wolf.**
- **The `missing` arm counts orders the destination was never sent.** 726 of
  its 729 are `perf-webhook-ingress` orders with an **empty** `syncStatus` -
  never dispatched anywhere, and nothing to do with the destination under
  measurement. Only 3 belong to the measured source.

**Both are repairable with the destination id the guard already receives** -
definitions B and D need **no signature change**, which was the point of
measuring them.

#### 7.4(b).2 And the fix is deliberately NOT applied here

Repairing the SQL now would change what `verdict.txt` means **between arms
that are otherwise identical**. Parity across the three arms is the entire
reason the A/B comparison carries weight; a guard whose definition moved
mid-campaign costs more than the defect it repairs, because every earlier
`DISCARDED` would then be incomparable with every later one.

So: **the unfiltered `failed` arm remains a known, measured, unrepaired guard
defect**, recorded here with the numbers above and the SQL in § 7.4(b). The
fix belongs to a follow-up that **re-runs all three arms or none** - it is a
one-line predicate in `post_guard_destination_creates`
(`lib.sh:1282-1300`) plus the `missing` arm's attempted-only clause, and it
must land with fresh A/B/C windows rather than being retro-fitted to these.

Note this makes the guard's own docblock claim - that it is *"the only guard
that can see"* a swallowed per-destination failure - true only in principle
today: it can see one, and then reports it at a magnitude that makes it
invisible.

### 7.5 Results

TBD.

## 8. Two campaign figures this report must not repeat, and the one window that would fix them

### 8.1 If you need an F3 webhook number, cite the 300/s arm - not 600/s

An audit of **#2842** found that the published *"~600 requests per second"*
webhook ceiling rests on three runs **today's guard chain would discard**:
19.6% to 26.7% of iterations never dispatched, and k6 at 92-97% of its own VU
ceiling - i.e. the generator, not the system, was the thing at its limit.
Their `verdict.txt` files nonetheless still read `VALID`, and
`results-F3-2026-09-06.md` still calls that figure *"the ceiling"*.

The client-facing document has been corrected to **300/s, labelled "at
least"**. **This report cites no F3 figure other than that one**, and neither
should anything derived from it. The 600/s number is exactly the failure mode
§ 1.3.1 is about, one flow over: a guard that could not refuse, so three runs
passed and a number entered the product.

### 8.2 The next window: one run closes three issues

**#2842, #2931 and #2933 all block on the same single missing artefact:**

> one clean F3 sweep past **1 000 req/s** at a VU ceiling high enough that
> `post_guard_generator_saturated` stays quiet, plus a retro-note correcting
> the `VALID x3` row.

That is the highest-leverage measurement left in the campaign - three issues
per window - and it is **not** started here: the stand is held by arm C until
it closes, and starting it would forfeit the parity § 7.4(b).2 exists to
protect.

It also inherits the discipline this branch paid for: the VU ceiling has to be
raised **until the generator guard goes quiet**, and quiet has to be
demonstrated rather than assumed, because `post_guard_generator_saturated`
staying silent is only meaningful if it has been shown able to fire on the
same instrument. That is § 1.3.1's rule - verify a guard's output in **both**
directions - applied before the run rather than after it.

### 8.3 The third lever on the order path, and it is the only one unowned

The order path has three known levers. Two are accounted for:

1. **The intake Redis client** - measured here, 32.4 s to 6.0 s of per-order
   service time (§ 2.1). Shipped as #2984.
2. **The limiter's minimum-interval spacing** - known, owned, discussed in the
   limiter-A/B lineage.
3. **Four cacheable per-order requests** - worth about **3.1x** on the order
   path, per #2992 § 15, and **no child of #2840 currently writes that
   work.**

The third is named here rather than left where it currently lives, which is a
document about **hardware sizing**. Nobody working on order throughput will
look there, and a 3.1x lever with no issue against it is a lever that gets
re-discovered in six months instead of built.

It is also the lever that most changes the answer in § 4: the ceiling is
`2 slots x 3600 / service-seconds`, so anything that cuts service time again
multiplies the ceiling directly - the same arithmetic that turned #2984's
26 s saving into a ~5x throughput change. **This figure is pointed at, not
re-derived**: it is #2992's measurement, and this report neither reproduces
nor endorses the 3.1x beyond citing its source.

## 9. Reproducing it

TBD.
