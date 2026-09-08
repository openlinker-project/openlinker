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

## 2. What happened

TBD.

## 3. Findings

TBD.

## 4. The owner's question

TBD.

## 5. Verdict, post-guards, and whether any figure here is VALID

Figures: TBD.

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

TBD.

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
and cannot be drained away, and it will do so at 120 orders/h just as at
3 600. **I will not disable the WooCommerce connection to make it pass** - that
would change a held variable and hide the defect. If it fires, it is reported
as a guard defect with this SQL as the evidence, in the same class as § 1.3.1's
two instrument failures: a guard that refuses a healthy window is worse than no
guard.

### 7.5 Results

TBD.

## 8. Reproducing it

TBD.
