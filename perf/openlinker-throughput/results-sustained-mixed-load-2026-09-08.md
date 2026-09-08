# What does a Tuesday look like? Orders, catalogue sweeps and crons together, for hours

**Run**: `results/sustained-mixed-load/run1788846800`,
2026-09-08T05:54:21Z - 08:54:04Z. **One continuous measurement window,
10 783 s = 3.00 h, 319 samples.**
**Scenario**: `scenarios/sustained-mixed-load.sh`.
**Image**: `fabab189eda90f7a09bbe64301449b092b00d5ff`, rebuilt for this run
(see § 1.1), `guard_build ok`.
**Verdict: `DISCARDED`** on three guards - **read § 0.1 before quoting any
figure.**

**Why three hours and not four.** The window length was cut from the planned
four hours because rebuilding the two application images (§ 1.1) took ~40
minutes of session budget. Three hours still covers three firings of every
hourly cron, nine `master.product.syncAll` ticks, twelve
`master.inventory.syncAll` ticks, ~180 order polls and ~360 samples. It is
stated here rather than implied, and § 6 says what a longer window would add.

## This is the run the epic named and never got

The framing is **#2840's own**, in the epic issue body:

> Flows are **serial on one stand**. [...] Two consequences follow rather than
> being optional: every non-mixed figure carries the idle-stand label above,
> and **one explicitly non-isolating mixed-workload run** (sweep crons
> ticking, plus an order ramp, plus stock churn) is added to #2845 **in week
> 3, once #2847 and #2848 exist** [...], flagged in its manifest as one
> inside which attribution is impossible. **It is the only run whose
> orders/hour figure an operator can apply to their own Tuesday.** Note also
> that serialising flows does not separate F1 from F2:
> `marketplace.orders.poll` and `inventory.propagateToMarketplaces` are both
> registered on `fan-out` [...] alongside all three master sweep parents, so
> each flow must record whether the sweeps ran inside its window.
>
> — `gh issue view 2840`, issue body

So this window is not an extra; it is the one deliverable #2840 specified for
week 3 and never produced. Three obligations come with that sentence, and this
report is answerable for all three:

1. **The composition is specified**: sweep crons ticking, an order ramp, *and
   stock churn*. This run has the first two. **It has no stock churn** - see
   § 6, where that is named as a departure with an owner, not glossed.
2. **The manifest must be flagged as one inside which attribution is
   impossible.** § 2.8 states where that flag is and is not.
3. **Every flow must record whether the sweeps ran inside its window.** § 1.3
   records the whole resolved cron inventory, and § 3 reports which of them
   actually fired.

> ### A methodology note, because the withdrawal was published before this
>
> An earlier draft of this report **withdrew** the sentence above, on the
> grounds that it does not appear in any of the six `perf/openlinker-throughput`
> campaign documents. That grep was accurate and the conclusion drawn from it
> was wrong: the epic is a GitHub issue, and an issue's framing lives in its
> body, which was never searched. **Six files not containing a sentence is not
> evidence the epic never said it.** Verifying a claim means reading the source
> that would carry it, not reading a different source and concluding from
> silence. Recorded in `docs/lessons.md`, because this campaign has repeatedly
> made the mirror mistake - believing a figure because a comment asserted it -
> and both errors have the same root.

What the campaign *documents* add, and which still holds, is the surrounding
context: `campaign-2026-09-06.md` § 7 lists *"Any ceiling ... every figure
here is a floor"*, *"Cross-lane starvation. ADR-050's lane model is not
validated by any run here"* and *"Read-path cost at a large history of the
OTHER tables"*; and `results-retest-2026-09-07.md` § 5.3 calls the
lane-starvation window *"the natural next window"*. This run is that window,
widened to the composition #2840 asked for.

## 0. The answers, in one page

Window **10 783 s = 3.00 h**, 319 samples, 10 800 orders offered. **Verdict:
`DISCARDED`** - see § 0.1, which must be read before any figure is quoted.

| Question | Answer | Label |
|---|---|---|
| **What order rate survives competing catalogue sweeps and 30 crons?** | **200.6 orders/h** completed over the whole window (193.3/h steady, 227.3/h recovery) | measured |
| **What binds it?** | The `realtime` **per-scope cap of 2**, proven twice (§ 3.3). `2 slots / 31.44 s mean service = 229 orders/h` ceiling; the recovery phase reached 99.3% of it | measured + derived |
| **Was the destination rate limit binding?** | **No.** At ~11 req/order and 200 orders/h that is ~37 req/min against the 300/min the manifest now ships - ~12% utilisation | derived |
| **Does the queue converge?** | **No - it grows without bound at this offered rate**, +4 298 jobs/h over the last third against a ±1 259 noise band. But this is a property of the OFFERED LOAD, not a capacity result - see § 0.2 | measured |
| **Does anything accumulate over hours?** | **No.** Worker RSS +0.67 MB/h inside a 75-143 MB oscillation band; api and Postgres RSS slopes negative; Postgres page cache plateaued at ~1.5 GB; backends peaked at 46 of 200; database +29.8 MB | measured |
| **How many limiter-degradation episodes does 3 h carry, vs the 300 s extrapolation?** | **1 454** against a predicted 1 438-1 761. **The 300 s figure extrapolates linearly - 1.01x the low end.** Degradation is a steady ~8/min, it does not accumulate | measured vs extrapolated |
| **Does a destination fault strand orders at volume the way it does at 12?** | **The mechanism reproduced; the rate did not scale.** 1 of 413 (0.24%) against #2978's 17-42%. Stranding scales with orders IN FLIGHT, which the lane cap bounds - not with queue depth (§ 3.4) | measured |
| Did the sweeps actually run inside the window? | **Yes** - 9 `master.product.syncAll`, 45 `syncBatch`, 300 `syncFromSweep`, 12 `master.inventory.syncAll`, 3 `master.product.reconcile`, matching their crons exactly (§ 3.1) | measured |
| What did a second arm with `OL_JOB_INTAKE_DEDICATED_REDIS=true` show? | **Not run** - § 6 | not measured |

> Every figure is labelled **measured**, **derived** or **extrapolated**.
> § 6 "What this did not establish" is not optional reading.

### 0.1 This window is `DISCARDED` by the harness's own rule, and must not be presented as a clean capacity measurement

`verdict.txt` reads `DISCARDED`, on three guards:

| Guard | Count | Structural? |
|---|---|---|
| `post_guard_limiter_degraded` | **1 454** degraded-mode lines | yes - shipped default is the SHARED intake client |
| `post_guard_destination_creates` | 650 orders with a failed `syncStatus` entry, 729 lacking `syncedAt` | yes - § 1.4(a) two-member fan-out, and no in-flight allowance |
| `post_guard_attempts` | 474 jobs with `attempts > 1` | yes - any 3-hour window contains retries |

**The limiter count is the one that matters, and it is not waived.** 1 454 is
non-zero, the guard's rule is that non-zero discards, and this report does not
relabel it, exempt it, or argue it away. **This is therefore not a clean
capacity measurement.**

What the window *is* legitimate evidence for, stated so the distinction is not
lost:

1. **A `before` figure for the intake-client A/B.** This is the baseline arm -
   shipped defaults, SHARED intake client (read back from the worker's own log,
   § 2.0), which is precisely the configuration the degradation comes from. A
   baseline that the harness rejects *for carrying the very defect the fix
   removes* is still the right before-figure for that fix, provided it is
   labelled as one. It is not a general-purpose capacity number.
2. **The concurrency finding (§ 3.3), which does not depend on the limiter at
   all.** The bind is the lane's per-scope cap of 2, established from job
   timestamps by two independent methods. And the direction of the
   contamination is knowable: a degraded limiter falls back to per-process
   pacing, and at **one replica per-process pacing equals the configured
   rate**, so degradation cannot have *inflated* the throughput - each
   fallback adds latency to a limiter call, which raises mean service time and
   *lowers* the derived ceiling. The capacity figure is therefore a
   conservative lower bound with respect to this defect. That is an argument
   about the mechanism, not a waiver of the guard.
3. **The fault-stranding result (§ 3.4)**, which is a claim about a code path -
   `Promise.allSettled` swallowing a per-destination failure - and is
   established by one order's own persisted rows, not by a rate.

### 0.2 `verdict = growing` is a property of the OFFERED LOAD, not a capacity result

Stated explicitly because `+4 298 jobs/h` is the kind of number a later reader
will quote as though it measured the system:

The scenario **deliberately offers 60 orders/min = 3 600 orders/h** in order to
saturate (§ 2.2), against a drain of ~200 orders/h. The queue therefore *must*
grow at roughly `3 600 - 200 = 3 400` order-syncs/h plus whatever the 30 crons
contribute, and the measured +4 298 jobs/h is that arithmetic, observed.

**It is not a defect, not a capacity figure, and not a statement about
OpenLinker.** It is what saturation looks like, and saturation is the method:
under a standing backlog the achieved throughput *is* the service rate, which
is why the 200.6 orders/h above is the capacity answer and the growth rate is
merely the confirmation that the offered rate exceeded it.

The actionable form of the same observation is the **threshold**: at shipped
defaults, with the sweeps and crons running, **an install offered more than
~200 orders/h will accumulate queue without bound.** Offered less, it
converges. That is the number an operator can act on; `+4 298 jobs/h` is not.

## 1. Conditions

### 1.1 The stand had to be repaired and rebuilt before it could be measured

Two things were wrong with the stand as found, and both are findings rather
than housekeeping.

**`lab-api` was dead.** It read `Exited (1)` - killed by a peer's Redis-outage
test roughly two hours earlier and never restarted, because **no service in
`docker-compose.lab.yml` declares a restart policy** (`api` carries none;
`migrate` carries an explicit `restart: 'no'`). Nothing in the harness noticed:
`guard_stand_exclusive` arbitrates scenarios, `post_guard_containers_stable`
compares `.State.StartedAt` **within** a window, and neither answers "is the
stand actually up" before one opens. A scenario would have died at its first
`ol_api` call with a connection error rather than a diagnosis.

**Both application images predated the change this run is about - and that is
a finding, not setup friction.** They carried
`org.opencontainers.image.revision = 8c1c0bbe`, while the tree has moved past
it under `libs/`: #2982 raised PrestaShop's manifest `defaultRateLimit` from
60 to **300 req/min** (`prestashop-plugin.ts:125`).

So a run at "shipped defaults" against those images would have been pacing the
destination at **60 req/min while its report claimed 300** - and since the
governing arithmetic is
`orders/hour = requestsPerMinute / requests-per-order x 60`, the headline
figure would have been wrong by a factor of five with every guard green.
`guard_build`'s tree comparison refused them, and it was right to: the mistake
it prevents here is not a stale binary in the abstract, it is publishing a
number under the wrong headline condition. **That guard has now refused three
agents across this campaign and been correct every time**, which is worth
stating because a guard that only ever refuses is easy to start working
around.

The rebuild cost ~40 minutes of session budget, which is the whole reason this
window is 3 hours rather than 4. That trade is stated rather than hidden.

`ol-perf:api` and `ol-perf:worker` were therefore rebuilt from this branch's
HEAD with `--build-arg OL_GIT_SHA=$(git rev-parse HEAD)`, and `lab-api` and the
worker recreated onto them.

### 1.2 Dataset and posture

| Axis | Value | How it was read |
|---|---|---|
| Stand | `lab`, compose project `lab` | container labels |
| PrestaShop catalogue | 50 006 products, all active | `ps_product` |
| OpenLinker catalogue | 60 006 products, 111 678 variants | `products` / `product_variants` |
| `order_records` at window start | 2 003 176 | `COUNT(*)` |
| `sync_jobs` at window start | 140 718 rows, **0** queued or running | `COUNT(*)`, `guard_queue_empty` |
| Allegro offer mappings (`perf-allegro-a`) | 200 | `identifier_mappings` |
| Active connections | 5 (PrestaShop, two Allegro, PrestaShop webhook-ingress, WooCommerce) | `connections` |
| Worker replicas | 1 | compose service label, discovered |
| Runner | **enabled** | `guard_runner_state enabled` |
| **Scheduler** | **ENABLED** - the departure this run exists to make | recorded, not guarded |
| Scheduler tasks registered | **30** (full inventory in § 1.3) | worker's own `Registered scheduler task:` lines |
| Lane caps | `realtime=4/2 bulk=12/8 fiscal=2/1 fan-out=8/4` | worker's own startup line |
| Job intake Redis client | **SHARED** (`OL_JOB_INTAKE_DEDICATED_REDIS` unset) | worker's own startup line |
| Stub | `ol-perf:allegro-stub-2978`, latency `eventsMs 276` / `checkoutMs 1106` | `/__stub/config` |
| Destination `config.rateLimit` | override removed, so the manifest's 300/4 applies | `connections.config` |
| `operational_settings` cadence row | `{}` (empty - no row) | `scheduler_cadence_row` |
| `max_connections` / `OL_DB_POOL_MAX` | 200 / 40, budget 80 | `guard_connection_budget` |
| `OL_LOG_BODY_MAX_BYTES` | 8192 | `guard_log_level` |
| `OL_DEMO_MODE` | false | `guard_demo_mode_off` |
| Host | 28 cores, 15 GiB, 847 GB free | `free`, `df` |

The stand carried an explicit `{maxConcurrent: 4, requestsPerMinute: 60}` on
the destination connection, left behind by the weak-shop ramp (#2982's own
measurement). That is **not** the shipped default any more, and a
connection-level override beats the manifest, so the override was removed for
this window and restored afterwards. Removing the key rather than writing
`300` is the truer reading of "shipped defaults": it is the state a connection
an operator never touched is in.

The stub's pinned upstream latencies are **identical to F1's** (`eventsMs`
276, `checkoutMs` 1106 - the #2861 Allegro sandbox p50s), so the order-path
figures here are comparable with that report's despite the stub image having
been built by a peer campaign. Its `gitSha` reads `2978-f10`, which is
recorded rather than glossed: the image is not from this branch.

### 1.3 What "unfiltered crons" actually resolved to

Thirty tasks, read back out of the worker's own log rather than inferred from
the code. This is the co-tenancy every previous window in this campaign
switched off:

| Cron | Task | Job type |
|---|---|---|
| `*/1` | allegro-orders-poll | `marketplace.orders.poll` |
| `*/2` | allegro-quantity-ack-reconcile | `marketplace.offerQuantity.reconcile` |
| `*/5` | inventory-provenance-backfill | `inventory.provenance.backfill` |
| `*/5` | erli-orders-poll, woocommerce-orders-poll | `marketplace.orders.poll` |
| `*/10` | prestashop-orders-poll, reservation-consume-sweep | `marketplace.orders.poll`, `inventory.reservations.consume` |
| `*/15` | **master-inventory-sync**, automation-deadline-sweep, prestashop-fulfillment-status-sync, allegro-shipment-status-sync | `master.inventory.syncAll`, … |
| **`*/20`** | **master-product-sync**, reservation-shortfall-sweep, pending-recovery | `master.product.syncAll`, … |
| `*/30` | allegro-offers-sync, returns-orphan-reconcile, regulatory-status-reconcile, inpost/dpd-shipment-status-sync | … |
| hourly | **master-product-reconcile** (`0`), reservation-expiry-sweep (`15`), stale-offer-pause-sweep (`17`), **order-fx-stamp-sweep** (`23`), destination-taxonomy-sync (`23`), **orders-tax-rate-backfill** (`37`), order-hold-reconcile (`0`), allegro/erli-offer-status-sync (`0`), woocommerce-product-status-sync (`0`) | … |
| daily | pickup-point-refresh (`0 3`) | `shipping.pickupPoint.refreshFrequent` |

Three of the hourly ones are worth calling out because they sweep the
**2 003 176-row** `order_records` history this stand carries, which is the
"read-path cost at a large history of the OTHER tables" the campaign doc § 7
names as unmeasured: `order-fx-stamp-sweep`, `orders-tax-rate-backfill` and
`master-product-reconcile` (which enumerates OL's own product mappings against
a 50 006-product catalogue).

### 1.4 Two contaminants this window carries that F1 controlled for

Both were found by querying the window mid-run rather than by planning for
them, and both are stated here because a reader comparing this run's
orders/hour against F1's needs them.

**(a) The destination fan-out has two members and one of them always fails.**
Measured over the window's own orders:

| destination | status | entries |
|---|---|---|
| `perf-woocommerce` | **failed** | 414 |
| `perf-prestashop` | synced | 413 |
| `perf-prestashop` | failed | 1 |

Every order fails WooCommerce with
`No WC product mapping for OL product ol_product_…`. That is the stand
limitation the campaign already records - the 10 000 seeded WC `Product`
mappings name no numeric WooCommerce product id, and
`WooCommerceOrderProcessorAdapter.resolveLineItems` needs one. **F1 disabled
WooCommerce before its windows precisely so the fan-out had one member**; this
run did not, so:

* `post_guard_destination_creates` fires on 414 failed entries for a reason
  that has nothing to do with mixed load. The health signal is the PrestaShop
  row: **413 synced against 1 failed**, i.e. the destination create succeeds
  on essentially every first attempt.
* the WooCommerce failure is a **local mapping lookup, not an HTTP call**, so
  it consumes no destination budget and fails fast. Its cost to the order rate
  is therefore small - but it is not zero and **this run did not measure it**,
  so the orders/hour figure below should be read as a floor with respect to
  this contaminant.
* `syncStatus[].syncedAt` is stamped inside a `Promise.allSettled` over every
  destination and so records whichever finished last. F1 removed that bias
  structurally; this run inherits it. It affects any `syncedAt`-derived
  timing, which is why the throughput figure here is taken from
  **`marketplace.order.sync` job terminal state** instead.

**(b) 328 jobs died on stub endpoints that do not exist.** Turning the crons on
reached Allegro endpoints no previous window in this campaign called, and the
stub does not implement them:

| job type | dead | attempts | error |
|---|---|---|---|
| `marketplace.offer.updateFields` | 328 | **0** | `Allegro API error (404): .../sale/product-offers/perf-allegro-a-offer-100` |
| `marketplace.offers.sync` | 8 | **0** | `Allegro API error (404): .../sale/offer-events?limit=100` |
| `destination.taxonomy.sync` | 2 | **0** | — |

`attempts = 0` on all of them, so they were classified non-retryable and
killed on the first pass rather than burning a ladder - **correct behaviour**,
since a 404 is deterministic. This is a **harness coverage gap, not a product
defect**: `ol-perf:allegro-stub` implements the order-feed endpoints F1 needed
and not the offer-management ones `allegro-offers-sync`,
`allegro-offer-status-sync` and the field-update path call.

What it does to the figures: those jobs are load - they cost claim cycles and
stub requests - but they consume no PrestaShop budget, so the order path's
rate limit is untouched. And their contribution to queue **depth** is
negligible: 50 `marketplace.offer.updateFields` rows were queued against a due
queue of ~8 000, i.e. **0.6%**, so the divergence finding does not rest on
them. Extending the stub is the honest fix and belongs to whoever next runs
this scenario.

## 2. Method

### 2.0 The closest call in this campaign: a log reader that inverted its own answer

Before any method: the single most consequential configuration fact in this
programme was very nearly recorded backwards, and the mechanism generalises to
every value any scenario reads out of a log.

`sync-worker.module.ts` logs on both branches, precisely so a harness can
assert which one it took:

```
Job intake Redis client: SHARED (OL_JOB_INTAKE_DEDICATED_REDIS is not true)
Job intake Redis client: DEDICATED (OL_JOB_INTAKE_DEDICATED_REDIS=true) - ...
```

This scenario's reader was `case "$line" in *DEDICATED*) ... ;; *SHARED*)`.
**The SHARED message contains the string `DEDICATED`, inside the variable's
own name**, so the `*DEDICATED*` arm matched first and the scenario recorded
`DEDICATED` for a worker that had logged `SHARED`.

Why it matters more than an ordinary bug: `results-retest-2026-09-07.md`
measured **207 orders/h** on the shared client against **2 233** on the
dedicated one - **10.8x**, the largest single effect in the campaign. A report
claiming the fixed configuration while running the broken one would have been
wrong by an order of magnitude *about its own premise*, with a manifest
asserting the wrong value, and **nothing in the numbers would have looked
odd** - a mixed-load run is expected to be slower than an isolated one, so
~200 orders/h under a "DEDICATED" label reads as co-tenancy cost rather than
as a misread condition. It was caught only because a five-minute smoke run was
executed and its output read line by line against `docker logs`.

The reader now takes **the one token immediately after the colon** and nothing
else, and anything it does not recognise reads `unknown` rather than
defaulting. The general rule this is the strongest evidence yet for, and which
#2229 states for reported-versus-enforced generally: **substring-matching a
log line is not reading a value.** Extract the field, then test it against the
closed set of values it may hold.

The same class of defect, found in the same smoke run, is at § 7 item 3
(the scheduler-task count read six seconds before the singleton lease was
acquired, recording 0 while 30 were registered).

### 2.1 The one guard this scenario inverts, and the authority for doing so

`guard_scheduler_off` is deliberately **not called**. Its own docblock
authorises the departure - *"a scenario that wants it on should not call this
guard at all and should instead record its posture via manifest_set
directly"* - and the scenario records three things in its place: the posture,
the full set of scheduler tasks read back out of the worker's own
`Registered scheduler task:` lines, and the `operational_settings` cadence
row, which overrides `cronEnvVar`/`defaultCron` and is invisible to an
env-var-only reading.

Nothing else is waived. `guard_queue_empty`, `guard_build`,
`guard_connection_budget`, `guard_pool_recorded`, `guard_log_level`,
`guard_demo_mode_off` and `guard_runner_state` all ran.

`PERF_MAX_ATTEMPTS` is **not** applied, and that is a choice rather than an
omission: the jobs in this window are minted by the real scheduler, not by
`enqueue_perf_job`, so they carry the `sync_jobs` entity default of 10
attempts with backoff - which is what a deployment carries.

### 2.2 The arrival rate is chosen to saturate

Under a standing backlog, achieved throughput **is** the service rate. That
single number is both the "orders/hour under mixed load" figure and the
convergence threshold, since an offered rate below it converges and above it
diverges - so one saturating rate answers both questions from one continuous
window, instead of from a step ladder whose segments each carry their own
settle and their own noise.

The rate has to clear the plausible ceiling. The governing arithmetic
`results-retest-2026-09-07.md` establishes is
`orders/hour ceiling = requestsPerMinute / requests-per-order x 60`; at 300
req/min and the measured ~11 requests per order that is **~1 636 orders/h**
[derived]. The run offers **60 orders/min = 3 600/h**, about 2.2x clear of it.

It is deliberately not higher. The Allegro poll takes up to 100 events per
tick (`limit: 100`, hardcoded), so an arrival rate under 100/min keeps the
stub's own backlog near zero and moves the whole backlog into `sync_jobs`,
where it is observable. A rate above 100/min would bank an unobserved backlog
inside the stub's memory instead - less useful, and a real OOM risk over
hours.

### 2.3 The sampler is slowed down, on purpose

`SAMPLE_INTERVAL_SECS` defaults to **1** in `lib.sh`, which is right for a
300-second window and wrong for a four-hour one: `sample_queue` shells out to
`docker stats --no-stream` on every tick, and at 1 Hz over four hours that is
~14 400 invocations of a command that takes on the order of a second. That is
a material, self-inflicted load on the thing being measured. Both samplers ran
at **30 s**, and the figure is stated here so the sampling cost is a condition
rather than a hidden one.

### 2.4 What the supplementary sampler adds

`sample_queue` records the queue scoped to the scenario's connection ids plus
`pg_database_size` and a `docker stats` blob. A soak needs four things it does
not carry, so a second CSV (`mixed-timeseries.csv`) carries them:

* **an install-wide queue count.** The all-zero system connection id owns
  `marketplace.offer.pauseStale` jobs and is in no scenario's id list, so a
  scoped count under-reports the install's real depth - which is the headline.
* **Postgres backends** against `max_connections`.
* **a per-jobType breakdown** of what the queue is made of.
* **an incremental limiter-degradation count.** Sampled per interval, never
  window-to-date: a cumulative grep re-reads the whole log every tick, which
  is O(n^2) over a four-hour log. Both `docker logs` bounds are **bare**
  epochs - the `@epoch` form is accepted and matches nothing on Docker 29.5.2
  (#2851), the bug that silenced this exact measurement across the whole
  campaign.

They are not folded into `sample_queue` because that would change the header
`f1-summarize.py` and `f2-summarize.py` already parse, for one scenario's
benefit.

#### 2.4.1 `docker stats` cannot answer the memory question, and a side sampler was added mid-run

Both samplers take memory from `docker stats`, and **on this host that number
includes the cgroup's page cache**, which for a database container is most of
it. Measured directly at t+2645s:

| `lab-postgres` | value |
|---|---|
| `docker stats` MemUsage | **1.412 GiB** |
| cgroup `total_rss` (anonymous) | **17.4 MiB** |
| cgroup `total_cache` (file-backed) | **1.53 GiB** |
| of which `total_active_file` | 1.26 GiB |

So the 7.7x rise from 188 MiB looks like a leak and is not one: it is the
kernel caching database file pages as the hourly sweeps scan a 2 003 176-row
`order_records` (F5 measured that heap at ~613 MB) and a 50 006-product
catalogue. It is reclaimable, and the container carries no memory limit
(`HostConfig.Memory = 0`), so it is bounded by host pressure rather than by a
cap. `shared_buffers` is only 160 MiB, which is what rules out shared memory
as the explanation.

**The general point: `docker stats` MemUsage is the wrong instrument for
detecting a leak in any container that reads files, and this campaign's
samplers use it.** A `rss-timeseries.csv` reading cgroup `total_rss` and
`total_cache` per container was therefore started **mid-window, at ~t+2 900s**,
and covers only the last ~2 h 10 m of the 3-hour window. That late start is a
limitation of this run, not of the instrument: the first 48 minutes have
`docker stats` figures only, and for `lab-postgres` those cannot be read as
memory growth. The scenario should sample cgroup RSS from `window_start` in
future runs.

### 2.5 The convergence verdict, and the dishonesty it exists to avoid

`drivers/queue-curve.awk` fits a least-squares slope over the **last third**
of the samples and compares it against that third's own standard deviation,
expressed as a per-hour slope over the sub-window it spans.

* An endpoint comparison cannot tell a plateau from a peak. The last third is
  where a plateau would be if there were one.
* Without the noise band, a curve jittering by a few jobs around a flat mean
  would be labelled `growing` or `converging` at random depending on which
  sample happened to be last. `plateau` therefore means *the slope is not
  distinguishable from jitter*, not *the slope is zero*.
* There are exactly three verdicts and **no fourth "steady state" value**. A
  `growing` verdict carries an explicit note that the window ended before the
  queue converged, and that the last sample is not an equilibrium. That is the
  specific dishonesty a long run has to avoid.
* A sample the harness could not read is written `-1` and is **dropped and
  counted**, never averaged in as zero - which would drag a rising curve
  toward the flattering answer.
* Below 12 surviving samples it **refuses** rather than labelling, because the
  tail would then be three points and the band would come from three samples.

`drivers/queue-curve-test.sh` (17 assertions) proves each verdict reachable
against synthetic curves whose right answers are known by construction,
including the two inverse cases that matter: a curve that rose and then
flattened must read `plateau` despite a clearly positive overall slope, and a
curve flat until the end must read `growing` rather than being softened.

### 2.6 The destination fault

`docker pause lab-prestashop` at T+9 000 s for 300 s, then unpause.

`pause` rather than `stop` for two reasons: it leaves `.State.StartedAt`
untouched, so `post_guard_containers_stable` still means what it means; and it
produces the shape #2978 measured at 12 orders - a destination that accepts
the connection and never answers - rather than a connection refusal. The
PrestaShop client's own timeout is **30 s**
(`prestashop-webservice.client.ts:109`), so a 300 s pause is roughly ten
attempt-cycles deep rather than a single hang.

### 2.7 Which post-guards fire by construction

A saturating multi-hour window at shipped defaults trips several guards
structurally. Each was still run, because the count is the finding.

| Post-guard | Why it fires here | What to read instead |
|---|---|---|
| `post_guard_limiter_degraded` | The shared intake client is still the default (`sync-worker.module.ts:149`), and the retest measured 40-49 episodes per 300 s window | the episode count and its rate, § 5 |
| `post_guard_destination_creates` | No in-flight allowance, no upper time bound - any window ending with work in flight fires it | the **failed** count, not the missing one |
| `post_guard_attempts` | Any window long enough to contain one retry | § 5 retries table |
| `post_guard_deferrals` | Any window long enough to contain one rate-limit deferral | § 5 retries table |

**The verdict is expected to read `DISCARDED`, and a reader must not take that
as "the run failed".** § 3.0 draws the may-travel line explicitly, the way
F7 § 8 does.

### 2.8 Attribution is impossible inside this window, and where that is recorded

#2840 requires this run to be *"flagged in its manifest as one inside which
attribution is impossible"*. Being precise about where that flag is:

* The manifest **does** record every fact a reader needs to reach that
  conclusion: `schedulerPosture: "ON (guard_scheduler_off deliberately not
  called)"`, the 30 registered tasks with their crons, `ordersPerMin`, the
  destination rate limit in force, and `jobIntakeRedisClient`.
* It does **not** carry a single boolean saying so in as many words. The
  requirement was read out of the epic body *after* this window had already
  opened, and `manifest.json` is written before the window by construction.
  **Editing a manifest after its window is exactly the kind of retrofit that
  makes a results directory untrustworthy**, so it was not edited; the field
  is added to the scenario for subsequent runs instead.

The substance of the flag, stated here where a reader will meet it: **no
figure in § 3 may be attributed to any single flow.** Thirty crons, an order
ramp and the sweeps share one worker process, one connection pool, one Redis
limiter and - for PrestaShop - one rate-limit budget. When the order rate
comes out below F1's isolated figure, this run cannot say how much of the
difference is the catalogue sweeps, how much is the twenty-seven other tasks,
and how much is the hourly sweeps over a 2M-row `order_records`. That is not a
shortcoming of the instrument; it is the definition of the window. The
per-jobType queue breakdown is a *depth* attribution and must not be read as a
*cost* one.

## 3. Results

Five readings, in order of how much they matter.

### 3.1 The sweeps and crons genuinely ran - the co-tenancy is real

#2840 requires each flow to record whether the sweeps ran inside its window.
They did, and the counts match the crons exactly, which is the check that the
scheduler was not merely enabled but firing:

| job type | succeeded | expected from its cron over 3 h |
|---|---|---|
| `master.product.syncAll` | **9** | `*/20` -> 9 |
| `master.product.syncBatch` | 45 | 5 batch children per tick x 9 |
| `master.product.syncFromSweep` | 300 | per-product children |
| `master.inventory.syncAll` | **12** | `*/15` -> 12 |
| `master.inventory.syncBatch` | 12 | |
| `master.product.reconcile` | **3** | hourly -> 3 |
| `marketplace.orders.poll` | 378 | `*/1` allegro x2 + `*/5` wc/erli + `*/10` ps |
| `orders.taxRate.backfill` | 9 | hourly x 3 `OrderSource` connections |
| `marketplace.order.fxStampSweep` | 9 | hourly x 3 |
| `inventory.propagateToMarketplaces` | 327 | per-order cascade |
| `automation.trigger.deadlineSweep` | 36 | `*/15` x 3 |

The two hourly sweeps over the 2 003 176-row `order_records` history
(`orders.taxRate.backfill`, `marketplace.order.fxStampSweep`) both completed
every tick, at p50 9.6 s and 9.8 s per attempt - so the "read-path cost at a
large history of the OTHER tables" the campaign doc § 7 names as unmeasured is,
for these two sweeps at this row count, **not a problem**.

**One thing the crons did that nothing had measured before.**
`marketplace.fulfillment.statusSync` on the destination connection took a
**p50 of 474 s** per run - just under 8 minutes - and runs every 15 minutes, a
**~53% duty cycle** holding one slot continuously for more than half the
window. Its sibling on `perf-webhook-ingress` took p50 9.8 s, so the cost is
specific to the connection with the 50 006-product catalogue. It registers in
the **`bulk`** lane (`handler-registration.service.ts:282`), so it competes
with the catalogue-sweep children rather than with the order path - which is
why it does not appear in the capacity model below, and why it is worth a look
by whoever owns #834.

### 3.2 The capacity answer: 200.6 orders/h

`marketplace.order.sync` jobs reaching `status = 'succeeded'`, which is the
job-terminal measure rather than a `syncedAt`-derived one (§ 1.4(a) explains
why):

| phase | duration | completed | orders/h |
|---|---|---|---|
| steady | 6 574 s | 353 | **193.3** |
| fault | 275 s | 1 | 13.1 |
| recovery | 3 865 s | 244 | **227.3** |
| **whole window** | **10 783 s** | **601** | **200.6** |

Ingestion ran slightly ahead at 217.3 orders/h (651 rows), because an
`order_records` row is written before the destination create and a job that
fails the create and retries has already written one.

**Context, with the comparison stated carefully.** The retest campaign measured
**207 orders/h** for the *isolated* order path, same SHARED intake client, with
the destination limited to 60 req/min. This window measured **200.6 orders/h**
with the destination at 300 req/min *and* the full cron co-tenancy. Two changes
moved in opposite directions at once and **this run cannot separate them** -
that is exactly what § 2.8's attribution flag means. What can be said is the
conjunction: **raising the destination limit 5x did not buy enough to offset
the co-tenancy**, and § 3.3 explains why raising it could not have helped much
in the first place.

### 3.3 What binds: the realtime per-scope cap of 2, confirmed twice

Not assumed from the config. Two independent measurements over the steady
phase, both from job timestamps at real precision rather than the sampler's
30 s floor:

**(a) Little's law**, `L = lambda x W`:

| term | value |
|---|---|
| n (succeeded order.sync, steady) | 405 |
| span | 6 560.8 s |
| lambda | 0.061 73 /s |
| W (mean `lastAttemptDurationMs`) | 31.44 s (p50 30.31 s) |
| **L** | **1.941** |

**(b) Direct interval overlap.** Each succeeded job's execution interval is
`[updatedAt - lastAttemptDurationMs, updatedAt]`; counting intervals spanning a
probe instant *is* the concurrency there. 105 probes at 60 s spacing:

| statistic | value |
|---|---|
| mean | 1.95 |
| p50 / p90 | 2 / 2 |
| **max** | **2** |
| probes at concurrency >= 2 | 95.2% |
| probes above 2 | **0** |

Distribution: concurrency 1 at 5 probes, **concurrency 2 at 100 probes**, never
3. The cap is binding, hard, essentially all of the time.

**The capacity model that follows**, and it closes:

```
ceiling = perScope_cap / mean_service_time
        = 2 / 31.44 s
        = 0.0636 /s = 229 orders/h        [derived]
```

The recovery phase measured **227.3 orders/h**, i.e. **99.3% of that ceiling**.
So the order path is slot-bound, not budget-bound: at ~11 requests per order
and 200 orders/h the destination sees ~37 req/min against the 300/min the
manifest now ships - about **12% utilisation** [derived; the per-order request
count is the retest's measurement, not re-measured here].

Both figures are **lower bounds on true occupancy**, for a reason worth
stating: `lastAttemptDurationMs` records the last attempt only and is reset on
every enqueue (#2611), so a job that retried contributes only its final
attempt while its earlier attempts also held a slot.

### 3.4 The destination fault: stranding scales with CONCURRENCY, not with queue depth

This is the question #2978 left open. It found that a destination fault
stranded **2-5 orders per window at 12 orders in flight**, with jobs reporting
`succeeded` and never retrying, and could not say what happens at volume.

**The mechanism reproduced exactly. The rate did not scale.**

`docker pause lab-prestashop` at t+6601s, `docker unpause` at t+6901s -
exactly 300 s, with ~8 000 jobs queued and 4-8 running.

**What the fault did to throughput** (samples, `measured`):

| t+ | phase | due | running | ingested | completed |
|---|---|---|---|---|---|
| 6574 | steady | 7 835 | 4 | 403 | 353 |
| 6608 | **fault** | 7 896 | 4 | 405 | 355 |
| 6745 | fault | 8 016 | 6 | 406 | 356 |
| 6883 | fault | 8 140 | 8 | 406 | 356 |
| 6918 | recovery | 8 196 | 5 | 407 | 357 |

Order processing **stopped almost completely** for the fault's duration - 1
order ingested and 1 completed across 275 s of samples - while `running` rose
from 4 to 8 as jobs sat on the client's 30 s timeout. Arrivals continued, so
the queue kept growing at its usual rate. Throughput resumed immediately on
unpause. Nothing needed operator intervention.

**What it stranded: exactly one order, permanently and silently.**

`ol_order_535e48890c8b42fea3353ccf3828586f`, created 07:44:14 - 19 seconds
before the pause, so it was mid-dispatch when the shop went away. Its
`syncStatus`:

```json
[ { "destinationConnectionId": "…prestashop", "status": "failed",
    "error": "Request timeout after 30000ms: http://prestashop/api/carriers?display=full&…" },
  { "destinationConnectionId": "…woocommerce", "status": "failed",
    "error": "No WC product mapping for OL product perfseed_product_s200063…" } ]
```

And its job:

```
status=succeeded  outcome=ok  attempts=0  lastError=-  lastAttemptDurationMs=137792
```

**The job reports success, with no error, having reached no destination.**
`attempts=0` and an empty `lastError` mean nothing failed as far as the runner
is concerned; `dispatchToDestinations`' `Promise.allSettled` swallowed both
per-destination failures (`order-sync.service.ts`). The order's `updatedAt`
has not moved in the 13+ minutes since, and **nothing will ever retry it** -
there is no reconcile sweep for a per-destination dispatch failure. This is
precisely the defect `post_guard_destination_creates`' docblock calls itself
*"the only guard that can see"*, observed in the wild rather than reasoned
about.

**The scaling answer:**

| run | orders in flight | offered | stranded | rate |
|---|---|---|---|---|
| #2978 | ~12 | 12 orders | 2-5 | **17-42%** |
| this run | 4-8 running, ~8 000 queued | 413 ingested | **1** | **0.24%** |

So stranding scales with the number of orders **in the destination-dispatch
step at the instant the destination fails** - which ADR-050's `realtime`
per-scope cap of 2 bounds - and **not** with queue depth or offered volume. A
deeper queue does not widen the exposure window; it lengthens the tail of work
that will be dispatched *after* the destination returns, and that work is
unaffected.

Three consequences, and the third is the one that matters:

1. **A 300 s outage costs ~300 s of throughput and no operator action.** The
   retry ladder absorbed 305 order-sync jobs whose attempt landed in the fault
   window - they were requeued, not failed - and no `marketplace.order.sync`
   job died in the whole window (`dead = 0`).
2. **The absolute stranded count does not grow with volume**, which is the
   reassuring half and is why #2978's 17-42% must not be extrapolated to a
   busy install.
3. **But every stranded order is permanent, and 0.24% of a real order book is
   not a rounding error.** At the ~210 orders/h this window sustained, one
   300 s destination hiccup per day silently loses an order roughly every four
   days, with the job log reading clean. The fix is not more retries - it is
   that a swallowed per-destination failure must leave something for a sweep to
   find, which no code path currently does.

**One caveat that bounds this finding, stated because it is easy to miss.**
`docker pause` produces a **timeout-shaped** fault: the connection is
accepted and never answered, and the client aborts at 30 s
(`prestashop-webservice.client.ts:109`). A timeout is classified retryable,
which is why 305 jobs were requeued. #2978 used a fault **proxy**
(`ol-perf:ps-fault-proxy` is still on this host), which can return HTTP error
*responses* - and an error response may be classified differently by the
per-plugin retry classifier. **This run therefore says nothing about the
error-response-shaped fault #2978 measured**; it measures the timeout-shaped
one and finds the same swallowing mechanism at the end of it. Whether an
error-response fault strands more is unmeasured here.

### 3.5 The queue curve

| statistic | value |
|---|---|
| samples used / dropped | 319 / 0 |
| depth first / min / max / last | 58 / 56 / **12 832** / 12 832 |
| deferred (backing off) at end | 184 |
| overall slope | +4 180.6 jobs/h |
| **last-third slope** | **+4 298.0 jobs/h** (n=108 over 3 727 s) |
| noise band | ±1 259.3 jobs/h (sd 1 303.8) |
| **verdict** | **`growing`** - 3.4x the band |

The overall slope (+4 181/h) and the last-third slope (+4 298/h) agree within
3%, so the divergence is **linear** - the apparent deceleration in the first
half hour was the crons' initial burst clearing on top of a constant floor, not
the queue approaching a plateau. **The window ended before the queue converged,
and it was never going to at this offered rate**; the last sample is not an
equilibrium. § 0.2 states why this is a property of the offered load.

At the end, 11 926 of the 12 832 due rows (93%) were `marketplace.order.sync`.
The three job types that died on missing stub endpoints (§ 1.4(b)) contributed
41 queued rows, **0.3%**, so the finding does not rest on them.

**One incidental figure worth recording:** `deferredTotalMs > 0` on **zero**
jobs, despite 1 454 limiter degradations. Degradation and penalty-free
deferral are different mechanisms and this window exercised only the first;
the `requeueWithoutPenalty` path (#2613) never fired.

## 4. Accumulation over hours: nothing does

The question a 300-second window structurally cannot answer.

**Memory (cgroup `total_rss`, n=134 samples over ~2 h 14 m - see § 2.4.1 for
why `docker stats` cannot answer this and why the series starts late):**

| container | first | last | min | max | mean | slope |
|---|---|---|---|---|---|---|
| `lab-worker-1` | 133.1 | 133.6 | 75.1 | 143.3 | 114.5 | **+0.67 MB/h** |
| `lab-api` | 126.3 | 109.9 | 109.9 | 126.4 | 125.7 | −1.46 MB/h |
| `lab-postgres` | 77.1 | 1.1 | 1.0 | 77.1 | 13.7 | −1.71 MB/h |
| `lab-redis` | 45.5 | 41.8 | 41.8 | 51.8 | 47.7 | +0.70 MB/h |

The worker's +0.67 MB/h is **inside its own 68 MB oscillation band** and its
first and last samples are 0.5 MB apart, so it is not distinguishable from
sawtooth GC behaviour. Two of the four slopes are negative. **No leak is
detectable over three hours** - and the honest bound on that claim is that a
leak slower than ~1 MB/h would be invisible here; ruling one out needs a
24-hour window.

Postgres page cache **plateaued** rather than growing: 1 574 MB at the first
RSS sample and 1 502 MB at the last. It filled during the first ~48 minutes as
the sweeps first touched the 2M-row table and then stopped, which is what
confirms the § 2.4.1 reading that the earlier 7.7x `docker stats` rise was
cache fill and not growth.

**Postgres connections:** mean 11, **max 46**, last 9, against
`max_connections = 200` - a **23% peak**. The budget guard's arithmetic
(`OL_DB_POOL_MAX 40 x 2 processes = 80`) held with a wide margin, and the peak
of 46 exceeding the 40-per-process pool is the api and worker pools summing,
exactly as expected.

**Database size:** 4 817.7 MB -> 4 847.5 MB, **+29.8 MB** over three hours,
against 651 ingested orders and ~14 000 `sync_jobs` rows. Nothing here suggests
a storage problem at this rate.

**Retries:** 474 jobs reached `attempts > 1`, max 9 - so one job came within a
single attempt of the entity default of 10 and `dead` - and 352 jobs died, all
of them on the stub 404s of § 1.4(b). **No `marketplace.order.sync` job died
at all.**

## 5. Recommendation

**None is owed by this run**, and saying so is the honest answer rather than a
gap. This is the baseline arm of an A/B whose second arm has not been run
(§ 6), and its verdict is `DISCARDED` for carrying the very defect the fix
addresses (§ 0.1). A recommendation drawn from one contaminated arm is exactly
what `results-retest-2026-09-07.md` had to withdraw when it corrected ADR-050's
`2.77x` attribution.

Three things it does support, none of which is a config change:

1. **The order path is slot-bound at the `realtime` per-scope cap, not
   budget-bound.** §3.3 shows the destination at ~12% of its rate-limit
   budget while concurrency sat at the cap 95% of the time. This is
   corroborating evidence for a finding the campaign already holds and
   deliberately declines to act on: the prior campaign's arm ED raised
   `realtime` 4/2 -> 16/16 and throughput **fell 12.5%**, and F7 measured a
   5-6x execution-time penalty under destination contention. **Raising the cap
   is not the indicated fix and this run does not recommend it.**
2. **`marketplace.fulfillment.statusSync` deserves a look** (§ 3.1): p50 474 s
   per run every 15 minutes on a 50 006-product catalogue is a ~53% duty cycle
   on one `bulk` slot. Whether that is inherent or accidental is unmeasured.
3. **A swallowed per-destination failure needs to leave a trace a sweep can
   find** (§ 3.4). That is a product gap, not a tuning one, and this run is
   the second independent observation of it.

## 6. What this did NOT establish

* **Stock churn - a departure from the composition #2840 specified.** The
  epic asks for *"sweep crons ticking, plus an order ramp, plus stock
  churn"*. This window has the crons and the order ramp; it drives no
  deliberate stock churn at the master. The driver exists
  (`drivers/stock-control.sh`, F2's) and was not wired in, because the
  requirement was read out of the epic body after the window had already
  opened, and adding a third load source mid-window would have made the two
  halves incomparable - the one thing a single continuous window must not do.
  What the run *does* carry is the **incidental** stock path: every ingested
  order fires `master.inventory.syncByExternalId` and then
  `inventory.propagateToMarketplaces`, both visible in § 3's job table, so the
  `fan-out` lane is genuinely exercised. What is missing is
  operator-originated churn independent of the order rate. **Owner: a second
  run of this scenario with the F2 driver attached**; it is the one remaining
  gap between this window and the composition #2840 named.
* **A second arm.** The retest's recommended fix
  (`OL_JOB_INTAKE_DEDICATED_REDIS=true`) was **not** run under mixed load. The
  passthrough it needs now exists in `docker-compose.lab.yml` - before this
  change compose forwarded nothing, so writing the variable into `.env.lab`
  had no effect at all - but the arm itself is unrun, so **nothing here says
  what the fix does to a mixed workload.** Everything below is the shipped
  default, i.e. the SHARED intake client. Owner: a repeat of this scenario
  with that variable exported and the worker's own `DEDICATED` line asserted.
* **Any ceiling.** Same limitation the campaign doc § 7 states for every other
  flow: this window was driven to saturation on a contended developer
  workstation, not to failure on representative hardware. The figures are
  floors.
* **Whether the shop degrades under mixed load.** No shop-latency probe rode
  this window. `results-weak-shop-2026-09-07.md` measured PrestaShop's own
  response time under a *synthetic* offered rate and found it free to ~6.5
  req/s; whether a real mixed workload plus catalogue sweeps moves that is not
  measured here, and adding a probe would have put its own requests inside the
  connection's rate-limit budget on a run that is deliberately saturating it.
* **Which of the thirty crons costs what.** The run measures the aggregate. It
  does not attribute queue depth or destination requests to individual tasks,
  because nothing in the tree exports per-task cost - the metrics exporter
  (#2850) does not exist, which `results-retest-2026-09-07.md` § 9 calls
  the biggest single gap in this campaign's ability to answer "slots or the
  loop?". The per-jobType queue breakdown in § 3 is the closest available
  substitute and it is a *depth* attribution, not a *cost* one.
* **Multi-replica behaviour.** One worker replica. ADR-050's slot accounting
  is per process, so nothing here transfers to a scaled deployment except by
  the 1.50x the retest measured for the order path alone.
* **Lane starvation as F7 frames it.** This run creates the co-tenancy F7 was
  built to probe, but it carries no claim-latency probes, so it cannot say
  whether a `realtime` job waited behind `bulk`. It measures the *aggregate*
  consequence of the mixture, not the isolation property.
* **Whether the queue would have converged later.** See the verdict rule in
  § 2.5 - if § 3 reports `growing`, the honest statement is that the window
  ended first, and no extrapolation of a growth slope to an eventual plateau
  is offered.

## 7. What fought this run

1. **`lab-api` was dead on arrival, and nothing in the harness could have
   said so.** No compose service declares a restart policy, so a peer's
   Redis-outage test killed it two hours earlier and it stayed down.
   `guard_stand_exclusive` arbitrates scenarios; `post_guard_containers_stable`
   compares `.State.StartedAt` *within* a window. Neither answers "is the
   stand up" before one opens. A scenario would have died at its first
   `ol_api` call with a connection error rather than a diagnosis. **A
   `guard_stand_healthy` that pings the api and asserts every measured
   container is `running` would have turned ten minutes of confusion into one
   line**, and is the cheapest harness addition this run suggests.
2. **The images predated the change the run is about**, and rebuilding them
   cost roughly 40 minutes of session budget - which is why the window is 3
   hours rather than 4. That is `guard_build` working, not fighting: without
   it the run would have measured PrestaShop's *old* 60 req/min manifest
   default while its own report claimed 300.
3. **Two of the scenario's own log readers were wrong, and the smoke run is
   the only reason the report does not carry their answers.** The intake-client
   reader matched `*DEDICATED*` against a line reading
   `SHARED (OL_JOB_INTAKE_DEDICATED_REDIS is not true)` and so inverted the
   single most consequential configuration fact in this campaign. The
   scheduler-task reader ran six seconds before `SingletonRoleLease` acquired
   `singleton:scheduler` and recorded "0 task(s)" while thirty were
   registered. Both are now fixed, the second by waiting and then **refusing**
   a run with no registered tasks - a mixed run whose scheduler registered
   nothing is an order-only run wearing the wrong label. Neither was visible
   by reading the code.
4. **The degradation sampler measured points in the window rather than the
   window.** It read the clock *after* each sample and used that as the next
   interval's lower bound, so each sample's own duration (seconds - several
   Postgres counts plus a `docker stats`) fell outside every interval. Caught
   by disagreement: the sampler totalled 19 episodes where
   `post_guard_limiter_degraded`'s single whole-window grep found 25.
   Intervals now tile.
5. **The summarizer's two `GROUP BY` queries were invalid**, and would have
   failed *after* the measurement with the CSVs intact. Concatenating columns
   in the SELECT list puts an aggregate inside the GROUP BY expression;
   Postgres refuses. Found by running the summarizer against a synthetic
   results directory before the window opened, which is the only reason it was
   found before rather than after.
6. **`stand-ids.env` did not exist.** `bootstrap.sh` deletes it on any run
   that found a gap and it is gitignored, so a stand bootstrapped from another
   worktree may simply not have one. Re-running bootstrap would have rotated
   the PrestaShop webservice key and reseeded offer mappings - i.e. changed
   the thing under measurement - so the scenario resolves connection ids from
   the database by name instead, which is what bootstrap itself keys on.
7. **`lib-test.sh` shipped with a permanently-failing assertion** (165 passed
   / 1 failed at the start of this session). "Omitting the feed argument
   leaves the verdict VALID" called `run_post_guards` against a fresh temp
   directory, so `post_guard_containers_stable` correctly refused a window it
   had no baseline for and the verdict came back DISCARDED for an unrelated
   reason. The sibling block forty lines below already seeds that baseline
   with a comment explaining why. Fixed; 166 / 0.

## 8. Reproducing it

```bash
export PS_CONTAINER=lab-prestashop PS_MYSQL_CONTAINER=lab-mysql \
       WC_CONTAINER=lab-woocommerce PG_CONTAINER=lab-postgres \
       REDIS_CONTAINER=lab-redis OL_API_CONTAINER=lab-api \
       OL_API_URL=http://127.0.0.1:19000 OL_ADMIN_USER=admin OL_ADMIN_PASSWORD=admin
unset WORKER_CONTAINERS

export OL_STAND_LOCK_TTL_SECS=21600
export SETTLE_SECS=60
export MIXED_DURATION_SECS=14400
export MIXED_ORDERS_PER_MIN=60
export MIXED_SAMPLE_INTERVAL_SECS=30
export MIXED_FAULT_AT_SECS=9000
export MIXED_FAULT_SECS=300

bash scenarios/sustained-mixed-load.sh
```

The images must carry the working tree's revision or `guard_build` refuses:

```bash
docker build --target production --build-arg OL_GIT_SHA=$(git rev-parse HEAD) -t ol-perf:api .
docker build --target worker     --build-arg OL_GIT_SHA=$(git rev-parse HEAD) -t ol-perf:worker .
docker compose -f docker-compose.lab.yml --env-file <stand>/.env.lab -p lab up -d --no-deps api worker
```
