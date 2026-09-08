# What does a Tuesday look like? Orders, catalogue sweeps and crons together, for hours

> **DRAFT - the window is still running.** Every `TBD` below is a figure this
> run has not produced yet. Nothing in this file may be quoted until this
> banner is gone.

**Run**: `results/sustained-mixed-load/run1788846800`, window opened
2026-09-08T05:54 UTC. **One continuous measurement window, 3 hours.**
**Scenario**: `scenarios/sustained-mixed-load.sh`.
**Image**: `fabab189eda90f7a09bbe64301449b092b00d5ff`, rebuilt for this run
(see § 1.1), `guard_build ok`. Verdict: TBD.

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

| Question | Answer | Label |
|---|---|---|
| Does the queue converge under sustained mixed load at shipped defaults? | TBD | TBD |
| What order rate survives competing catalogue sweeps? | TBD | TBD |
| Does anything accumulate over hours - memory, Postgres backends, DB size? | TBD | TBD |
| How many limiter-degradation episodes does an hours-long window really carry, against the 300 s extrapolation? | TBD | TBD |
| Does a destination fault strand orders at volume the way it does at 12? | TBD | TBD |

> Every figure is labelled **measured**, **derived** or **extrapolated**.
> § 6 "What this did not establish" is not optional reading.

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

TBD

## 4. Recommendation

TBD

## 5. Accumulation

TBD

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
