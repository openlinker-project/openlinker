# A spike, then the recovery: offered above capacity, then below

> **Window run 2026-09-08T23:28:14Z → 2026-09-09T00:57:58Z.** Everything in
> § 0-§ 2 was written and committed **before the window opened** (commit
> `53de3d37b`), so its acceptance criteria could not be moved to fit the data.
> All four passed. Results are in § 3; § 4 is not optional reading.
>
> **Verdict `DISCARDED`** by two guards, both named in advance in § 2.1 — one
> of them the known-broken `post_guard_destination_creates`, whose spurious
> firing § 3.7 now confirms by attribution.

**Host**: `epyc32` — see `machine-spec-epyc32-2026-09-08.md`. Dedicated perf
stand, **nothing else runs on it**; a queue-depth measurement is meaningless
if a co-tenant is stealing drain capacity, so this is a condition of the
figure and not a footnote.

**Scenario**: `scenarios/sustained-mixed-load.sh` with the ramp schedule this
issue adds (`MIXED_RAMP`). Not a new scenario — the arrival loop already
took a single `MIXED_ORDERS_PER_MIN`; it needed a *schedule*.

## 0. Why this run exists

Every window in this campaign so far offered a **constant** arrival rate.
Two saturated from the first second and never converged (arms A and B of
`results-mixed-load-fixed-2026-09-08.md`); arm C ran below capacity from the
first second. **Nobody has run offered-above-capacity followed by
offered-below-capacity, which is the only shape real retail has.** A
customer's first bad day is a spike, not a Tuesday.

### 0.1 The arithmetic that makes it urgent

| Path | Rate | Label |
|---|---|---|
| webhook accept (routable event → 202) | 3.4 ms, achieved **240 events/s** | measured (F3) |
| order drain (2 realtime slots ÷ 6.014 s service) | **~986 orders/h ≈ 0.27/s** observed; 1 197/h ceiling | measured / derived (arm B) |

That is a **≈750:1 ratio between the front door and the corridor**. One
minute of arrivals at the accept rate queues ~14 400 jobs — on the order of
**12.5 hours of drain**. And there is **no admission control anywhere**: the
accept path returns 202 at 3.4 ms regardless of queue depth, so the system's
only response to overload is unbounded queue growth. Nobody has measured what
that costs.

## 1. Conditions, declared before the run

### 1.1 The rates, and why these integers

`MIXED_ORDERS_PER_MIN` is passed to `of_push_orders` as an **integer count
per one-minute tick**, so the reachable rates are multiples of 60/h. The
drain reference is arm B's **observed 986 orders/h** (not the 1 197/h
ceiling, and not the brief's 0.32/s = 1 152/h, which sits between the two —
both are recorded here so the multiple is auditable).

| Phase | Target | Chosen | Actual multiple of 986/h |
|---|---|---|---|
| burst, 30 min | 3 × drain = 2 958/h | **50/min = 3 000/h** | **3.04×** |
| drain, remainder | 0.5 × drain = 493/h | **8/min = 480/h** | **0.49×** |

### 1.2 What is sampled, and the one distinction that matters most

Every 30 s: **due** queue depth (`status='queued' AND "nextRunAt" <= NOW()`),
**deferred** count (`status='queued' AND "nextRunAt" > NOW()`), `running`,
`dead`, and completions. A queued row whose `nextRunAt` is in the future is
**backing off on its own schedule and is not queue depth** — conflating the
two would make a healthy retry ladder look like a backlog. Plus per-order
end-to-end age percentiles, which is the operator-visible number and the
thing this run exists to produce: *what does the 1000th order in the burst
actually experience.*

### 1.3 Expected backlog, derived before the run

30 min at 3 000/h offers **1 500 orders** while ~493 drain ⇒ backlog ≈
**1 007 orders** at burst end. At 480/h offered against 986/h drain the net
is 506/h ⇒ **≈ 2.0 h to clear**. The drain phase is therefore observed for a
**bounded** period and the remainder **derived from the measured slope**, and
labelled as derived. A 2.5 h wall-clock run is not promised.

## 2. Pre-registered acceptance criteria

Committed before the window opened; **not moved afterwards**.

| # | Criterion | If it fails |
|---|---|---|
| **AC1** | the burst phase genuinely saturates: net due-queue growth over the 30 min is **> 0** | the burst was not above capacity and the run **does not answer the question**; reported as such |
| **AC2** | the drain phase genuinely converges: due-queue slope over the last 20 min of observation is **< 0** | reported as non-converging; **no clearance time is derived** |
| **AC3** | per-order age percentiles resolve for ≥ 200 burst-phase orders | percentiles carry their `n`; not promoted to a headline |
| **AC4** | expiry/death accounting is reported *through* the drain, not only at the end | — |

### 2.1 Three guards are expected to DISCARD this window, and that is pre-registered

`post_guard_attempts`, `post_guard_deferrals` and
`post_guard_destination_creates` all **assume the window drained**. A window
built to saturate cannot satisfy them. `results-mixed-load-fixed` states the
same expectation for its own arms and calls it a scenario-versus-guard
mismatch rather than a fault. So:

- a `DISCARDED` verdict here is **expected and named in advance**, not a
  surprise discovered afterwards, and the § 3 figures travel with that scope;
- `post_guard_destination_creates` is additionally **known-broken**: its
  `failed` arm carries no destination predicate while its message promises
  one, and the stand's WooCommerce connection has no product mappings, so it
  fails every order and has reported counts **exceeding its own population**
  in three separate windows. Expect a spurious firing. It is reported, and
  **the WooCommerce connection is NOT disabled to make it pass** — that would
  hide a guard defect behind a configuration change;
- `post_guard_limiter_degraded` is the one guard whose answer here is a
  **finding rather than an artefact**.

### 2.2 What "what did the spike cost" can and cannot show in 2.5 hours

Stated before the data so the result cannot be quietly overclaimed. Three
clocks run against a backlog:

| Clock | Threshold | Crossable in this window? |
|---|---|---|
| `jobdedup:*` Redis key TTL | **7 days** | **No** |
| `OL_JOB_MAX_DEFERRED_WAIT_SECONDS` (deferral budget, then the job rejoins the retry ladder and can reach `dead`) | **24 h** | **No** |
| reservation `expiresAt` (`OL_RESERVATION_TTL_MS`, 7 d default, clamped [1 h, 90 d]) | **7 days** default | **No** at default |

So the honest pre-registered expectation is that **nothing expires because it
waited**, and the deliverable on that axis is the *arithmetic of when it
would* plus whatever **does** die for other reasons (retry exhaustion,
destination refusal). If the run instead shows an expiry, that is a genuine
and unexpected finding and gets its own section. What must **not** happen is
reporting "nothing expired" as evidence that a backlog is harmless.

## 3. Results

**Run**: `results/sustained-mixed-load/run1788910033`. Window
**2026-09-08T23:28:14Z → 2026-09-09T00:57:58Z** (5384 s measured).
Burst `50/min` for 1800 s, then drain `8/min` for 3600 s. Fault off. Primed
with 1 order.

### 3.1 Conditions in force

| | |
|---|---|
| `guard_build` | ok — *"product paths identical"* to tree HEAD `55d596c59`; image `4ff884d8e` |
| Lane caps (runner-reported) | `realtime=4/2 bulk=12/8 fiscal=2/1 fan-out=8/4` |
| Job intake Redis client | **DEDICATED** (env unset — #2984 made it unconditional) |
| Scheduler | **ON**, 30 tasks registered (the scenario's premise) |
| Master catalogue sweeps | **left ON** — unlike the latency window, a realistic Tuesday is this scenario's whole point. § 3.5 is what that cost. |

### 3.2 Pre-registered criteria: outcomes

| # | Criterion | Result |
|---|---|---|
| **AC1** | burst genuinely saturates (net backlog growth > 0) | **PASS** — order backlog **50 → 1052** over the burst |
| **AC2** | drain genuinely converges (slope < 0 over last 20 min) | **PASS** — **−384 orders/h** over the final 1181 s |
| **AC3** | ages resolve for ≥200 burst-placed orders | **PASS** — n=**1048** |
| **AC4** | expiry/death accounting reported *through* the drain | **PASS** — § 3.6 |

### 3.3 The headline: what an order in a spike actually experiences

Per-order **end-to-end age** = `placedAt → createdAt` on `order_records`, i.e.
**placement → visible in OpenLinker** — the same quantity the latency window
reports, deliberately. All **measured**.

| cohort | n | min | p50 | p90 | p95 | max |
|---|---:|---:|---:|---:|---:|---:|
| all window orders | 1095 | 48.3 s | **1810 s (30.2 min)** | 3234 s (53.9 min) | 4070 s (67.8 min) | 5083 s (84.7 min) |
| **placed during the burst** | 1048 | 48.3 s | **1736 s (28.9 min)** | 3223 s (53.7 min) | 4191 s (69.9 min) | 5083 s (84.7 min) |
| **placed during the drain** | 47 | **3041 s (50.7 min)** | **3174 s (52.9 min)** | 3246 s | 3251 s | 3257 s |

> **An order placed *after* the spike was over waited longer than one placed
> during it** — median 52.9 min against 28.9 min, and its *best* case (50.7 min)
> is worse than the burst cohort's median. It arrives to find ~1000 orders
> ahead of it. This is the single most operator-relevant number here, and it is
> the opposite of what "the spike is over" suggests.

And the brief's question — what does the Nth order experience:

| order # (by `placedAt`) | age |
|---:|---:|
| 1 | 63.5 s |
| 10 | **4347 s (72.5 min)** |
| 100 | 723 s (12.0 min) |
| 250 | 464 s (7.7 min) |
| 500 | 962 s (16.0 min) |
| **1000** | **2765 s (46.1 min)** |

**That column is not monotonic, and the non-monotonicity is the finding**: the
10th order waited 6× longer than the 100th. The claim is
`FOR UPDATE SKIP LOCKED` ordered by `nextRunAt`, and a retried job re-enters
with a later `nextRunAt` — **the queue is not FIFO**, so no position-based
promise ("your order is 10th, so you'll wait 10×t") can be made to an operator.

### 3.4 Throughput, and the counter-intuitive shape

| phase | duration | ingested | rate | label |
|---|---:|---:|---:|---|
| whole window | 5384 s | 1090 | **728.8 orders/h** | measured |
| **burst** (offered 3000/h) | 1747 s | 414 | **853.1 orders/h** | measured |
| **drain** (offered 480/h) | 3568 s | 667 | **673.0 orders/h** | measured |

**The drain phase drained more slowly than the burst phase** — 673/h against
853/h — even though the offered rate had fallen to a sixth. § 3.5 is why.

Note also that the whole-window 728.8/h is **26% below the 986/h reference**
this run's rates were derived from (arm B). Per-order service time here is
**8.43 s mean over 479 succeeded rows** (`lastAttemptDurationMs`, never a
summary p50) against arm B's 6.014 s, giving a slot ceiling of
`2 × 3600 / 8.426 =` **854 orders/h** [derived] — which the burst phase hit
almost exactly. So the burst was **slot-bound at the measured service time**,
and the "0.5× drain" the ramp offered was in reality **0.71× of this
configuration's actual drain**, not 0.49×. The multiple was computed from a
figure that did not reproduce.

### 3.5 What the spike actually cost: a sweep collision, with a dose-response curve

Per-order service time, by 5-minute bucket of when the job **ran**:

| ran at | n | mean service time |
|---|---:|---:|
| 23:30–23:55 (burst) | 69–74 each | **7231–7669 ms** (flat) |
| **00:00** | 25 | **23 322 ms** |
| 00:05 | 34 | 16 381 ms |
| 00:10 | 61 | 9 235 ms |
| 00:15 | 50 | **7 797 ms** (baseline restored) |

At the **00:00 hour boundary** the scheduler fired, in one tick:

- `master.product.syncFromSweep` **×100**, mean 12 171 ms — **1217 s of work**;
- `master.product.syncBatch` ×5, one of which took **182 619 ms**;
- `marketplace.fulfillment.statusSync` ×2 at **144 248 ms each** (288 s);
- plus `master.product.syncAll`, `master.inventory.syncAll`, and the hourly set.

The **×100 per-product fan-out appeared only at that tick** — the 23:40 sweep
produced a single batch child and no fan-out, and service time did not move
then. That is #2593's documented fallback: a batch page that fails per-product
re-enqueues each product as an ordinary per-product job. Those children hit
**the same PrestaShop and MySQL** the order path writes to.

**Evidence this is causal rather than coincidental**: service time tripled at
the tick and then decayed monotonically back to baseline (23.3 → 16.4 → 9.2 →
7.8 s) as the sweep's children drained, and the only tick that produced the
fan-out is the only tick that moved it. **What would confirm it** is a repeat
window with `OL_PRODUCT_SYNC_ENABLED=false` — expressible only because that
key was added to compose for the latency window; this is a single occurrence
and is labelled as the leading explanation, not a proven one.

The operational consequence is measured: **the order backlog kept GROWING for
about 10 minutes after the offered rate dropped below capacity**, peaking at
**1093 at t=2410 s** (offered had dropped at t=1800 s). Recovery from a spike
is not monotonic if a catalogue-sweep tick lands inside it.

### 3.6 What expired, died, or was dropped because it waited

Pre-registered § 2.2 said the honest expectation was **nothing**, and that the
deliverable would be the arithmetic of when it would. That is what happened,
and it is stated as a bounded negative rather than as reassurance.

| clock | threshold | crossed? | evidence |
|---|---|---|---|
| `OL_JOB_MAX_DEFERRED_WAIT_SECONDS` (deferral budget) | 24 h | **No** | **`jobs with deferredTotalMs>0` = 0**; max `deferredTotalMs` = none |
| `jobdedup:*` Redis TTL | 7 days | **No** | window was 1.5 h |
| reservation `expiresAt` | 7 days default | **No** | window was 1.5 h |

What **did** happen:

- **`deferred (backing off) at end`: 364.** These are ordinary retry backoff
  (`status='queued'` with `nextRunAt` in the future) and are **not** deferral-
  budget consumption — the budget counter is zero. Conflating the two would
  report a healthy retry ladder as a system running out of patience.
- **`jobs with attempts>1`: 738; max attempts seen: 8.** The retry ladder was
  exercised hard and did not exhaust (`PERF_MAX_ATTEMPTS` caps harness-enqueued
  jobs at 3; scheduler-minted jobs carry the entity default of 10).
- **Dead jobs: 7 — and none on the order path.** `marketplace.offers.sync` ×6
  and `destination.taxonomy.sync` ×1, all `Allegro API error (404)` against
  stub endpoints that do not exist. `marketplace.order.sync` dead count:
  **0**.
- **Limiter degradation: 0 episodes over 5384 s** (authoritative,
  `post_guard_limiter_degraded`). The #2984 dedicated intake client held
  through a 3× burst — a *finding*, since this guard's answer here is a
  result rather than an artefact.
- **No admission control fired, as expected.** All **1900** offered orders were
  accepted; nothing was rejected, shed or throttled at intake. The system's
  only response to 3× overload was to queue, which is what § 0.1 said and is
  now measured rather than asserted.

Container memory was flat (worker 105→141 MiB, postgres 257.9→258.9 MiB). These
are `docker stats` MemUsage and therefore **page-cache-inclusive upper bounds**,
not RSS; no memory-pressure conclusion is drawn from them, and none is needed
on a 122 GiB host.

### 3.7 Verdict: DISCARDED, exactly as pre-registered — including the broken guard

```
reason=post_guard_attempts: 735 job(s) in the window show attempts>1
reason=post_guard_destination_creates: 1093 order(s) carry a failed
       syncStatus entry, 776 lack syncedAt on the declared destination
```

§ 2.1 named both in advance. The second is the **known-broken guard, and the
prediction is now confirmed by attribution**:

| destination | status | count |
|---|---|---:|
| `ccadaf52` **PrestaShop** (the declared destination) | `synced` | **1097** |
| `84c8fced` **WooCommerce** (no product mappings) | `failed` | 1097 |

**Every order synced to the declared destination and every order failed on
WooCommerce.** The guard's `failed` arm carries no destination predicate, so it
reported 1093 failures for a window in which **zero orders failed on the
destination it was given**. As pre-registered, **WooCommerce was not disabled
to make the guard pass** — that would hide a guard defect behind a
configuration change.

### 3.8 A measurement correction worth more than one figure

Three different numbers all look like "the backlog", and two of them are wrong:

| candidate | value near the end | why it misleads |
|---|---:|---|
| global `g_queued_due` | ~1330 | includes **771** `order.sync` rows belonging to the *webhook* connection's own failing flow |
| source-scoped `src_queued_due` | ~1358 | right connection, but counts **all job types** — each completed order spawns fan-out children (`offerQuantity.update` reached 446), so it stays flat while orders genuinely drain |
| **`pushed − ingested`** | **911** | the actual order backlog |

Both `src_*` columns were added for this run precisely because the global pair
cannot answer "did this window's burst build a queue" while the scheduler is
on — and they were still not sufficient. **The convergence in AC2 is measured
on `pushed − ingested`**, which is the only one of the three that is an order
count. A run that had reported the global column would have concluded the queue
never converged at all.

## 4. What this did not establish

- **The sweep collision is one occurrence.** The dose-response curve is strong
  and the fan-out was unique to that tick, but causation is *inferred*. The
  confirming run is the same window with `OL_PRODUCT_SYNC_ENABLED=false`.
- **The phase boundary and the cron hour boundary were confounded.** The burst
  ended at 23:58:14Z and the hourly cron set fired at 00:00. A repeat should
  offset the window so the two do not coincide — that is a design flaw in this
  run, not a property of the system.
- **The drain was observed for 60 minutes, not to completion.** Clearance from
  the final slope is **2.37 h [derived]**, not measured. The backlog was still
  911 orders when the window closed.
- **The rates were derived from a figure that did not reproduce.** Arm B's
  986 orders/h became 728.8/h here, so "3× / 0.5×" was really "≈3.5× / 0.71×"
  of this configuration's own drain. AC1 and AC2 are unaffected (both were
  about direction, not multiple), but no claim is made that this window offered
  exactly 3× and 0.5×.
- **Nothing about a real marketplace.** The source is the Allegro stub; the
  destination is a real local PrestaShop.
- **Nothing about multi-replica behaviour.** One worker process, so every lane
  cap is the per-process cap (ADR-050 § Amendment (#2851/#2867)).
- **No expiry was observed, and that is a bound rather than a reassurance** —
  see § 3.6. A 1.5 h window cannot cross a 24 h or 7 day clock. What a
  multi-day backlog does to the deferral budget and to reservation TTLs is
  unmeasured.
- **`marketplace.fulfillment.statusSync` at 144 s per run is unexplained.**
  It is recorded because it is large and shares the destination, not because
  this run diagnosed it.
