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

#### A note on the verifier itself, because it failed the wrong way first

On its first run against the fixed image the verifier printed
`VERDICT: FAILED` while every individual read-back was green. `grep -c` PRINTS
its count and EXITS 1 when that count is zero, so the defensive
`|| printf 0` fallback appended a second zero and the variable became
`"0\n0"`, which compares unequal to `"0"`. A less careful reading would have
concluded the image was wrong and rebuilt it.

Two other instances of the same family were hit while setting this run up and
are recorded here rather than quietly fixed. `exit=$?` after a
`... | tee file` reports **tee's** status, not the script's - so the first
failure looked like a pass on the line below it. And three background waiters
built on `until ! pgrep -f 'docker build --target worker'` never terminated,
because each matched **its own sibling waiter's command line**: the api image
was never built at all while a poll reported `api build running? yes`. The
campaign's standing lesson is to prove a counting guard can fail before
trusting a zero; the same rule applies to a guard that reports a pass.

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

**What binds: a falsifiable prediction.** `marketplace.order.sync` is
registered on the **`realtime`** lane
(`handler-registration.service.ts:150-154`), whose caps this stand resolved to
`realtime=4/2` - total 4, **perScope 2**. Every order from one source
connection shares one scope, so at most two order-sync jobs run at once, and
the ceiling is

```
orders/h  =  2 slots  x  3600  /  mean-seconds-per-order
```

That already explains all three shipped figures: 216/h implies ~33.3 s per
order (the smoke run measured p50 29.8 s); the isolated A/B's 226/h implies
31.9 s and its 333/h implies 21.6 s - so the +47% is exactly what removing
~10 s of per-order latency buys at two slots. **Prediction: if the fix removes
the same ~10 s under mixed load, drain lands near 300-330/h with per-order
duration near 21-23 s.** If drain rises by less than the duration fell,
something in the mixed window adds latency the isolated A/B did not have. If
neither moves, the limiter degradation was not costing per-order latency here.
Concurrency is confirmed independently by Little's law -
`L = throughput/s x mean duration` - which must read ~2 in both arms if the
per-scope cap is the binding structure and the fix moved only the service time
inside it.

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

## 2. What happened

TBD.

## 3. Findings

TBD.

## 4. The owner's question

TBD.

## 5. Verdict and post-guards

TBD.

## 6. What this did not establish

TBD.

## 7. Reproducing it

TBD.
