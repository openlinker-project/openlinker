# Clean-window retest - what a quiet machine changes, and what the shop does at 10x

**Runs**: `results/limiter-ab/run1788799772` (arm A x3 + drift, arm BD x3),
`run1788804277` (arm BD x2 with the shop-latency probe overlapping),
`run1788805258` (arms D3 and BD3 x2 each, **3 worker replicas**), and
`results/f5-read-path/1M`. Plus a standalone latency ramp under
`/tmp/latency-ramp`. **Seventeen measurement windows**, all on 2026-09-07.
**Image** `8c1c0bbe7ee52cf8683cf2a888c926457626ef7a` throughout, `guard_build ok`
on every run, product paths identical to the branch tip - nothing was rebuilt
mid-campaign.
**Scenarios**: `scenarios/limiter-ab.sh`, `scenarios/f5-read-path.sh` (#2840).

---

## 0. The answers, in one page

| Question | Answer | Label |
|---|---|---|
| **Was the window clean?** | Yes - load p50 **0.56** on 28 cores, no peer holding the lock, no container recreated inside a window. The cleanest the campaign has had. | measured |
| **Which arms reached `VALID`?** | **One did: F5** (`non2xx=0`). **No throughput window did**, and the reason is now a single missing bound in a post-guard rather than anything about OpenLinker (§ 2.2). | measured |
| **Arm A** | 212, 211, 199 (drift 222) - mean **207.3**, degradation 40-49 lines every window | measured |
| **Arm BD** | 2 244, 2 235, 2 221 - mean **2 233.3**, **zero** degradation in all three, spread 1.0% | measured |
| **A -> BD** | **10.8x** | derived |
| **Does the shop survive 10x?** | **Yes, with room.** At arm BD's real 6.4 req/s the shop is indistinguishable from idle (p50 10.5, p90 13.5, p99 19.2 ms, 300/300 samples ok). | measured |
| **How far may the limit go?** | Free to ~6.5 req/s; the tail starts moving at 10 req/s; **do not exceed ~16 req/s** (p99 215 ms). 600 req/min is supportable **on this shop**. | measured |
| **Does scaling breach the shop's limit?** | **No - and the prior campaign's breach was the defect.** 3 replicas at a 60/min limit push **54.5-55.1 req/min**, under the limit, where the shared-client run measured 158. | measured |
| **What does scaling buy?** | **1.50x** (2 233 -> 3 356 orders/h at 600 req/min), sublinear because the shared pace bucket goes from 63% to 94% used. | measured |
| **What else raises throughput?** | Ranked in § 6. The largest is flipping one default. The most under-appreciated is that **7.72 of 11.34 requests per order are avoidable**, worth ~3.1x at the *shipped* limit **without asking the shop for anything more**. | measured counts, derived gain |

> **Was the window clean?** Answered in § 1, because it is this run's whole
> point. Every figure is labelled **measured**, **derived** (arithmetic over
> measured inputs) or **guess**. § 9 "What this did not establish" is not
> optional reading.

---

## 1. Was the window clean?

**Yes - by every axis this campaign has a measurement for, and it is the
cleanest window the campaign has had.** All **measured**.

| Axis | Evidence |
|---|---|
| Host load | 1-min load sampled every 30 s throughout. Across the 13 **throughput** windows (16:53-19:00, n=228): min 0.01, p50 **0.61**, p90 1.25, **max 2.95** - on a **28-core** host, so p50 is ~2% of capacity and even the peak is ~11%. The load that is there is the run's own. |
| Host load during F5 | Reported separately and **not** as contention: p50 5.77, max 8.82 (n=10, 19:00+). That is F5's own k6 generator, which is a load test by construction - and k6 used 3 of its 25 VUs, so it was not itself constrained. |
| Stand lock | Free before the first run (`GET perf:stand:exclusive` -> nil, TTL -2). Held by this scenario alone throughout; no other holder appeared. |
| Peer scenarios | None. No peer took the lock, and no peer process was running. |
| Peer containers | The `ol-demo-fresh-*` stack (9 containers) **is running but idle**: `ol-demo-fresh-redis` 1.52%, `-worker` 0.72%, every other container 0.00-0.21%. Disclosed rather than claimed absent - it exists and contributes a fraction of one core, and it generates no work. |
| Stand idle before starting | PrestaShop's access log had no OpenLinker traffic for ~2 h before the first window. `sync_jobs` held zero `queued` and zero `running` rows. |
| Container stability | `post_guard_containers_stable` answered `ok` on every window - no container was restarted or recreated inside a measurement window. |
| Build | `guard_build ok` on every run: image `8c1c0bbe7ee52cf8683cf2a888c926457626ef7a`, product trees (`apps/api apps/worker libs Dockerfile package.json pnpm-lock.yaml pnpm-workspace.yaml`) **identical** to the branch tip, so nothing was rebuilt and no window ran against code that is not in the tree. |
| PrestaShop headroom | Mean 1.29% CPU, max 12.95%, with no CPU or memory limit on the container. The shop was nowhere near its own ceiling during the throughput arms. |

**No contention was observed at any point.** That is the precondition this run
existed to satisfy, and § 2 is therefore about the system rather than about the
machine.

---

## 2. Priority 1 - the headline arms, and which verdicts a clean machine can reach

### 2.1 Every window, all measured

`req/order` comes from PrestaShop's own access log. `max running` is an
**upper bound** - `sync_jobs.status` over-reads, because a handler that
finished before its terminal write committed still reads `running`.
`intake client` is read from the **worker's own log line**, never `printenv`:
`printenv` proves the request reached the container, and only the log line
proves the code took the branch.

| Arm | Window | Orders | Orders/h | req/order | max running | degraded lines | intake client | Verdict |
|---|---|---:|---:|---:|---:|---:|---|---|
| A | r1 | 18 | 212 | 11.39 | 3 | **45** | SHARED | DISCARDED |
| A | r2 | 18 | 211 | 11.22 | 3 | **40** | SHARED | DISCARDED |
| A | r3 | 18 | 199 | 11.71 | 3 | **41** | SHARED | DISCARDED |
| BD | r1 | 192 | **2 244** | 10.14 | 2 | **0** | DEDICATED | DISCARDED |
| BD | r2 | 190 | **2 235** | 10.16 | 3 | **0** | DEDICATED | DISCARDED |
| BD | r3 | 190 | **2 221** | 10.16 | 3 | **0** | DEDICATED | DISCARDED |
| A | drift | 19 | 222 | 10.84 | 3 | **49** | SHARED | DISCARDED |

Every arm A row's discard reason includes the degradation; **no arm BD row's
mentions it at all** - all three carry the identical single reason, `0 order(s)
carry a failed syncStatus entry, 1 lack syncedAt`, i.e. the in-flight guard of
§ 2.2 firing on exactly one order out of ~190, three times running.

Per arm (**derived** from the rows above):

| Arm | n | orders/h per run | mean | spread | vs A |
|---|---:|---|---:|---:|---:|
| A (shipped, shared client) | 3 | 212, 211, 199 | **207.3** | 13 (6.3%) | - |
| BD (600 req/min, dedicated) | 3 | 2 244, 2 235, 2 221 | **2 233.3** | 23 (**1.0%**) | **+977% (10.8x)** |
| A drift control, run last | 1 | 222 | 222 | - | +7.1% |

**The drift control holds, in the reassuring direction.** Arm A repeated after
all three BD windows and two worker recreates measured **222 orders/h** - above
the 199-212 band its own earlier repeats set - so the stand did not degrade
underneath the run, and arm BD's 10.8x is the change under test rather than the
clock. Its degradation returned to 49 lines the moment the client went back to
SHARED, which is the same variable moving back.

### 2.1b The fix also removes most of the VARIANCE, which is a separate finding

Arm A's three repeats spread **6.3%**; arm BD's spread **1.0%** - measured, and
the prior campaign saw the same asymmetry (A 5.7%, BD 2.1%). At 18-19 orders a
window a single order is 5.4% of arm A's rate, so part of that is resolution -
but arm BD counts ~190 orders per window, where one order is 0.5%, and it lands
inside 1.0% three times.

So the degradation was not only costing throughput, it was **most of the
run-to-run noise**. That matters operationally beyond this campaign: it is why
arm A needs `n >= 3` and interleaving to say anything, and why a single-window
comparison on the shipped build could report a 6% "gain" for whichever window
drew the extra order.

### 2.2 The answer on verdicts: one blocker is gone, and exactly one is left - and it is the instrument

**Arm A cannot reach `VALID`, and should not.** Its discard reason is the
degradation itself - 45, 40 and 41 lines - which is the defect under test.
A run that scored arm A `VALID` would be hiding it.

**Arm BD's degradation is gone: zero lines, in every window.** Measured, by a
guard proved able to fail before the run started (§ 8) and read at window close
from the container that ran the window (§ 8's recreate caveat). That reproduces
the prior campaign's result on a quiet machine.

**And that leaves exactly one reason standing, which is not a fact about
OpenLinker at all:**

> `DISCARDED post_guard_destination_creates: 0 order(s) carry a failed
> syncStatus entry, **1** lack syncedAt on the declared destination`

One order. Out of ~187. The guard counts orders created since `window_start`
that have no `syncedAt` on the destination, and it has **no in-flight
allowance and no upper time bound at all** (`lib.sh`,
`post_guard_destination_creates`) - so on a window whose entire purpose is to
end with work in flight, it fires on the work that is in flight. The A/B
document already named the fix: *"either a bound at `window_stop -
max_expected_duration` or an explicit 'in-flight is expected' input"*.

Two pieces of evidence that this is structural rather than a health signal:

* **it tracks concurrency, not health - and this run demonstrates that within
  itself.** Across all thirteen windows the count moves with `maxRunning` and
  with nothing else:

  | Configuration | max running | orders lacking `syncedAt` |
  |---|---:|---:|
  | arm A / BD, 1 replica | 2-3 | **1** (or 0 - A r1 and A r3 passed) |
  | arm D3 / BD3, **3 replicas** | 6-7 | **5-6** |
  | prior campaign's arm ED, 17-way | 17 | 16-17 |

  Three replicas triple the in-flight work and the count triples with it, while
  throughput between those rows varies twelvefold (281 to 3 368 orders/h). And
  `0 order(s) carry a failed syncStatus entry` in **every window of this run** -
  nothing actually failed anywhere.
* **arm A r1 and r3 PASSED it** while r2 fired on 2 orders, at identical
  configuration. A guard whose verdict flips between repeats of the same arm on
  a 1-2 order margin is measuring where the window boundary happened to fall.

**So the honest headline is not "still discarded".** It is that this campaign's
two blockers were the limiter and the machine, the limiter fix removes one and a
quiet machine removes the other, and what remains is **a bound missing from a
post-guard**. Adding it is the single change that would let this campaign
produce a `VALID` saturation window.

**And the guard chain is not broken in general - it produced a `VALID` verdict
in this very run.** F5 (§ 5.2) scored `status=VALID, non2xx=0`, on the same
harness, the same day, the same stand. The difference is that F5's window is
not a saturation window: it ends when the load generator stops, with nothing in
flight. Every other post-guard - `post_guard_attempts`, `post_guard_deferrals`,
`post_guard_requeues`, `post_guard_containers_stable`, `post_guard_feed_starved`
and, on the BD arms, `post_guard_limiter_degraded` - answered `ok` on all
thirteen throughput windows.

**This run deliberately did not add it.** Changing the scoring rule inside the
same run that reports the scores is how a campaign stops being believable, so
the guard is untouched, every verdict below is the harness's own, and the fix
is filed as the immediate next step rather than applied here.

### 2.3 A quiet machine did NOT make arm A faster, and that confirms the mechanism

Comparing like with like - every arm A window including each run's drift
control:

| | orders/h per window | mean | spread |
|---|---|---:|---:|
| Arm A, this run (quiet machine) | 212, 211, 199, 222 | **211.0** | 23 (10.9%) |
| Arm A, prior campaign (contended) | 218, 231, 230 | 226.3 | 13 (5.7%) |

**Measured.** The quiet machine is about **7% slower**, not faster.

That is worth stating plainly because the intuition runs the other way, and
because it is evidence about the cause. If arm A's ceiling were machine
contention, the cleanest window the campaign has had should have raised it. It
did not - so the ceiling is not the machine. It is the degradation: a pace
`EVAL` queued behind `JobIntakeConsumer`'s 5 s blocking read waits on **Redis
head-of-line ordering**, which a quiet host does nothing to relieve. The
per-window degradation counts (45, 40, 41) sit squarely inside the prior
campaign's 34-58 band, on a machine doing nothing else.

The 8% is not attributed. Requests-per-order was slightly higher here (11.39,
11.22, 11.71 against 11.28, 11.16, 10.95), which accounts for part of it
arithmetically, and the rest is run-to-run variation in how much of its own
60 req/min allowance the degraded limiter manages to spend - 40.0 req/min in
the first window here against 41-43 there. **Both runs' arm A figures should be
read as "about 200-230 orders/h, limited by a stall", not as two different
numbers.**

---

## 3. Priority 2 - does the shop survive 10x?

### 3.1 Why this had to be measured before recommending a raise

The 60 req/min default is not a documented PrestaShop quota. Its own manifest
entry says so - `libs/integrations/prestashop/src/prestashop-plugin.ts:80-84`,
quoted in full (dashes normalised):

> Conservative resolution-time fallback for a connection with no explicit
> config.rateLimit (#1810/#1772) - a shared-hosting PrestaShop VPS is the
> platform this issue's reporter hit an abuse block on. **Placeholder values
> pending the reporter's actual abuse-notice text** (see #1810's own open
> question); never written into stored config.

So somebody hit a real abuse block on shared hosting, a provisional number was
written, and the details that would have justified it never arrived. The
concern may have been real - which is precisely why "raise it 10x" cannot be
recommended off a throughput figure alone.

F1's 11-20 ms was measured at roughly **one request per second**. Arm BD
sustains **~6.4 per second**. Nobody had checked the shop at that rate.

### 3.2 Method - two measurements that cross-check each other

| | What it drives | What it answers |
|---|---|---|
| **During-window probe** | 0.5 req/s of probe **on top of** arm BD's own ~6.4 req/s | does the shop still answer quickly while OpenLinker really is pushing 10x? |
| **Standalone ramp** | probe alone, 0.5 -> 24 req/s, no window open | where does latency actually knee? i.e. how far *could* the limit go? |

The two overlap at ~6.4 req/s, so they cross-check: if the during-window
figure matches the ramp's 6.4 step, both instruments agree about the same
shop at the same rate, reached two different ways.

Both use `drivers/ps-latency-probe.mjs` - status-checked per sample (§ 8), GET-only,
weighted by F1's own measured per-order mix, with URL shapes copied from what
OpenLinker actually sent.

### 3.3 The curve

All **measured**. 60 s per step, 20 s settling between, one shared instrument.
`ok/total` counts samples that returned the status their endpoint expects; the
401s in the status mix are the `configurations` probe, which is *supposed* to
answer 401 (§ 8).

| offered req/s | achieved | ok/total | p50 | p90 | **p99** | **max** | status mix |
|---:|---:|---:|---:|---:|---:|---:|---|
| 0.5 | 0.52 | 30/30 | 10.5 | 13.5 | 49.6 | 49.6 | 27x200, 3x401 |
| 1 | 1.02 | 60/60 | 10.5 | 12.9 | 45.5 | 45.5 | 53x200, 7x401 |
| 2 | 2.02 | 120/120 | 10.3 | 12.8 | 14.8 | 49.4 | 105x200, 15x401 |
| 4 | 4.02 | 240/240 | 10.3 | 12.6 | 14.9 | 46.6 | 210x200, 30x401 |
| **6.4** (= arm BD's rate) | 6.42 | 384/384 | **10.2** | **12.6** | **16.2** | **66.9** | 336x200, 48x401 |
| 10 (= the 600/min limit) | 10.02 | 600/600 | 10.1 | 12.6 | **22.6** | **1 186** | 525x200, 75x401 |
| 16 | 16.01 | 960/960 | 9.9 | 12.5 | **215.4** | **3 025** | 859x200, 101x401 |
| 24 | 24.01 | 1440/1440 | 9.7 | 12.3 | **1 346.8** | **3 029** | 1279x200, 161x401 |
| 0.5 **drift, run last** | 0.52 | 30/30 | 10.6 | 14.1 | 47.3 | 47.3 | 27x200, 3x401 |

Five readings, in order of how much they matter:

**1. The median does not move at all.** p50 goes 10.5 -> 9.7 ms across a
**48-fold** increase in rate, and p90 12.9 -> 12.3. Both drift very slightly
*downwards*, which is warming, not improvement. F1's 11-20 ms holds at every
rate tested.

**2. The tail is where the rate shows up, and it knees between 6.4 and 10.**
p99 is flat at 14.8-16.2 ms up to 6.4 req/s, then 22.6 at 10, 215 at 16 and
1 347 at 24; the worst single sample goes from 67 ms to 1.2 s to 3.0 s. This is
queueing, not failure - see (3).

**3. Nothing failed, at any rate.** `ok/total` is **100% at every step**,
including 1440/1440 at 24 req/s. The shop did not shed load, did not 500, and
did not refuse - it queued. That distinction is only available because the
probe checks status per sample; the withdrawn ADR-066 figure came from an
instrument that could not have told these apart.

**4. The x-axis is real.** Achieved rate matched offered to within 0.4% at
every step, so no point on this curve is a rate the probe failed to deliver and
then mislabelled.

**5. The drift control holds.** 0.5 req/s repeated after the 24 req/s step
reads 10.6 / 14.1 / 47.3 against the opening 10.5 / 13.5 / 49.6. The ramp
measured rate, not cumulative damage, and the shop was not left degraded.

### 3.3b So: does the shop survive 10x? Yes - and here is the bound

**At the rate arm BD actually reaches, 10x is free.** Arm BD sustained 6.3-6.4
req/s, and at 6.4 the shop's p50/p90/p99 (10.2 / 12.6 / 16.2 ms) are
**indistinguishable from the idle baseline** (10.5 / 13.5 / 49.6 - the
baseline's p99 is in fact *worse*, on 30 samples). There is no shop-side cost
to the 10x arm on this stand.

**And the reason the raise is safe is not only the latency - it is that
OpenLinker cannot saturate it.** Arm BD used **378 of its 600 req/min (63%)**
because `OL_LANE_REALTIME_SCOPE_CAP=2` binds first (§ 6 row 7). So raising the
limit to 600 does not ask the shop for 10 req/s; it asks for ~6.3, which the
curve shows is free.

**The bound, stated as an operator would need it:**

| Rate | Verdict from this curve |
|---|---|
| up to ~6.5 req/s (~390 req/min) | **free** - tail indistinguishable from idle |
| ~10 req/s (600 req/min) | **tail begins to move** - p99 22.6 ms, one sample at 1.2 s. Reachable only if the lane cap is also raised |
| >= 16 req/s (~960 req/min) | **do not** - p99 215 ms, worst sample 3.0 s, and still climbing |

So `requestsPerMinute: 600` is supportable **on this shop**, and the honest
qualifier is that the headroom past it is thinner than the throughput figure
suggests: 600/min is already at the point where the tail starts to move, and it
is only comfortable because the lane cap stops OpenLinker from using all of it.
**Raising the lane cap and the rate limit together (§ 6 row 7) would move the
shop from 6.4 to 10 req/s, into the knee** - which is exactly why that pair
needs measuring rather than assuming.

Two limits on this curve, both stated rather than left to be inferred:

* **It is GET-only.** The create path's three POSTs and two module POSTs mint
  real rows, so they cannot be replayed. A write-heavy path would knee earlier,
  and a flat GET curve is necessary evidence, not sufficient.
* **It is one containerised shop on a 28-core host with no CPU limit**, at
  1.3% mean CPU during the throughput arms. The shared-hosting PrestaShop the
  60 req/min placeholder was written for is a different machine with
  neighbours, and **no number here licenses a raise on it** (§ 9).

### 3.4 The shop during a real arm BD window - the two instruments agree

The ramp drives the shop directly. This measurement rides **on top of arm BD's
own traffic**: 0.5 req/s of probe while OpenLinker sustained ~6.3 req/s of real
create-path work, for the full 300 s window. All **measured**.

| Measurement | offered | ok/total | p50 | p90 | p99 | max |
|---|---:|---:|---:|---:|---:|---:|
| Ramp, idle shop | 0.5 req/s | 30/30 | 10.5 | 13.5 | 49.6 | 49.6 |
| **During arm BD, window 1** (+ OL's ~6.3 req/s) | 0.5 req/s | **150/150** | **10.5** | **13.5** | **19.2** | **52.7** |
| **During arm BD, window 2** | 0.5 req/s | **150/150** | **10.7** | **13.7** | **19.0** | **54.7** |
| Ramp, probe alone at 6.4 req/s | 6.4 req/s | 384/384 | 10.2 | 12.6 | 16.2 | 66.9 |

Two independent windows, 300 samples, and they agree to within 0.2 ms at p50
and p90.

**The shop under real 10x OpenLinker load is indistinguishable from the shop
doing nothing.** p50 and p90 are identical to the idle baseline to the decimal;
the p99 is *better* (19.2 against 49.6, on 5x the samples), and the worst single
request in 150 was 52.7 ms.

**And the two instruments cross-check.** The during-window row sits between the
ramp's idle and 6.4 req/s rows on every percentile - which is what it should
do, because the shop was seeing OL's ~6.3 plus the probe's 0.5. Two different
methods, two different traffic sources, one answer about the same shop at the
same rate.

Per endpoint, during the window (p50 / p90 / max, ms):

| endpoint | n | p50 | p90 | max |
|---|---:|---:|---:|---:|
| `products_by_id` | 19 | 12.7 | 17.3 | 52.7 |
| `order_states` | 19 | 12.6 | 17.2 | 19.2 |
| `currencies` | 19 | 10.3 | 13.5 | 14.8 |
| `countries` | 19 | 10.1 | 12.2 | 14.1 |
| `carriers` | 19 | 10.4 | 12.6 | 12.9 |
| `orders_by_reference` | 19 | 10.1 | 13.2 | 14.3 |
| `stock_availables` | 18 | 10.3 | 11.5 | 12.8 |
| `configurations` (401) | 18 | 9.6 | 12.3 | 13.1 |

Nothing above 17.3 ms at p90 on any endpoint, and **150 of 150 samples returned
the status their endpoint expects** - so the shop was not quietly shedding any
part of this.

**What the probe cost the arm it rode on, measured rather than assumed.** Run
2's BD r1 reports `10.93` requests per order against run 1's `10.14-10.16`. The
difference is exactly the probe: 150 requests over 190 orders = **0.79 per
order**, and 10.14 + 0.79 = 10.93. The scenario does not subtract them;
`ps-request-mix.sh` does. Throughput was 2 214 orders/h against run 1's 2 233
mean - **0.9% lower, inside run 1's own 1.0% BD spread** - so the probe's load
did not meaningfully perturb the arm it measured.

---

## 4. Priority 3 - scaling with the fix

### 4.1 The prediction, written down before the run

Stated first so the result is read against a prediction rather than turned into
one afterwards. Both halves are **derived from source**, not guesses:

* **The limiter's bucket is shared across processes.** `RateLimitModule` builds
  a Redis-backed registry (`rate-limit.module.ts:70-78`) and passes **no**
  `replicas` argument, and the module's own header says the old static
  cap-division "is gone" because dividing an already-shared cap would only
  shrink the operator's configured rate. So N replicas are *designed* to share
  ONE per-connection bucket, and the fleet should never exceed
  `requestsPerMinute` however many replicas run.
* **The lane caps are not shared.** Slot accounting is in-process, so 3
  replicas give 3x the `realtime` slots with no lane change at all.

Which yields two predictions:

| Arm | Prediction | Why |
|---|---|---|
| **D3** (60 req/min, 3 replicas) | **destination rate stays at ~60 req/min** | the shared bucket is the binding constraint at 60/min, and 3x the slots cannot make it admit faster |
| **BD3** (600 req/min, 3 replicas) | destination rate **rises above** arm BD's ~378 req/min, and throughput rises with it | at 600/min the bucket is only ~63% used, so the binding constraint is slots, and there are now 3x as many |

**The figure to read on D3 is the destination request rate, not the
throughput.** This run has no 1-replica arm D to compare a throughput number
against (arm D was the prior campaign's, at 327-339 orders/h), so a
throughput figure alone would need a cross-run comparison. The destination rate
needs none: `requestsPerMinute` is 60, so **anything materially above 60
req/min is a breach of the operator's own configured limit, whatever the
throughput says.** That is a self-contained reading, which is why the safety
question is asked this way.

**And it predicts the prior campaign's breach disappears.** F7 measured 3
replicas pushing 158 req/min against a 60/min limit - impossible if the bucket
held. The available explanation is the degradation: a timed-out pace `EVAL`
drops that process to its **own** per-process in-memory limiter
(`redis-rate-limiter.adapter.ts:355-359`), so three degraded replicas become
three independent 60/min buckets. If that is right, arm D3 on the dedicated
client shows **no breach** - which would mean the 2.77x scaling figure that
reached an ADR was measuring the defect, not scaling.

### 4.2 Results - both predictions confirmed, and the ADR's scaling figure was measuring the defect

All **measured**. Three replicas, all three verified `DEDICATED` from their own
log lines (`lab-worker-1/2/3`). **`dest req/min` is the probe-corrected figure**
- the during-window probe was running, and its 150 requests would otherwise
have added 29 req/min, which on arm D3 would have read as a 40% breach that did
not happen.

| Arm | replicas | limit | orders/h | **dest req/min** | % of budget | max running | degraded |
|---|---:|---:|---:|---:|---:|---:|---:|
| BD (run 1) | 1 | 600 | 2 233 | 378 | 63% | 2-3 | 0 |
| **D3** r1 | 3 | **60** | 281 | **54.5** | 91% | 7 | 0 |
| **D3** r2 | 3 | **60** | 281 | **55.1** | 92% | 7 | 0 |
| **BD3** r1 | 3 | 600 | **3 344** | **564.5** | 94% | 7 | 0 |
| **BD3** r2 | 3 | 600 | **3 368** | **565.9** | 94% | 6 | 0 |

**Prediction 1 - the safety question - confirmed. There is no breach.** Three
replicas against a 60 req/min limit push **54.5 and 55.1 req/min**, i.e. *under*
the operator's configured limit, not over it. The prior campaign measured
**158 req/min** in the same configuration - 2.6x the limit - and the difference
is the one variable: that run was on the shared client, where a timed-out pace
`EVAL` drops each process to its **own** in-memory limiter and three replicas
become three independent buckets.

**So the 2.77x scaling figure that reached an ADR was measuring the defect.**
Not scaling: a fleet quietly ignoring the operator's rate limit. With the client
unshared, the Redis-backed bucket is genuinely shared and the fleet honours the
limit - which is what `rate-limit.module.ts`'s own header says the design
intends.

**Prediction 2 - the throughput question - confirmed, and the number is
1.5x.** At 600 req/min, where the bucket has headroom, three replicas take the
destination rate from 378 to **565 req/min (63% -> 94% of budget)** and
throughput from 2 233 to **3 356 orders/h**.

**Three replicas buy 1.50x, not 3x** - and the reason is visible in the same
row. At one replica the binding constraint is slots (63% of budget used); at
three it is the **pace gate** (94%). Scaling converts a slot-bound system into
a bucket-bound one and then stops, because the bucket is shared by design. The
remaining 6% is coordination cost - three processes contending on one Redis
bucket, the same effect that cost arm ED 12.5% in the prior campaign. Arm D3
shows it plainly: at the 60/min limit three replicas reach 54.5-55.1 req/min
where the prior campaign's *single* replica on a dedicated client reached
**60.0**.

### 4.3 What this means for a seasonal peak

**Measured**, and stated in the two directions an operator actually asks:

* **A 10x peak over the SHIPPED build clears comfortably.** The shipped
  configuration sustains ~207 orders/h (arm A); one replica with the client fix
  and a 600 req/min limit sustains **2 233**, and three replicas **3 356**.
  Anything up to ~10x of today's throughput is reachable **without touching the
  shop's request rate beyond 600/min**.
* **A 10x peak over the FIXED build does not.** 10x of 2 233 is ~22 000
  orders/h, which at ~10 requests per order needs ~3 700 req/min = 62 req/s -
  six times the highest rate the ramp tested, and four times past the point
  where the shop's tail was already bad (§ 3.3). That peak is not reachable by
  raising the limit; it is reachable, if at all, by the **denominator** work in
  § 6, which lowers requests per order rather than raising the shop's load.

**And the shop tolerated the scaled configuration.** The probe rode all four
run-3 windows: at BD3's **9.4 req/s** of real create-path traffic the shop
answered p50 10.8-12.6 ms, p90 14.2-16.5 ms, p99 21.2-22.8 ms, worst sample
60 ms, **150/150 samples with the expected status** in every window.

That is notably *better* than the ramp's synthetic 10 req/s step, which recorded
one 1 186 ms sample. The two are not in conflict and the difference is
instructive: the ramp fires from one process with up to 64 requests in flight,
while OpenLinker's traffic is **paced** - one admission per interval, serialised
per worker - so the shop sees a smooth arrival stream rather than a bursty one.
Both methods agree at p99 (22.6 synthetic against 22.8 real); they differ only
in the extreme tail, where the ramp's 1-in-600 outlier is simply not
characterised by 150 samples. **The operational reading is that the ramp's knee
is a worst-case bound and OpenLinker's real traffic sits on the gentler side of
it.**

---

## 5. Priority 4 - the remaining flows

### 5.1 F3 webhook burst - declined, and a quiet machine would not have helped

**Its low-rate arms are already `VALID`** (§ 7.2) - 43/s, p50 5.5 ms, zero
failures. What is discarded is the high-rate sweep, and **not** for the
limiter: `post_guard_generator_saturated` fired because k6 was pinned at
**400/400 VUs shedding 52-57% of its own requests**
(`results-F3-2026-09-06.md:157-161`). That is the load generator running out,
not the system under test.

So a clean machine is not the missing ingredient, and re-running the same
scenario on one would produce the same verdict for the same reason. Getting
past 1 000/s needs the *generator* raised - more pre-allocated VUs, or a
generator that is not sharing a kernel with the system it measures - which is a
scenario change and a separate piece of work. Declining it is the honest call
rather than spending a window to reconfirm a known instrument limit.

### 5.2 F5 read path - run, and it is this run's ONE `VALID` verdict

```
status=VALID
reason=non2xx=0 total_route_requests=1449
```

Run at the **1M** dataset step only (`F5_ONLY_SIZE=1000000 F5_ONLY_LABEL=1M`),
which is the size the stand already carries, so nothing was reseeded and no
smaller label was measured against a bigger table. 90 s window, 2 169 HTTP
requests at 24.4/s, **0 failures**, and k6 used **3 of its 25** VUs - so the
generator was nowhere near its limit and this is the system's number, not the
instrument's. All **measured**.

| Route | n | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| `orders_list` | 368 | 39.47 | 47.98 | 54.07 |
| **`orders_list_needs_attention`** | 148 | **148.85** | **170.40** | **813.09** |
| `order_detail` | 291 | 6.11 | 9.38 | 12.42 |
| `products_list` | 289 | 10.65 | 15.44 | 21.16 |
| `product_detail` | 222 | 6.59 | 9.23 | 10.04 |
| `sync_jobs_list` | 131 | 40.02 | 46.99 | 53.31 |
| `page_shell_total` | 144 | 59.50 | 71.85 | 88.14 |
| `page_shell_request` | 720 | 3.70 | 40.34 | 46.09 |

**One route stands out and it is the one the architecture already predicts.**
The `needs_attention` filter is **3.8x** the plain orders list at p50 (148.85
against 39.47) and **15x** at p99 (813 ms against 54). That filter is a jsonb
`syncStatus` containment predicate - exactly the shape
`architecture-overview.md` § 27 names as unable to use a plain index, and the
subject of the existing `decision-order-records-syncstatus-index-2026-09-06.md`.
This run is independent confirmation at 1M rows, on a `VALID` window: **an
operator filtering the orders list to "needs attention" waits about four times
as long as one who does not, and occasionally most of a second.**

That is a *read-path* finding and does not bear on § 6, which is about the
order-create path's outbound requests. It is recorded here because it was
measured cleanly and is actionable on its own.

### 5.3 F7 lane starvation - a genuine OMISSION, not a deferral

Not run, on time. And this is not a case of "out of scope": unlike F3, **F7's
discard reason WAS the limiter degradation**. It is therefore the one window in
the campaign that this fix could plausibly have turned `VALID`, and it did not
get the chance.

Stated plainly so it is not read as a tidy deferral: **the lane-starvation
question is still unanswered, the fix that would most likely have answered it
was in hand, and the reason it was not run is that the session ran out of
time.** It is the natural next window, alongside § 6 row 7's untested
lane-cap-plus-rate-limit pair - and note the two are related, since F7 is the
scenario that would show what a raised lane cap does to everything sharing the
worker.

---

## 6. What else would raise throughput

The operator's question. Ranked by expected gain, each labelled, each with the
mechanism named at `file:line` so it can be checked rather than taken.

**The arithmetic every row below shares.** The pace gate admits one request per
`60_000 / requestsPerMinute` ms per connection, so

```
orders/hour ceiling  =  requestsPerMinute / requests-per-order  x  60
```

That means there are exactly **two** ways to raise sustained throughput: raise
the numerator, or lower the denominator. Rows 1 and 7 are the numerator; rows
2-5 and 8 are the denominator. Anything that touches neither cannot help, which
is what disqualifies row 6.

**The two are not equivalent, and the asymmetry is the most useful thing in
this section.** Raising `requestsPerMinute` buys throughput by asking the
shop for *more requests per second* - which is exactly the risk § 3 exists to
bound, and which no measurement here can license for somebody else's hosting.
Lowering requests-per-order buys the same throughput while asking the shop for
*fewer requests per order*: at a fixed limit the shop's request rate is
unchanged, and per order it drops. **So there is no throughput-versus-shop-load
trade-off to make until the denominator work is done** - rows 2, 3, 5 and 8 are
free of the question § 3 has to answer for row 1 and row 7.

**Measured**, from PrestaShop's own access log across all three arm A windows
pooled - **53 completed orders, 601 paced requests** (204 + 199 + 198 over
18 + 18 + 17 orders):

| Row | Call | Total | Per order | Cached today? |
|---|---|---:|---:|---|
| 2 | `GET products` (tax chain, by id) | 60 | 1.13 | yes, 5 min TTL, **per-order instance** |
| 2 | `GET currencies` | 59 | 1.11 | yes, 24 h TTL, **per-order instance** |
| 2 | `GET countries` | 58 | 1.09 | yes, 24 h TTL, **per-order instance** |
| 2 | `GET order_states` | 57 | 1.08 | yes, no TTL, **per-adapter instance** |
| 3 | `GET carriers` | 59 | 1.11 | **no cache at all** |
| 5 | `POST /index.php` (`cartshipping`) | 59 | 1.11 | n/a (write) |
| 8 | `GET orders` (`filter[reference]`) | 57 | 1.08 | no |
| | **rows 2+3+5+8** | **409** | **7.72** | |
| | everything else (`carts`, `stock_availables`, `configurations`, `importorder`) | 192 | 3.62 | |
| | **total paced** | **601** | **11.34** | |

Removing all four rows would take the ceiling at the **shipped** 60 req/min
from **~317 to ~995 orders/h - about 3.1x, with the shop's request rate
untouched**. That total is **derived**: the counts are measured, the removals
are inferred from the existing TTLs, and two of the four (rows 5 and 8) need a
module or core-contract change rather than a local one. Rows 2 and 3 alone -
both local, both following a pattern already in the same file - are 5.53 of
11.34, worth **~1.95x** on their own.

Note what the middle column shows: **four of the seven are already cached, with
sensible TTLs, at the wrong lifetime.** This is not a missing-cache problem, it
is a cache whose instance is rebuilt per order, which is why the TTLs look
right and buy nothing.

**And the profile is not an artefact of the slow arm.** Arm BD's window - ten
times the request rate, 192 orders, 1 926 paced requests - has the identical
shape: `products`, `order_states`, `currencies`, `countries`, `carriers`,
`cartshipping` and `orders` all land at **exactly 192**, i.e. **1.00 per order
each, 7.00 of 10.03 (70%)**. Whatever is rebuilding those caches does it once
per order at either rate, so the denominator work pays off at both.

### 1. Flip `OL_JOB_INTAKE_DEDICATED_REDIS` to default on - **measured**

The single largest item, and it is already written. `JobIntakeConsumer` blocks
on `xReadGroup` with `BLOCK: 5000` on the worker's shared `'REDIS_CLIENT'`
(`apps/worker/src/sync/job-intake.consumer.ts`), and the outbound limiter's
registry is built on that same client
(`libs/plugin-sdk/src/rate-limit.module.ts:70`). Redis serves no further
commands from a connection parked in a blocking read, so a pace `EVAL` waits
out the residual - up to 5 s against the limiter's 1000 ms timeout - and past
it the limiter logs *"falling back to per-process in-memory limiting"* and
stops being what it was configured to be.

The remedy is not new code. `sync-worker.module.ts:149` already resolves a
dedicated client behind the flag, and `sync-worker.tokens.ts:11` documents the
seam; the change is the **default** - `configService.get('OL_JOB_INTAKE_DEDICATED_REDIS', 'false')`
becomes `'true'`. Cost: one extra Redis connection per worker process.

Three things checked before recommending it rather than assumed:

* the provider is production-shaped already - it connects, **throws** a named
  error if the connection fails rather than silently falling back to the shared
  client, and logs which branch it took on **both** paths;
* it resolves Redis from **exactly the same** config keys as the shared client
  (`REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB`, same defaults,
  `redis-config.module.ts:24-31`), and there is no `REDIS_URL` path anywhere,
  so a dedicated client cannot end up pointed at a different Redis than the
  shared one;
* it registers no shutdown hook, deliberately and per the
  `EventsConsumerModule` precedent - the connection is released when the
  process exits.

Two things it buys, and they are different sizes:

* at the shipped 60 req/min, the limiter stops losing about a third of its own
  allowance - it goes from spending 41-45 of 60 req/min to spending 60.0;
* and it makes `requestsPerMinute` **mean something**. The identical 60 -> 600
  change is worth nothing on the shared client and several-fold on the
  dedicated one, because the degradation was masking the whole effect of the
  setting.

### 2. Hoist the three per-order resolvers onto the factory - **derived**

`PrestashopAdapterFactory` holds eight resolvers as process-singleton fields
(`libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts:65-106`)
and then constructs three more **inside** `createAdapters` at `factory.ts:222-224`
- `PrestashopCountryResolver`, `PrestashopCurrencyResolver`, and a second
`PrestashopTaxRateResolver`. `createAdapters` runs per capability resolution,
i.e. once per order, so those three caches are born cold and die with the
order. Their configured TTLs are 24 h, 24 h and 5 min: the code describes a
lifetime it does not have. `PrestashopOrderStateCatalog` has the same problem
one level down - memoised with no TTL (`prestashop-order-state.catalog.ts:174`)
but constructed in the adapter's own constructor (`...order-processor-manager.adapter.ts:144`),
and the adapter is rebuilt on every resolution.

This is the same defect, and the same fix, that
`prestashop-plugin.ts:100-125` already records having applied to the *catalogue*
path - where hoisting the factory removed two requests per SKU. The eight
existing singleton fields are the established pattern; this is finishing it,
not inventing it.

Measured cost of the four calls in this run's arm A window (§ 2): `countries`,
`currencies`, `products` (the tax chain) and `order_states` at ~1.05 per order
each - **~4.2 of ~10.7 requests per order**.

Derived saving, if hoisting removes them as the 24 h TTLs imply: requests per
order ~10.7 -> ~6.5, so the ceiling at a **fixed** 60 req/min rises from ~336
to ~554 orders/h, about **1.65x, with no limit raised at all**. Labelled
derived because the request counts are measured but the removal is inferred
from the TTLs rather than observed.

### 3. Memoise `GET carriers` per connection - **derived**

`discoverDynamicCarrierId` (`...order-processor-manager.adapter.ts:1197`) is
called **unconditionally** at `:375` - its own comment there reads *"Discover
the OL Dynamic carrier id up front"* - and has **no cache of any kind**.
Measured at ~1.11 per order, about 10% of the budget. The row it reads is
created at module install and is near static.

Two constraints a naive fix would break, both visible at the call site: the
result is used *twice* - as the last fallback in `resolveExternalCarrierId`
**and** as the equality test that decides whether to write the shipping sidecar
- so it cannot simply move behind the carrier-mapping branch, because the
comparison needs the id even when a mapping already resolved. And the
*negative* case must not be cached long, or an operator re-activating the
carrier keeps seeing `PrestashopOlCarrierMissingException`.

### 4. Stop paying for a call that cannot succeed - **measured, and smaller than it looks**

OpenLinker reads `GET /api/configurations` with a webservice key that is not
permitted on that resource, so it answers **401 every time**. Two callers:
`prestashop-shop-currency.resolver.ts:126` (`PS_CURRENCY_DEFAULT`, invoked from
`factory.ts:163` on every adapter build) and `prestashop-pack.resolver.ts:183`
(`PS_PACK_STOCK_TYPE`). Each caches the failure on a **60 s** negative TTL
(`:63` and `:49`), so a permanently-forbidden resource is re-probed once a
minute for the life of the process.

Measured across the three arm A windows: 7, 8 and 10 requests per ~306 s =
**1.37, 1.56 and 1.95 per minute; 3.4%, 4.0% and 5.1% of the paced total.**

Two details worth carrying. **Every one of them is `PS_CURRENCY_DEFAULT`** -
verified from the access log's own `filter[name]` - so caller A is the only one
firing and the pack resolver never runs on this path, matching what the source
predicts. And **the rate is about double what a single 60 s negative TTL
implies.** All 10 requests in the third window came from one container
(`172.31.0.8`, `lab-worker-1`), so it is not two processes. Something is
resolving that value roughly twice a minute rather than once; **this run did
not establish what**, and it is a loose end rather than a conclusion.

**The share shrinks as throughput rises, and this run measured that directly
rather than deriving it.** Arm BD's window contains **exactly 7**
`configurations` requests - the *same absolute count* as arm A's r1 window -
against 1 926 paced requests instead of 204:

| Arm | `configurations` 401s | paced total | share |
|---|---:|---:|---:|
| A r1 (60 req/min, 18 orders) | 7 | 204 | **3.43%** |
| BD r1 (600 req/min, 192 orders) | 7 | 1 926 | **0.36%** |

The cost is fixed per unit *time*, not per order, because a 60 s negative TTL
does not care how many orders pass through it. So this is a real waste and a
**poor throughput lever** - worth fixing for cleanliness and for the 401s in
the operator's shop log, not for the orders per hour, and least worth it
precisely on the fast configuration where throughput matters most.

Two remedies, and the first needs no code: **an operator can remove the request
today** by setting `config.currency` on the connection, which
`factory.ts:161-164` already short-circuits the resolver on. Code-side, a
401/403 deserves its own long negative TTL - a permission refusal is not the
transient condition the 60 s was written for. The 401 is already correctly
non-retried (`prestashop-webservice.client.ts:508-510`), so it is one wasted
request and not a ladder.

### 5. Merge `cartshipping` into `importorder` - **derived**, needs a module change

Two HMAC-signed `POST /index.php` calls per order to the same front-controller
family (`prestashop-openlinker-module.client.ts:183` and `:225`), both keyed on
`id_cart` - measured at 1.05 and 1.00 per order. `importorder` already absorbed
the per-line `specific_prices` writes exactly this way behind the `line_prices`
feature string, so both the pattern and the feature-gating mechanism that keeps
old shops working already exist. Accept the shipping amounts in the
`importorder` body, write the sidecar server-side before `validateOrder`, and
advertise a new feature string: **-1 request per order**, no observable
behaviour change. Cost: an `apps/prestashop-module` change.

### 6. A token bucket with burst - **derived, and it buys nothing here**

`libs/shared/src/rate-limit/rate-limiter.ts:198` is
`Math.max(nextAvailableAt, nowMs) + minIntervalMs` - one timestamp, no counter,
so an idle connection banks no credit.

It is worth stating plainly that **this cannot raise sustained throughput.**
Every window in this campaign is a saturation window: there is always queued
work, so a bucket would always be empty and the steady-state admission rate
would be identical. Burst credit changes only what happens to a connection that
has been *idle* and then spikes - a webhook burst after a quiet period, which
is a latency question, not a throughput one. Listed because it is an appealing
idea that the arithmetic disqualifies, not because it is a candidate.

### 7. The `realtime` and `fiscal` lane caps - **measurable, currently a guess, and one direction already measured NEGATIVE**

`sync-job.runner.ts:126-158` states its own provenance: `realtime` and `fiscal`
are **illustrative** ("treat any number there as a guess"), `fan-out` is
**derived**, and only `bulk`'s total is **measured**.

But the obvious move has already been tried and lost. The prior campaign's arm
ED raised `realtime` 4/2 -> 16/16 at the shipped rate limit, took observed
concurrency from 3 to 17, and throughput **fell 12.5%** - seventeen workers
queueing on one pace bucket pay coordination cost for admissions the bucket was
never going to grant faster.

So the untested pair is a raised lane cap **together with** a raised rate
limit, where the bucket is no longer the binding constraint - and this run
**measured that the bucket is indeed no longer binding there**. Arm BD spent
**377.8 of its 600 req/min (63%)** while `maxRunning` sat at **2**, against
`OL_LANE_REALTIME_SCOPE_CAP=2`. The pace gate has headroom; the slots do not.
That is the prior campaign's § 7 conclusion reproduced, and it is what makes
the pair worth measuring rather than merely worth naming.

Arm BD leaves the lane at 4/2, so this run does not make that measurement
directly - but § 4's **BD3** arm approaches the same hypothesis from the other
side, since lane caps are per process and three replicas give three times the
slots at the same raised limit.

### 8. The `filter[reference]` pre-check - **derived**, needs a core port change

`...order-processor-manager.adapter.ts:1249`, called at `:517`, measured ~1.05
per order. Its own docblock (`:510-518`) scopes it to one narrow window: a
retry where `createOrder` succeeded, the mapping write did not, and the cart
was rebuilt. Primary idempotency already lives upstream in
`order-sync.service.ts:356-396`. **On a first attempt it can never find
anything.** Making it conditional needs a retry/attempt indicator on
`OrderProcessorManagerPort.createOrder`, which the port does not carry - so
this is a core contract change, not a local one, and removing it outright does
change behaviour.

### 9. Whatever the traces show once the limiter stops dominating - **unknown**

The honest last item. The A/B document derives ~310 ms of non-paced time per
request in arm BD against a shop answering in ~15 ms, and F1 left ~52 s of a
66 s order unattributed. Both are arithmetic over aggregates, not a profile.
This needs instrumentation inside the limiter and the adapter - not another
window - and until it exists nobody should claim to know what the next
bottleneck is.

### Two caveats that make every per-order figure above a FLOOR

* **This stand's shop is untaxed.** The tax resolver reaches its
  `id_tax_rules_group = 0` "No tax" branch
  (`prestashop-tax-rate.resolver.ts:232-251`), so the `products` ->
  `tax_rules` -> `taxes` walk stops after one request. A taxed catalogue pays
  **+2 requests per distinct product per order**, and those two are cached only
  by the per-order resolver row 2 is about.
* **The buyers are warm** (§ 7). A genuinely cold deployment pays about **4
  more** requests per order for `GET`+`POST customers` and
  `GET`+`POST addresses`, none of which is cached anywhere
  (`prestashop-customer-provisioner.ts:226`/`:290`,
  `prestashop-address-provisioner.ts:266`/`:370`) and none of which is
  avoidable for a new buyer. An order carrying a distinct billing address pays
  two more still (`...adapter.ts:337-349`).

---

## 7. Corrections to figures already in the tree

Stated as corrections rather than as new findings, because a reader reaches the
existing document first and would otherwise take the superseded claim.

### 7.1 The buyers are WARM, not cold - and this inverts the direction the A/B document gives

`results-limiter-ab-2026-09-07.md` § 10 says, under "What this did not
establish":

> **No warm-buyer figure.** Every window calls `of_new_run`, so every order
> mints a new destination customer and requests-per-order is the **all-cold**
> figure. A warm-buyer deployment pays about 4 fewer requests per order, which
> would *raise* every derived ceiling in § 5.

**That is wrong on both halves, and the second half points the wrong way.**
Three independent pieces of evidence:

* **Source.** The stub draws buyers from a fixed pool -
  `stubs/allegro/server.mjs:218`, `const idx = orderN % CONFIG.buyerPoolSize` -
  whose size defaults to **50** (`:101`). The comment at `:99-100` says in its
  own words that the pool size is how a driver chooses *"cold (large pool, ~1
  buyer per order) vs warm (small pool, repeat buyers) as a declared
  measurement input"*. `STUB_BUYER_POOL_SIZE` is **not set** on this stand
  (verified by `printenv` in `lab-allegro-stub`: only `STUB_OFFER_POOL_SIZE`
  is), so the default 50 applies.
* **`of_new_run` does not mint new buyers.** Its own docblock
  (`drivers/order-feed.sh:101-111`) says it exists to avoid re-minting the
  7-day `jobdedup` keys. It resets order counters, so `orderN` restarts at 0
  and cycles the *same* 50 slots. The per-order `+tx` email suffix
  (`server.mjs:227`) is stripped by OpenLinker's own Allegro masked-email
  normalisation before hashing, so the identity is stable per slot.
* **Measurement.** `identifier_mappings` holds exactly **100** `Customer` rows,
  and the three arm A windows contain **zero** `customers` and **zero**
  `addresses` requests across **53** completed orders. Under the all-cold
  reading there would have been about 212 (4 per order).

The consequence matters more than the fact. The document offers the cold
reading as unclaimed *headroom* - warm buyers "would raise every derived
ceiling". In truth the measurement is **already warm**, so that headroom does
not exist, and the direction reverses: a genuinely cold deployment pays ~4
**more** requests per order and every derived ceiling in that document is
correspondingly **lower** for it. § 6's closing caveats carry this.

### 7.2 "Every window in this campaign is DISCARDED" is true of the worker-side throughput scenarios only

F3's webhook-*ingress* measurements are already `VALID` and should not be
swept up in the claim: `campaign-2026-09-06.md:75` records a `VALID` verdict at
43/s with p50 5.5 ms and zero failures, and `:88` states *"Every figure below
is measured, every run VALID"* for its rate sweep. What is discarded there is
the **high-rate** arms, and for an unrelated cause -
`post_guard_generator_saturated`, k6 pinned at 400/400 VUs shedding 52-57% of
its own requests (`results-F3-2026-09-06.md:157-161`). That is the load
generator running out, not the system under test.

So the accurate statement is: every **order-throughput** window (F1, F2,
limiter-ab, lane-caps) is discarded, on the limiter degradation and/or the
structural in-flight-creates guard.

### 7.3 ADR-050's 2.77x replica figure attributes the effect to the wrong cause

**This one needs naming explicitly, because it is in an accepted ADR and will
otherwise be cited again.**

`docs/architecture/adrs/050-workload-isolation-concurrency-lanes.md:376-382`
reads:

> **And a cap does not bound the destination's REQUEST RATE either, once
> replicas multiply it.** F4 (#2851), same aggressor at one and three replicas:
> the identical 600 jobs and effectively identical request count (983 vs 1006)
> were delivered **2.77x faster** because the shop was hit at **158.4 req/min
> against the 60/min its connection declares**. [...] The outbound pacing is
> what gave way.

**What is wrong is the attribution, not the observation.** 158.4 req/min was
really measured. But the sentence frames it as a structural consequence of
scaling - *"once replicas multiply it"* - and it is not. This run put three
replicas against the same 60 req/min limit on a **dedicated** Redis client and
measured **54.5 and 55.1 req/min**: comfortably under the limit, twice.

The mechanism is the degradation. The limiter's registry is Redis-backed and
**shared across processes by design** (`rate-limit.module.ts:70-78`, whose
header says the old static cap-division "is gone"), so replicas are supposed to
contend for one bucket. When a pace `EVAL` times out behind
`JobIntakeConsumer`'s blocking read, that process falls back to its **own**
in-memory limiter (`redis-rate-limiter.adapter.ts:355-359`) - and three degraded
replicas become three independent 60/min buckets, which is 180/min, which is
where 158.4 comes from.

So the ADR's closing clause, *"the outbound pacing is what gave way"*, is
**right** - and is in fact the more accurate half of the paragraph. What must
not travel is the causal claim above it: **replicas do not multiply the
destination's request rate; a degraded limiter does.** With the wiring fixed,
adding replicas is safe with respect to the operator's configured limit.

**Scope of this correction, stated so it is not over-read**: it applies to the
2.77x / 158.4 req/min claim only. The **5.5x** F7 figure in the preceding
paragraph, and the operator-facing conclusion that *"raising a scope cap to make
a slow destination faster makes it slower"*, were **not** re-measured here and
are untouched - the latter is independently supported by the prior campaign's
arm ED losing 12.5%, and by this run's arm D3 reaching only 54.5-55.1 req/min
where a single dedicated-client replica reached 60.0.

### 7.4 A degradation "line count" is an episode count, not a call count

Set out in § 8. Worth flagging here because the A/B document's `34-58 degraded
lines` column reads naturally as a volume of affected calls and is not one; the
number of individual calls that fell back is **not** established by any figure
in this campaign.

---

## 8. Instruments

### The latency probe checks HTTP status, because the campaign already paid for one that did not

`drivers/ps-latency-probe.mjs` is new here. Every sample carries the status the
shop returned, every endpoint declares the status it EXPECTS, and the reported
percentiles are computed over samples that got the expected status - with the
non-matching count printed beside them rather than folded in or dropped.

That is not a stylistic preference. `results-lane-caps-2026-09-07.md`
correction 1 (carried into `sync-job.runner.ts`'s own docblock as an explicit
"do NOT reintroduce this figure") records a probe that never checked status, so
a shop shedding load with an instant error measured as excellent latency and
the store-impact conclusion inverted. The 0.995 p95 ratio that probe produced
is withdrawn from the tree. This probe exists partly to re-establish that axis
with an instrument that cannot fail the same way.

`configurations` is the one endpoint whose expected status is **401**. That is
not a defect in the probe - OpenLinker's own call to that resource is
unauthorised and answers 401 on every attempt (§ 6), so treating the 401 as a
failure would discard the sample and hide a real cost. Probing it measures what
the wasted call costs the shop.

### The probe's own requests are subtracted as a measured count, not an estimate

The probe sends a fixed unique `User-Agent`, so `probes/ps-request-mix.sh`
counts its lines in PrestaShop's access log and removes them before deriving
anything.

**Verified end to end, not just in principle.** On run 2's BD r1 window - the
one the probe overlapped - the analyser reports `probe requests: 150 (excluded
from every figure below)`, exactly the 150 samples the probe itself reported,
and the corrected figure is **1 906 requests over 190 orders = 10.03 per
order**, which is the same as run 1's *un-probed* BD windows (10.03). The
scenario's own uncorrected number for that window is 10.93. So the subtraction
recovers the true per-order cost precisely rather than approximately, which is
what makes a probe that rides on a live window admissible at all.

This matters because the throughput scenario derives requests-per-order from
that same log, and every derived ceiling divides by that figure. An
uncorrected probe would inflate it.

**One disclosure the mechanism caught on itself.** A 3-sample functional
re-check of the probe, run after a code change to its summary formatting,
landed inside arm **BD r2**'s window - 3 requests against ~1 900, 0.16%. It is
named here rather than left implicit precisely because the subtraction makes it
recoverable: `ps-request-mix.sh` reports `probe requests: 3 (excluded from
every figure below)` for that window, so the request mix is unaffected. The
scenario's own `destRequestsPerOrder` for BD r2 does **not** subtract them and
is therefore high by 3/192 = 0.016 requests per order, which is below the
figure's own printed precision.

The probe is therefore pointed at the **raised-rate arm only**. At 0.5 req/s it
adds ~150 requests to a 300 s window - a few per cent of arm BD's own ~1 900,
but a large fraction of arm A's ~200. Arm A's windows are run with no probe at
all so the baseline stays uncontaminated and directly comparable to the prior
campaign's arm A.

### The degradation guard was proved able to fail before any zero was believed

`limiter-ab.sh --smoke` was run before any window opened. It emits one
degraded-mode line at a known instant from a throwaway container against real
Docker and checks the guard both ways:

| Check | Result |
|---|---|
| the guard, window containing the line | `DISCARDED ... 1 degraded-mode log line(s)` |
| the guard, window before the line | `ok` |

So a zero in this report is a measured absence.

### How to read a degradation COUNT

The count is **entries into degraded mode**, not degraded calls.
`post_guard_limiter_degraded` greps only
`falling back to per-process in-memory limiting`
(`lib.sh`), which `RedisRateLimiterAdapter` logs on the TRANSITION into
degraded mode and then at most once per 30 s while it persists
(`redis-rate-limiter.adapter.ts`, `DEGRADED_LOG_INTERVAL_MS`); recovery logs a
separate line the guard does not count. So 45 lines in a 300 s window is ~45
separate degradation episodes - flapping every few seconds - and says nothing
about how many individual calls fell back inside each one. A zero, by contrast,
is an unambiguous claim: no episode began or persisted in the window.

### A degradation count cannot be re-derived after a worker recreate, and this run proved it the hard way

An ad-hoc `docker logs --since <A r1 window> lab-worker-1 | grep -c 'falling
back to per-process in-memory limiting'` run **after** the arms had finished
returned **0** for a window the guard had scored **45**.

The explanation is not a broken grep. Arm BD needs a worker recreate, so the
container that ran arm A no longer exists - the current `lab-worker-1` started
at `17:18:42Z`, after every arm A window had closed - and a destroyed
container's logs go with it. A retrospective count across a recreate is
therefore **structurally unable to see anything**, and it reads exactly like a
clean window.

Two consequences. The guard's count **at window close** is the only record, so
`degraded_count_from_verdict` reading the verdict rather than re-grepping is
load-bearing rather than tidy - `lib.sh` says as much in its own words ("a
second, independently-wrong implementation of the window bounds"). And the
zeros reported for arm BD are valid because they were taken **on the container
that ran those windows**, by the guard, at the moment the window closed.

**Do not re-derive a degradation count for a past window from a live
container.** It will answer 0.

### One trap caught in this run's own tooling before it cost a measurement

`run-retest.sh` originally read `WORKER_CONTAINERS="${WORKER_CONTAINERS:-lab-worker-1}"`.
The colon form substitutes the default when the variable is unset **or empty**,
and an explicitly-empty value is the documented way to make `lib.sh` discover
the worker replicas itself (`_ensure_worker_containers` branches on
`[ -z "$WORKER_CONTAINERS" ]`). So the 3-replica run would have silently pinned
itself to `lab-worker-1`, and every per-worker guard - the degradation count
among them - would have inspected **one worker of three and reported a third of
the truth**, with nothing in the output saying so.

It is the same trap `limiter-ab.sh` already records against its own
`ARM_SPECS`, which is how it was found. Fixed to `${WORKER_CONTAINERS-lab-worker-1}`
and demonstrated both ways before the run that depends on it.

### `docker logs --since` takes a BARE epoch

Repeated here rather than assumed remembered: the `@epoch` form is accepted
without error and returns almost nothing on Docker 29.5.2. It cost this
campaign every degradation count it published before #2851. Both new scripts
use bare epochs.

---

## 9. What this did not establish

- **No profile of where an order's time actually goes.** § 6 row 9 stands
  untouched. The unattributed ~52 s of F1's 66 s order and the derived ~310 ms
  per request in arm BD are still arithmetic over aggregates. Removing the
  limiter's degradation reveals the next bottleneck; it does not name it.
- **No decomposition of the dedicated client's gain.** Whether it is the
  1000 ms timeouts, the per-process fallback's reset pacing state, or both, is
  still unattributed - that needs instrumentation on the limiter.
- **No POST-path latency for the shop.** The latency probe is GET-only, because
  the create path's `POST customers` / `POST addresses` / `POST carts` and the
  two module POSTs mint real rows. A flat GET curve is necessary evidence that
  the shop tolerates a rate, not sufficient.
- **No second destination.** PrestaShop only. WooCommerce stays unmeasurable on
  this stand for the reason F1 documented - its seeded product mappings carry
  no numeric WC product ids, so no order can resolve a line item there.
- **No taxed catalogue, and no cold buyers.** Both make every per-order figure
  here a floor rather than a typical value (§ 6's closing caveats).
- **Nothing about a real shop.** This is a containerised PrestaShop on a
  developer workstation with a seeded catalogue, sharing a kernel with the
  system under test. A shared-hosting PrestaShop - the platform the 60 req/min
  placeholder was written for - is a different machine with different
  neighbours, and no figure here transfers to it.
- **No abuse-notice evidence.** The 60 req/min default remains, in
  `prestashop-plugin.ts:80-84`'s own words, a placeholder pending a reporter's
  abuse-notice text that never arrived. This run measures what one shop
  tolerates; it cannot tell you what a host's acceptable-use policy permits,
  and a latency curve is not a licence.

---

## 10. Reproducing it

```bash
export PS_CONTAINER=lab-prestashop PS_MYSQL_CONTAINER=lab-mysql WC_CONTAINER=lab-woocommerce \
       PG_CONTAINER=lab-postgres REDIS_CONTAINER=lab-redis OL_API_CONTAINER=lab-api \
       WORKER_CONTAINERS=lab-worker-1 OL_API_URL=http://127.0.0.1:19000 \
       OL_ADMIN_USER=admin OL_ADMIN_PASSWORD=admin
set -a; . perf/openlinker-throughput/stand-ids.env; set +a

# Rig self-test - opens no window, proves the degradation guard can fail.
perf/openlinker-throughput/scenarios/limiter-ab.sh --smoke

# Priority 1: arm A (shipped defaults) x3 + drift, arm BD (dedicated client,
# 600 req/min) x3. No probe - the throughput baseline stays uncontaminated.
REPEATS=3 ARM_SPECS="A:60:4:::false" \
  RECREATE_ARM_SPECS="BD:600:4:::true" DRIFT_CONTROL="A:60:4:::false" \
  perf/openlinker-throughput/scenarios/limiter-ab.sh

# Priority 2a: the shop's own latency DURING a real arm BD window.
perf/openlinker-throughput/probes/ps-latency-during-window.sh \
  /tmp/run2.log /tmp/latency-during 0.5 300 &
REPEATS=2 ARM_SPECS="" DRIFT_CONTROL="" \
  RECREATE_ARM_SPECS="BD:600:4:::true" \
  perf/openlinker-throughput/scenarios/limiter-ab.sh > /tmp/run2.log

# Priority 2b: the latency-versus-rate curve, with no window open.
perf/openlinker-throughput/probes/ps-latency-ramp.sh /tmp/latency-ramp

# Collapse either probe directory into one table (offered vs achieved rate,
# ok/total, percentiles, status mix).
perf/openlinker-throughput/probes/ps-latency-table.sh /tmp/latency-ramp
perf/openlinker-throughput/probes/ps-latency-table.sh /tmp/latency-during

# Per-window request mix, wasted-401 share, and the probe subtraction.
perf/openlinker-throughput/probes/ps-request-mix.sh <window_start> <window_stop>

# Priority 3: 3 replicas, arms D3 (60/min) and BD3 (600/min).
perf/openlinker-throughput/run-retest-3.sh

# Priority 4: the read path at the size the stand already carries (no reseed).
F5_ONLY_SIZE=1000000 F5_ONLY_LABEL=1M \
  perf/openlinker-throughput/run-retest.sh f5-read-path.sh

# All three phases back to back, waiting for the stand lock between them.
RUN1_PID=<pid> perf/openlinker-throughput/run-retest-chain.sh
```

`run-retest.sh` is a stand-identity wrapper, not a scenario - it exports the
container names and sources the generated `stand-ids.env`, then forwards.
**Nothing that `bootstrap.sh` generates is hard-coded in it**: connection ids
and the PrestaShop webservice key are read from that file, which is gitignored.
If the scenario is run from a different working tree than the one that
bootstrapped the stand - normal on a machine carrying several worktrees - point
it at the right one:

```bash
export STAND_IDS_FILE=/path/to/bootstrapping/checkout/perf/openlinker-throughput/stand-ids.env
```
