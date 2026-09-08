# The F3 rate ladder that became an elimination study

> **Every time in this report carries an explicit `Z`.** A prior handover
> confused local time (UTC+2) with UTC and concluded a run had overrun by an
> hour when it had not.

**Branch**: `2842-2931-2933-f3-sweep`, stacked on **#2985** (`2840-mixed-load-fixed`).
The gate figure below includes #2985's commits, so a reviewer diffing against
`perf-programme-2840` will see extra ones.
**Gate**: `lib-test` **175 passed / 0 failed**, `drivers/prove-generator-guard.sh`
**11 / 0**, `pnpm check:invariants` **exit 0**.

## 0. What this run was for, and what it turned into

It was commissioned to close **#2842**, **#2931** and **#2933** with one F3
sweep past 1 000 req/s at a VU ceiling `post_guard_generator_saturated`
accepts.

**Two of the three are closed. The third turned into something else.** The
ladder's rate axis destroyed itself - every rung grew `webhook_deliveries`
under the next one - and then a latency collapse appeared that none of the
ladder's variables explain. What follows is therefore an **elimination study
with five hypotheses tested and no cause published**, which is a weaker
headline and a stronger document.

| Issue | Criterion | Status |
|---|---|---|
| **#2931** | 1 000/s run completes without OOM; report peak container memory | **ANSWERED** - § 3 |
| **#2842** | `rows/s` into `webhook_deliveries` | **ANSWERED** - § 4 |
| **#2842** | sustained arrival rate before p99 breaches 1 s | **partly** - § 5 |
| **#2933** | withdraw the three 1 000/s arms; state whether they would pass | **DONE** - § 2 |
| **#2931** | pool parsed once; memory does not scale with VU count | **NOT answered** - § 3.2 |

## 1. First, the guard was proved able to refuse

The sweep's value rests on `post_guard_generator_saturated`'s silence meaning
"the generator was healthy", so it was exercised **before** any window was
spent (`drivers/prove-generator-guard.sh`, 11 cases):

- **Refuses**: VU utilisation 95% (limit 90%); dropped 20% (limit 5%); both at
  once; a summary carrying no `vus`/`vus_max`; a summary file absent entirely.
- **Passes**: VU 50% at 0.0999% dropped, **and a fixture sitting exactly at
  both limits** - so it is not merely refusing everything, which is the
  failure mode that makes the exercise worth running.
- **Skips** the VU arm under `constant-vus`, by design.

This branch found **eight** instruments that were confidently wrong while
nothing errored (§ 7). A guard whose refusal has never been observed is not
evidence.

## 2. #2933 - the three 1 000/s arms are withdrawn, by the guard's own answer

`results-F3-2026-09-06.md` published them `VALID x3` with **"the ceiling"**;
`campaign-2026-09-06.md` published **~600/s** as measured. Both are withdrawn
in place - number visible, fault stated, replacement named.

The criterion asks whether they **would have passed**. That is answered by
running today's guard against their own recorded figures rather than by
opinion:

| Arm | `vus.max`/`vus_max.max` | VU utilisation | dropped |
|---|---|---|---|
| unique | 132 / 137 | **96.4%** | **19.6%** |
| replay-committed | 149 / 154 | **96.8%** | **24.1%** |
| replay-concurrent | 143 / 156 | **91.7%** | **26.7%** |

against limits of 90% and 5%. **All three refused, each breaching both arms
independently** - the guard returns only its first message, so each was
re-fed with a deliberately clean VU count to confirm the dropped arm fires
alone (`drivers/quote-guard-refusals.sh`). **No, twice over, per arm.**

The 50/s and 300/s rows are **not** withdrawn: at `vus` of 1 and 3 they are
nowhere near a generator limit.

### 2.1 And they could not have fixed themselves by raising `MAX_VUS`

`vus_max.max` is **not** the configured ceiling. Under `ramping-arrival-rate`
k6 grows the allocated pool lazily from `preAllocatedVUs`, and the guard
divides by the **grown** figure. Those arms ran `PRE_ALLOCATED_VUS=50` against
a default `MAX_VUS=300` and reported pools of 137/154/156 - a lazily grown
pool sits permanently near its own size, so raising the ceiling could not have
moved the ratio by a single point.

**The guard was never stubborn; the operator was reading the wrong
denominator.** The knob is `PRE_ALLOCATED_VUS`. This generalises past the
campaign: anyone reading `vus_max` as a configured maximum makes the same
mistake.

## 3. #2931 - memory

### 3.1 Criterion 1: ANSWERED

Rung 1 (1 000/s, pool 900) **completed; k6 was not OOM-killed.**

```
window 2026-09-08T16:51:49Z -> 17:05:53Z   n=175 samples
k6 container cgroup RSS   min 14.9 MiB   mean 821.4 MiB   PEAK 1 136.2 MiB
host MemAvailable during the window       7.51 - 9.17 GiB
```

Read from cgroup **anonymous** RSS inside the container, not `docker stats`
MemUsage - that figure includes page cache and cannot answer a memory
question. The F3 scenario samples no memory at all, hence
`drivers/k6-mem-sampler.sh`.

Derived: **1.26 MiB/VU** at 900 VUs. **Single-point derivation, and not
established as linear** - see § 7 for why the second point was lost.

### 3.2 Criterion 2: NOT answered

"Memory does not scale with VU count" needs at least two VU counts. Rung 2's
memory series was **destroyed by my own filename collision** (§ 7.8), so the
figure rests on one rung. The 1.26 MiB/VU number should not be extrapolated:
the campaign's own earlier measurement (5 VUs -> ~517 MB, 150 VUs -> ~501 MB)
suggests the pool dominates at low VU counts and the per-VU cost only emerges
above that, which is a *different* shape from linear.

## 4. #2842 - `rows/s` was uncomputable, and the reason was two defects

The criterion could not be met from any existing artefact. A grep over the
whole `perf/` tree returned **one** hit for `webhookDeliveriesRowsAtStart` -
the setter - and **no reader anywhere**. `...RowsAtEnd` did not exist.

The second defect was not previously noticed: **the start count was read once
before any arm and reused by all three**, so arms 2 and 3 recorded a count
from before arm 1's ~18 000 inserts. It was already wrong as a per-arm figure,
independently of the missing end.

Both fixed, per arm, at the slot `manifest_set_sync_jobs_end` occupies
relative to `window_stop`. Measured:

| rung | rows at start | rows at end | delta | requests | rows/s |
|---|---|---|---|---|---|
| 1 | 78 464 | 213 718 | **+135 254** | 141 693 | **~805** |
| 2 | 222 224 | 357 826 | **+135 602** | 142 024 | **~807** |

**~805 rows/s**, `measured`.

### 4.1 An arm that could not fail

The fix proved itself immediately, on a short verification run:

```
unique             78 270 -> 78 335   = +65 rows
replay-committed   78 335 -> 78 335   = +0  rows
replay-concurrent  78 335 -> 78 340   = +5  rows   == REPLAY_CONCURRENT_DISTINCT_IDS
```

**`replay-committed` at +0 is the arm's entire thesis** - that a replay of
already-committed ids writes nothing - and it was **unobservable** until this
change. **An arm that cannot fail is the same defect as a guard that cannot
fire, one layer out.** The `+5` matching the distinct-ids knob exactly is the
corroboration that the counter measures what it claims.

## 5. #2842's second half - partly answered

p99 **did** breach 1 s: rung 1 measured **1 029 ms at a ~1 000/s plateau**.
But rung 1 was `DISCARDED` on VU utilisation (900/900), so that figure is not
guard-clean, and the criterion asks for the breach **at a ceiling the guard
accepts**. No rung achieved both.

One accounting correction worth keeping, because it nearly became a false
finding. Rung 1 looked like "the api saturated at 807/s". It did not:

```
k6's schedule intends  0.5x30x1000 + 120x1000 + 0.5x15x1000 = 142 500
rung 1 delivered       141 693 http_reqs + 806 dropped      = 142 499
```

k6 offered **exactly its schedule** and the api absorbed **99.4%**. "807/s" is
`http_reqs / window-including-ramps`, not a plateau rate. Reading a
ramp-averaged rate as a plateau rate would have produced a confident,
complete-looking, wrong conclusion about a generator ceiling.

## 6. The ladder, and five hypotheses eliminated

### 6.1 The data

| rung | rows @ start | p50 | p95 | p99 | concurrent | pool | dropped | rate | autovacuum | api age |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 78 464 | **77 ms** | 690 | 1 029 | 900 | 900 | 0.5% | 1000/s | on | ~10 h |
| 2 | 222 224 | **71 ms** | 1 415 | 2 635 | 1 640 | 1 782 | 0.33% | 1000/s | on | ~10 h |
| 3 | 366 209 | **1 875 ms** | 3 735 | 5 110 | 1 500 | 1 500 | 7.8% | 850/s | on | ~13 h |
| 4 | 485 112 | **3 251 ms** | 5 460 | 6 208 | 2 600 | 2 600 | 19.3% | 1000/s | **OFF** | ~13 h |
| 5 | **123** | **3 214 ms** | 5 447 | 5 659 | 2 600 | 2 600 | 17.6% | 1000/s | OFF | ~13 h |

All five `DISCARDED` on `post_guard_generator_saturated`.

### 6.2 What is eliminated, and by what

**The rate axis is unusable.** Every rung grew `webhook_deliveries` under the
next, so the rungs are not comparable on rate and a sixth at a new rate would
not repair the first five.

| Hypothesis | Eliminated by |
|---|---|
| **arrival rate** | rung 3 was **slower at 850/s** than rung 2 at 1 000/s |
| **VU pool / concurrency** | rung 2 ran **1 640 concurrent at 71 ms**; rung 3 ran **1 500 at 1 875 ms** |
| **autovacuum** | rung 4 disabled it on the table and p50 got **worse**, 1 875 -> 3 251 ms |
| **`webhook_deliveries` size** | rung 5: **485 112 -> 123 rows**, everything else held; p50 **3 251 -> 3 214 ms**, a **1.1%** move across a **3 944x** change |
| **`sync_jobs` size** | `syncJobsRowsAtStart` is **164 698** in the fast rung **and all three slow ones** - the scenario clears it between runs, so the other table in the gate transaction was the same size in both regimes |

That last row exists because "you truncated one table and concluded table size
is irrelevant" is the obvious objection, and it has an answer.

### 6.2.1 Rung 5 is a PARTIAL rung, and the harness said so itself

I restarted `lab-api` at **22:30:21Z** believing rung 5 had finished. It had
not. The arm-by-arm timing:

| rung 5 arm | verdict written | vs the restart |
|---|---|---|
| `unique` | 22:26:49Z | **3.5 min BEFORE** - clean |
| `replay-committed` | 22:31:00Z | **39 s AFTER** - spans it, contaminated |
| `replay-concurrent` | 22:35:11Z | entirely after; own baseline is the new container |

**The 3 214 ms that refutes the table hypothesis is the `unique` arm and is
clean.** § 6.2's elimination stands. No figure from the replay arms is cited
anywhere in this report - the replay numbers in § 2 are the 2026-09-06
historical arms, and those in § 4.1 are from a separate short verification run.

**And the contamination did not escape.** `post_guard_containers_stable`
(#2852) already compares every measured container's `.State.StartedAt` at
`window_stop` against the baseline `capture_container_starts` writes at
`window_start`. It fired, on the right arm, naming the container and both
timestamps:

```
DISCARDED post_guard_containers_stable: container(s) restarted or recreated
inside the measurement window - lab-api(was 2026-09-08T09:26:44.422284302Z
now 2026-09-08T22:30:21.337600688Z)
```

So the guard this ladder appeared to need **already exists and worked**, on
this very run, against the operator's own mistake. That is worth more than the
arm it cost: a mid-window restart is exactly the contamination a reader would
never think to check, because every other guard passes - and it is already
refused automatically.

`replay-concurrent` then completed *after* the restart, so its own baseline
recorded the new container and containers-stability correctly passed. It was
discarded for a different and louder reason - **a non-2xx ratio of 1.0
(108 859 of 108 859)**, i.e. every single request failed after the restart.
Two independent guards caught two independent consequences of one operator
error, which is the chain doing its job.

### 6.3 A plausible threshold mechanism, named but not supported

`uq_webhook_deliveries_event_key` is **64 MB** inside **110 MB** of indexes
against `shared_buffers = 128 MB`, with the heap at 271 MB. That is how a
*cliff* is possible where a smooth curve is not - a working set crossing
`shared_buffers`. It is recorded because it explains the shape, **and it is
refuted as the cause by rung 5.**

### 6.4 Two objections raised and withdrawn, one each

**Mine, withdrawn.** I argued a cliff between 358 k and 366 k rows was too
tight for a size effect, because rung 2 *passed through* 358 k at 71 ms. That
was wrong arithmetic: **rung 2's median row-count was ~290 k**, not 358 k, and
p50 is the median over the window. A threshold between ~290 k and ~366 k is
entirely consistent with rung 2 reading 71 ms.

**The lead's, withdrawn.** *"Demand chases provisioning, so it may not
converge by adding VUs."* Utilisation moved **100.0% -> 92.0%** - **toward**
the 90% limit, not away. Two points trending toward a threshold are evidence
of approach, not divergence; a rising absolute VU count was read as a rising
ratio. An inference the lead offered and the data refuted belongs in the
record exactly as much as one of mine.

### 6.4 The mixed-load A/B is NOT confounded by container age - checked, not argued

`results-mixed-load-fixed-2026-09-08.md` reports a 32 404 -> 6 344 ms service
time and a **5.11x**, and arm B ran on images rebuilt for it - which raises the
obvious question of whether arm A was measured on a worn `lab-api` and part of
that 5.11x is wear. **It is not**, and `.container-starts` settles it from
committed artefacts:

| container | arm A | arm B |
|---|---|---|
| `lab-api` | started 05:45:25Z, window opened 05:54:21Z -> **8.9 min old** | started 09:26:44Z, window 09:29:28Z -> **2.7 min old** |
| `lab-worker-1` | **72 s** old | **69 s** old |
| `lab-postgres` | 2026-09-06T22:31:30 | **identical** |
| `lab-redis` | 2026-09-08T03:16:23 | **identical** |
| `lab-prestashop` | 2026-09-08T00:50:22 | **identical** |
| `lab-woocommerce` | 2026-09-06T22:31:42 | **identical** |

Both arms ran on a **freshly recreated** api and worker - arm A's own report
records finding `lab-api` `Exited (1)` and recreating it - and every other
container was the **same age in both**. So there is **no wear term to
quantify**: the 5.11x is untouched, and any reader can verify it from the two
run directories.

### 6.5 A sizing heuristic of mine, dead - and this is the transferable part

`PRE_ALLOCATED_VUS >= rate x p99 / 0.9` **does not work.**

| rung | predicted from p99 | measured `vus.max` |
|---|---|---|
| 1 | 1 029 | 900 (capped) |
| 2 | 2 635 | 1 640 |

Wrong in **both** directions. Little's law on the mean gives 177 and 345
against those same peaks - about **5x low**. So **`vus.max` is a transient
peak and no percentile predicts it.** Anyone sizing a k6 pool from a latency
percentile will be wrong in both directions, and this flow has now
demonstrated it twice.

### 6.6 § 6.1 of the mixed-load report - half closed

`results-mixed-load-fixed-2026-09-08.md` § 6.1 records that **no arm performs
a ramp to refusal**. This ladder closes the **concurrency half**: rungs 1 and
2 sit at one rate with different provisioning, and the tail's response to
provisioning is what a refusal curve is made of. It does **not** close the
**rate half**, and now cannot from this data, because every rung shifted the
table under itself. The missing axis is named rather than claimed.

### 6.7 Why rung 3's design was wrong, stated because it is instructive

Rung 3 was provisioned at pool 1 500 - **below the 1 640 peak rung 2 had
already measured at a higher rate.** Lowering the offered rate does not lower
peak VU demand below an already-observed figure, and § 6.5 says why: the peak
is a transient no percentile predicts, so it cannot be scaled down from the
rate either. Rung 3 was therefore pool-starved *and* ran against a 4.7x table.
Three variables moved at once, and its p50 of 1 875 ms at a **lower** rate
than rung 2's 71 ms is what exposed the ladder as confounded.

Rungs 4-6 were provisioned deliberately clear of the observed peak **so that
if the guard still fired it would be the system's tail talking, not the pool.**
A reader who does not know that was deliberate will misread a `DISCARDED` at
generous provisioning as another under-provisioned rung.

## 7. Eight instruments that were confidently wrong while nothing errored

This is the branch's most reproducible finding and the count is the point.

| # | Instrument | Mechanism | Consequence |
|---|---|---|---|
| 1 | build waiter | `pgrep -f 'docker build …'` matched **its own command line** | wait never ended; **no api image built for 10 min** while a check reported one running |
| 2 | `exit=$?` after `\| tee` | reports **tee's** status | printed `exit=0` directly beneath a real failure |
| 3 | verifier's `grep -c` | prints its count and **exits 1 when that count is 0**, so `\|\| printf 0` fired *on success* | reported a **correct image as FAILED** |
| 4 | arm A's RSS sampler | stopped on `ps aux \| grep '[s]ustained-mixed-load'` - the scenario's own name | sampled through teardown; a slope fitted **across a container boundary** |
| 5 | a process count | `sustained-mixed-load` matched stale waiters | concluded arm C had launched when it **had not** |
| 6 | `pkill -f "$P"` | matched **the shell doing the killing** | exited 144 having killed itself; samplers survived |
| 7 | `k6-mem-sampler.sh` | identified its subject by **presence**, not by the window | ran **2 h 35 m** past a 14-min window; 2 884 blank rows against 175 real |
| 8 | this ladder's per-rung tag | `r${rate}` collides whenever two rungs share a rate | **read the wrong run's log**; destroyed rung 2's memory CSV |

**#8 is the most instructive, and not because it is the worst.** Its mechanism
is *identical* to `write_dated_report`'s dated filename - N invocations, one
filename, N-1 destroyed artefacts - **which I had documented hours earlier in
this same report.** Knowing the mechanism, having just written it down, and
then rebuilding it is the strongest evidence this campaign has produced that
**the rule has to be enforced by a tool rather than remembered.** The fix is a
tag carrying something unique per **invocation**, never per parameter value;
applied as `r${rate}-$(date +%s)`.

**The generalisation, from all eight:** a guard's or probe's output must be
verified in **both** directions. The campaign's standing lesson covers a check
that cannot report a FAILURE; #1, #5, #6 and #8 are checks that cannot stop
reporting a PASS, and #4 is a *calculation* that cannot report "I have no
data". A false pass sends someone to rebuild what was already correct; a false
fail hides a real defect. Both are silent.

### 7.0 The nine instances are TWO mechanisms, and the sentence that covers both

Listing nine cases invites the reader to memorise nine cases. They are two:

- **A probe that cannot identify its own subject** (#1, #4, #5, #6, #7, #8) -
  it matches its own command line, its own name, its own log, or a container's
  mere presence.
- **A probe that reads a proxy when an authority exists** (#2, #3, and the
  ninth below) - `tee`'s exit status instead of the command's, `grep -c`'s
  exit code instead of its printed count, a file's existence instead of the
  lock.

**Both are the same underlying error: trusting a signal that is CORRELATED
with the fact rather than CONSTITUTIVE of it.** That formulation covers cases
neither list enumerates, which is why it belongs in `docs/lessons.md` rather
than a ninth row.

**The ninth instance, stated precisely.** I concluded the stand was free by
reading a results file, when the authoritative answer was the Redis lock -
and `guard_stand_exclusive` then told me the truth and refused the rung. The
system worked; the operator consulted the proxy.

### 7.1 Container age: one recommendation, not two

An earlier draft of this report proposed building a post-guard that captures
`.container-starts` again at `window_stop` and discards on a change. **That
guard already exists** - `post_guard_containers_stable`, #2852 - it is wired
into `run_post_guards`, and § 6.2.1 shows it firing correctly on this run. It
should not be rebuilt.

What is genuinely missing is **interpretability, not correctness**: the
`.container-starts` data never reaches `manifest.json` or any report, which is
why this ladder was uninterpretable on the container-age axis for hours even
though the answer was on disk the whole time. The remedy is therefore to
**promote an existing artefact into the manifest**, not to add instrumentation
- one line per measured container in `manifest_write`.

That the data was already being captured is also what let § 6.4 settle the
mixed-load A/B question definitively rather than by argument.

### 7.2 A harness defect, recorded not fixed

`write_dated_report` writes `results-F3-<UTC date>.md`, and a ladder is N
invocations, so **rung N-1's report is destroyed by rung N with nothing
warning.** Each rung was copied aside instead of changing the writer
mid-ladder: a report writer whose behaviour changed between rungs would make
the rungs incomparable, which is the one property a ladder must have. No issue
opened, pending approval.

## 8. What must NOT be published from this

- **No cause for the latency collapse.** Five hypotheses, five eliminations.
  Three people proposed causes and were refuted.
- **F3's 3.4 ms keeps its number and gains no qualifier yet.** It was measured
  at ~3 concurrent VUs and ~20 000 rows. A "first weeks on an unretained
  table" qualifier was drafted and **would have been wrong** - rung 5 refutes
  it - in a way no reader could have caught. A wrong qualifier is worse than a
  missing one.
- **1 197 orders/h-style slot arithmetic has no analogue here.** No rate in
  this ladder is a validated ceiling.

## 9. Reproducing it

```bash
export PS_CONTAINER=lab-prestashop PG_CONTAINER=lab-postgres \
       REDIS_CONTAINER=lab-redis OL_API_CONTAINER=lab-api \
       OL_API_URL=http://127.0.0.1:19000 OL_ADMIN_USER=admin OL_ADMIN_PASSWORD=admin
export WEBHOOK_CONNECTION_ID=<the OrderSource-only webhook connection>
unset WORKER_CONTAINERS

bash perf/openlinker-throughput/drivers/prove-generator-guard.sh   # 11/0, both directions
bash perf/openlinker-throughput/drivers/quote-guard-refusals.sh    # the #2933 answer
bash perf/openlinker-throughput/drivers/f3-rate-ladder.sh          # edit the rung() calls
```

`drivers/k6-mem-sampler.sh` is started and stopped **by the ladder, by PID**.
`MAX_SECS` is only a backstop.
