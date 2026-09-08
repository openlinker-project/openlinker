# How long after a buyer places an order does it appear in OpenLinker?

> **Window run 2026-09-08T18:40:52Z → 19:16:03Z.** Everything in § 0-§ 2 was
> written and committed **before the window opened** (commit `53de3d37b`), so
> its acceptance criteria could not be moved to fit the data. Results are in
> § 3; § 4 is not optional reading.
>
> **Verdict `DISCARDED`** by two guards, both on facts belonging to a
> connection this measurement makes no claim about — § 3.7 attributes them
> rather than waving them away. The § 3.2 figures travel with that named
> scope.

**Host**: `epyc32` — see `machine-spec-epyc32-2026-09-08.md`, captured
2026-09-08T11:02:45Z. Dedicated perf stand, **nothing else runs on it**; that
is a *condition of this measurement*, not a footnote — see § 1.1.

**Scenario**: `scenarios/f1-order-ingestion.sh --latency-only` with
`F1_SCHEDULER_ON=1` (this issue's addition).

## 0. Why this run exists, and what is different about it

F1 measured a per-order latency ladder but **excluded the poll wait by
construction**: the scheduler was off and the harness enqueued every
`marketplace.orders.poll` itself, so F1's own header calls hop A "a cadence
this script chose … NOT a figure any deployment experiences". On top of that
every F1 window is `DISCARDED` and #2847 **withdrew** its 66 s and
182-295 orders/h figures.

So the campaign has no answer to the question a buyer actually arrives with,
and which six competitors publish:

| Vendor | Published claim | Shape |
|---|---|---|
| Apilo | orders appear **within 5 minutes** of placement | latency |
| Channable | 5 minutes | cadence |
| Pipe17 | 5 minutes | cadence |
| BaseLinker | 10 minutes default (1 min on a paid accelerator) | cadence |
| ShipStation | **2 hours** import floor | cadence |
| Linnworks | hourly (CSV) | cadence |

This run turns hop A into a **measurement of the running scheduler**.

## 1. Conditions, declared before the run

### 1.1 The dedicated host is a condition of the figure

Every other figure in this campaign was taken on a workstation carrying two
or three co-tenant Docker stacks. This measurement is latency, serial, and
single-order: it is the figure most sensitive to a neighbour stealing a core
at the wrong instant. It was moved to a dedicated host for that reason, and
the report states it because a reader reproducing this on a shared machine
should expect a worse and noisier number, not conclude the instrument is
broken.

### 1.2 Scheduler ON, and the guard waived deliberately

`guard_scheduler_off` is **deliberately not called**, and the waiver is
recorded in the manifest as `schedulerPosture` /
`guardSchedulerOffWaived: true`. That guard's own docblock authorises a
scenario that wants the scheduler on to skip it, provided it records the
resolved task inventory and the cadences — which § 3.1 does.

The trap this must not fall into is F1's own words: **"a scenario that
silently measures a configuration it did not request is the worst failure
mode this harness has."** So hop A must not become a second harness-chosen
constant under a different name. Two rules follow, both enforced in code
rather than asserted in prose:

1. **Every scheduler fact is read back from the worker's own startup log**
   (`Registered scheduler task: <taskId> (scope: …, jobType: …, cron: …)`),
   never inferred from config or from the code's default. This is the pattern
   `scenarios/sustained-mixed-load.sh` already uses (`mixed_wait_for_scheduler`).
2. **The poll attributed to a sample must be a scheduler-minted poll.** The
   scheduler's key is `marketplace:{connId}:orders:poll:{timestamp}`; the
   harness's own is `marketplace:{connId}:orders:poll:{tag}:{ms}`. The sample
   loop matches `…:orders:poll:[0-9]+$` so a harness-enqueued poll can never
   be mistaken for a scheduled one.

### 1.3 The compose passthrough defect this run had to fix first

The brief asks for the master catalogue sweeps to be disabled so `fan-out`
co-tenancy stays controlled — `master.product.syncAll` and
`master.inventory.syncAll` parents share the `fan-out` lane with
`marketplace.orders.poll` itself.

**Setting those env vars would have changed nothing.** `docker-compose.lab.yml`
substitutes `${VAR}` only for keys the service itself lists, and the `worker`
service listed none of `OL_PRODUCT_SYNC_ENABLED`,
`OL_INVENTORY_SYNC_ENABLED`, `OL_MASTER_PRODUCT_RECONCILE_ENABLED`. This is
the identical trap the file's own `OL_JOB_INTAKE_DEDICATED_REDIS` comment
records ("exporting this around `docker compose up` … changed NOTHING before
this line existed") and the identical trap `assert_lane_caps` was added for.
Left unfixed, this window would have run with all three sweeps live while the
manifest claimed they were off — exactly the failure § 1.2 quotes.

The three keys are therefore added to the worker service, and AC2 below
**verifies the result in the worker's own task inventory** rather than
trusting the variable.

### 1.4 Held constant

Source `perf-allegro-a` (`ALLEGRO_A_CONNECTION_ID`), destination the **real
local PrestaShop** (never the stub), WooCommerce disabled for the arm so the
`syncStatus[].syncedAt` late-bias is removed structurally (F1's existing
single-destination arrange), 25 serial samples, one order in flight at a
time, images as built at 2026-09-08T11:12/11:17Z carrying #2984.

## 2. Pre-registered acceptance criteria

These were committed before the window opened and are **not moved
afterwards**. If the run fails one, that is the result.

| # | Criterion | If it fails |
|---|---|---|
| **AC1** | ≥ 20 of 25 samples reach a destination `syncedAt` | figures reported with the reduced `n` stated beside every percentile; not promoted to a headline |
| **AC2** | the worker's task inventory contains `allegro-orders-poll` at cron `*/1 * * * *`, and contains **none** of `master.product.syncAll`, `master.inventory.syncAll`, `master.product.reconcile` | window **DISCARDED** for uncontrolled `fan-out` co-tenancy — never silently reported |
| **AC3** | hop A median ∈ [0 s, 60 s] and p90 ≤ 60 s | the poll is not firing at `*/1`; the cadence claim is **void** and no end-to-end figure may be quoted |
| **AC4** | no `post_guard_limiter_degraded` firing inside the window | count reported as a finding; figures scoped (this is the #2984 regression check) |
| **AC5** | claim-instant provenance printed; any hop with n < 20 carries its n | that hop is reported but excluded from the headline ladder |

**Outcome, decided against the criteria above and not against the data:**
AC1 **pass** (25/25), AC2 **pass** (cron `*/1`, zero sweeps registered),
AC3 **pass** (hop-A median 23.25 s, p90 55.05 s), AC4 **pass** (0 degraded
lines), AC5 **pass** (provenance printed, every hop n=25). The `DISCARDED`
verdict is *not* an AC — no criterion required one, because § 2 was written
knowing the drain-assuming guards exist.

### 2.1 The falsifiable prediction, stated before the data

Mean poll wait at `*/1` is **30 s** (derived: uniform arrival over a 60 s
period). Added to F1's ladder the expected end-to-end median is **≈ 90-100 s**.

**That prediction leans on a withdrawn figure and is therefore weak
evidence, and is written down anyway so it can be wrong in public**: F1's 66 s
was withdrawn by #2847, so the ladder term is *not* a citable input. If the
measured end-to-end median lands materially above **150 s**, the "well under
Apilo's five minutes" claim this run exists to support is **void** and must
not be quoted.

## 3. Results

**Run**: `results/f1-order-ingestion/latency-run1788893253`. Window
**2026-09-08T18:40:52Z → 2026-09-08T19:16:03Z**, 25 serial samples.
Third launch — the two aborted ones are § 3.8.

### 3.1 The conditions actually in force, read back rather than asserted

| | |
|---|---|
| Poll cadence | **`*/1 * * * *`** — from the worker's own `Registered scheduler task: allegro-orders-poll (…, cron: */1 * * * *)` |
| Scheduler tasks registered | **27** |
| `master.product.syncAll` / `master.inventory.syncAll` / `master.product.reconcile` | **none registered** (AC2) |
| `guard_scheduler_off` | **deliberately waived**, logged as such |
| Image / tree | image `4ff884d8e`; `guard_build`: *"product paths identical"* to tree HEAD `95f508841` — my changes are harness-only |
| Lane caps (runner-reported) | `realtime=4/2 bulk=12/8 fiscal=2/1 fan-out=8/4` |
| Destination | **real local PrestaShop**; WooCommerce disabled for the arm |
| Limiter degraded-mode lines | **0**, over the worker container's entire life (AC4) |

### 3.2 The hop ladder — measured

All figures **measured**, seconds, n=25 on every hop. p90 is computed from the
samples (the shipped summariser prints p95; both are in `summary.txt`).

| hop | n | median | p90 | mean | max |
|---|---:|---:|---:|---:|---:|
| A order placed → scheduler poll enqueued | 25 | **23.25** | 55.05 | 29.59 | 57.63 |
| B poll enqueued → poll claimed | 25 | 0.88 | 0.98 | 0.54 | 1.01 |
| C poll claimed → child enqueued | 25 | 0.29 | 0.30 | 0.29 | 0.31 |
| D child enqueued → child claimed | 25 | 0.73 | 0.74 | 0.73 | 0.79 |
| E child claimed → `order_records` row written | 25 | 1.13 | 1.14 | 1.14 | 1.15 |
| F `order_records` → destination `syncedAt` | 25 | 2.90 | 2.95 | 3.08 | 5.86 |
| G child claimed → child terminal | 25 | 4.05 | 4.09 | 4.22 | 7.02 |
| **TOTAL placed → VISIBLE IN OPENLINKER** | 25 | **26.29** | **57.24** | 32.30 | 60.66 |
| **TOTAL placed → destination `syncedAt`** | 25 | **29.21** | **61.87** | 35.37 | 63.55 |

25 of 25 samples reached a destination create (**AC1**, ≥20 required).

### 3.3 The number, and the decomposition that matters more

> **An order placed at a random instant is visible in OpenLinker in a median
> of 26.3 s and a p90 of 57.2 s.** Of that, **OpenLinker's own work is 3.03 s
> (p90 3.14 s, max 3.17 s)**; the remainder is waiting for the next poll tick.

| | median | p90 | max | label |
|---|---:|---:|---:|---|
| OpenLinker's own work, poll enqueued → visible in OL | **3.03** | 3.14 | 3.17 | measured |
| OpenLinker's own work, poll enqueued → destination `syncedAt` | 5.93 | 6.06 | 8.03 | measured |
| poll wait (hop A) | 23.25 | 55.05 | 57.63 | measured |

That split is the honest way to state this. The total is **dominated by the
cron interval, not by OpenLinker's speed**, and the interval is operator-tunable
(`OL_ALLEGRO_POLL_INTERVAL_CRON`, on the worker since #2279). OpenLinker's own
contribution is three seconds and is remarkably tight — every one of 25 samples
landed between 2.70 s and 3.17 s.

### 3.4 Hop A is uniform by construction, and that is what makes it a measurement

The first two launches measured hop A as a **constant** because a serial arm
phase-locks to the cron (§ 3.8). With a uniform push jitter in place:

- push offsets within the minute, n=25: 10-second buckets
  **[6, 2, 2, 6, 6, 3]** against an expected 4.17 — **χ² = 5.00 on 5 df**,
  critical value 11.07 at p=0.05, so **not distinguishable from uniform**;
- hop A **mean 29.59 s** against the arithmetic expectation of **30.0 s** for
  uniform arrival over a 60 s period.

Hop A's **mean** is therefore the operationally meaningful summary of the poll
wait; its *median* (23.25 s) is a sample median of 25 uniform draws and carries
the corresponding variance. **AC3** required the hop-A median in [0 s, 60 s] and
p90 ≤ 60 s: 23.25 s and 55.05 s — **passed**.

Attribution: **25 of 25** samples were `next-tick` — the discovering poll was
the first one minted after the push in every case, and the re-attribution path
never fired. That is what its ~0.5%-of-a-minute probability predicts at n=25.

### 3.5 Against what the market publishes

Vendor figures are **as supplied in this task's brief and not independently
verified here**; OpenLinker's column is measured.

| Vendor | Published | OpenLinker (measured, this run) |
|---|---|---|
| ShipStation | 2 hours | |
| Linnworks | hourly (CSV) | |
| BaseLinker | 10 min default | **median 26.3 s** to visible in OL |
| Apilo / Channable / Pipe17 | 5 min | **p90 57.2 s** |
| BaseLinker paid accelerator | 1 min | p90 still inside it |

At the shipped `*/1` cadence OpenLinker's p90 lands **inside BaseLinker's paid
one-minute accelerator**, and roughly **5× better than the 5-minute
commitment** three vendors publish. § 2.1 pre-registered that a median above
150 s would void this claim; the measured median is 26.3 s.

### 3.6 Claim-instant provenance, and the one hop that depends on it

Poll job: **derived=19, latched=6**. Child job: **latched=25**. 0 of 25 children
ran ≥180 s (so the heartbeat-rewrite caveat does not bite) and 0 took more than
one attempt (**AC5**).

Hop B is the one hop whose value is **provenance-dependent, and the two sources
disagree**:

| source | n | median | range |
|---|---:|---:|---|
| latched (`lockedAt` observed while running) | 6 | 0.041 s | 0.007–0.064 |
| derived (`updatedAt − lastAttemptDurationMs`) | 19 | 0.909 s | 0.011–1.008 |

**Neither is unbiased.** The latched set is *selection-biased toward fast
claims*: the sample loop reads the row once, right after it appears, so it can
only catch `lockedAt` when the claim already happened. The derived value is
*systematically late*, because `lastAttemptDurationMs` measures the handler
while `updatedAt` is stamped after it. The runner polls Postgres every 1 s, so
the true claim latency should average ~0.5 s — which the two sources bracket.
Hop B is **under 1 s either way**, i.e. under 4% of the total, so this bounds
the total's precision at roughly ±0.5 s and changes nothing in § 3.3.

### 3.7 Verdict: DISCARDED — and neither reason touches the measured path

```
status=DISCARDED
reason=post_guard_attempts: 13 job(s) in the window show attempts>1
reason=post_guard_destination_creates: 0 order(s) carry a failed syncStatus
       entry, 273 lack syncedAt on the declared destination
```

Both were **attributed rather than assumed**, and both belong to *other
connections*:

| | measured source `758eb04c` | webhook connection `29a98157` |
|---|---:|---:|
| `marketplace.order.sync` jobs in window | 24 | 297 |
| of which retried (attempts>1) | **0** | 240 |
| succeeded | **24** | 0 |
| `order_records` lacking PrestaShop `syncedAt` | **0** | 279 |

So `post_guard_attempts` fires on the webhook connection's retries and
`post_guard_destination_creates` on its un-synced orders. **Every measured
sample completed on its first attempt and all 25 synced.**

This also confirms the guard defect the brief names, precisely: the `failed`
arm of `post_guard_destination_creates` carries **no destination predicate and
no source predicate** (`lib.sh`), while only its `missing` arm filters by
destination — which is how its counts come to exceed the population a report
is about. It reported `0` failed here only because WooCommerce was disabled for
this arm; **the WooCommerce connection was not disabled to make a guard pass**,
it was disabled by F1's pre-existing single-destination arrange.

The § 3.2 ladder is therefore reported with a **named scope**: `DISCARDED` by
two guards that assume a single-flow window, on facts belonging to a connection
this measurement makes no claim about.

### 3.8 What the two aborted launches cost, and the co-tenancy I did not control

Three findings, all of them mine rather than the product's:

1. **The scheduler-poll matcher matched nothing** and its message blamed the
   scheduler. Fixed and pinned in both directions (6 real keys match, all 354
   harness keys do not, 0 false positives) — commit `11d463242`.
2. **The serial arm phase-locks to the cron.** Push at offset `t` → wait
   `P − t` → ladder `L` → next push at offset `(t + (P−t) + L) mod P = L`,
   independent of `t`. Measured: samples 2/3/4 pushed at `:06`, `:06`, `:06`
   and waited 53.7 s, 53.6 s, 53.6 s. Fixed with uniform jitter — commit
   `1d191256f`.
3. **AC2 controlled the master sweeps and nothing else.** Turning the scheduler
   on activates *every* default-on task for *every* active connection. On this
   stand that drained a different connection's stub backlog into 297 retrying
   `marketplace.order.sync` rows, and fired `marketplace.offerQuantity.reconcile`
   (`*/2`) which 404s against the stub. **That is a gap in my own
   pre-registration, not a surprise in the product**: AC2 should have asserted
   which *OrderSource* connections were live, not only which sweeps were dead.
   Hop D's median of 0.73 s says the measured children never queued behind it,
   so the ladder is sound; the honest statement is that this window ran under
   *more* co-tenancy than it claimed to control, not less.

One job died in the window: `marketplace.offers.sync`, `Allegro API error
(404): …/sale/offer-events` — the stub does not implement that endpoint. It is
a scheduler task, off the order path, and would fire on any scheduler-on run.

Side effect worth knowing before the next window: the run left **286** unreached
`queued`/`running` rows behind, which fail the next scenario's
`guard_queue_empty`. They were purged with the same time-bounded idiom
`sustained-mixed-load.sh:1069` uses.

## 4. What this did not establish

- **The source is the Allegro *stub*, not Allegro.** Hops B/C/E contain the
  stub's own latency, not a real marketplace round-trip. Real Allegro API
  latencies are in `results-allegro-latency-2026-09-05.md`; a production figure
  is this ladder **plus** that.
- **Hop A is a property of the cron, not of OpenLinker.** It would be ~2.5 min
  at `*/5` with every other hop unchanged. Nothing here says the poll interval
  is well chosen — only what it costs.
- **Nothing about latency under load.** The arm is serial, one order in flight,
  by design. The burst-then-drain window
  (`results-burst-drain-2026-09-08-epyc32.md`) is the loaded counterpart, and
  its per-order ages are in the same units on purpose.
- **Nothing about a webhook-fed source.** A PrestaShop or WooCommerce order
  arrives by webhook (#904) and pays no hop A at all; this figure is the
  *cursor-journal* shape, which is what Allegro has.
- **n=25.** p90 resolves to rank 23/25 and p99 does not resolve at all. The
  three-second OL-own-work figure is tight (2.70–3.17 s across every sample);
  the hop-A-dependent totals carry the variance of 25 uniform draws.
- **AC2's co-tenancy control was partial** — see § 3.8 item 3.
- **No verdict-VALID order-path figure yet.** This run does not clear the
  campaign's standing gap; it produces a scoped figure and names exactly which
  guards refuse it and why.
