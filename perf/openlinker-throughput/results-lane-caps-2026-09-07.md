# F8 - lane caps for `realtime`, `fiscal` and `fan-out` (#2867)

**Date**: 2026-09-07 - **Epic**: #2840 - **Issue**: #2867 - **Stand**: `lab`

## 0. Read this before any number

**The stand is a docker-compose project on a contended developer workstation
(WSL2), sharing a host with two other OpenLinker stacks (`ol-demo-fresh-*`, 10
containers) and with two peer perf scenarios.** Host load average entering this
session was 1.42-2.21. Every figure below is a **floor**, and `n = 1` unless a
sample size is stated. n=1 is a direction, not a bound.

**The stand's exclusivity lock was held by peers for most of this session** -
`f7-lane-starvation` from 00:32 to 00:58, and `f1-order-ingestion` from 01:05
onward. `guard_stand_exclusive` was taken and released properly; the queue for
it is the single largest reason this report is shorter than #2867 asks for.

Every figure carries one of three labels and they are not interchangeable:

- **measured** - observed on this stand in this session, with the sample size.
- **derived** - arithmetic or a code reading, with the source named.
- **extrapolated** - neither. There is one, and it is marked.

---

## 1. Verdict

**No cap default changes on this evidence, and none should.** `realtime`,
`fiscal` and `fan-out` remain as ADR-050 § Amendment (#2851 / #2867) already
describes them - two illustrative, one derived.

That is not the interesting part. The interesting part is that **the reason
they are unmeasured moved**. Before this session the answer was "nobody has run
the saturation sweep". After it, the answer is:

| Lane | Default | Still | Why it did not get a number here |
|---|---|---|---|
| `realtime` | 4 / 2 | ILLUSTRATIVE | A sweep is now RUNNABLE (§ 2) and a smoke arm ran clean, but per-job cost on the write path measured **9.1-9.8 s against a 127 ms destination** (§ 4.2). Until that is attributed, a curve taken through it is a curve of the unattributed 9 s. |
| `fiscal` | 2 / 1 | ILLUSTRATIVE | Unchanged and, on the evidence in § 4.5, likely permanent. No provider exists on this stand and building one means issuing real documents. |
| `fan-out` | 8 / 4 | **DERIVED, not measured** - confirmed, see § 4.6 | Not reached. The peers held the stand. |

**The one thing that did change is that the measurement is now possible at
all.** It was not, and that is § 2.

---

## 2. The blocker: lane caps were unreachable from any scenario

`docker-compose.lab.yml`'s `worker` service listed no `OL_LANE_*` variable.
Compose substitutes `${VAR}` only for keys a service actually lists, so
exporting `OL_LANE_REALTIME_SCOPE_CAP=8` around `docker compose up` set
**nothing**, silently.

This is worse than an inconvenience, and it is why it is § 2 rather than a
footnote. A cap sweep run against that stand would have produced a perfectly
clean curve of the **same cap measured at every point** - flat throughput, flat
latency, five points, no errors - and that reads exactly like *"this lane does
not respond to its cap"*, which is a conclusion. It is the
`post_guard_limiter_degraded` shape from #2851 one layer up: **an instrument
that cannot see reads identically to a clean result.**

Fixed two ways, because the passthrough alone would have been trusted:

1. `docker-compose.lab.yml` passes all eight cap variables through, each
   defaulting to **empty**. `resolveLaneCaps` reads `''` as "use the code
   default", so an untouched stand is byte-identical to its pre-#2867 self.
2. `f8-lane-caps.sh` **reads the applied cap back out of the worker's own
   `Starting sync job runner loop` line and refuses the arm on a mismatch.**
   The scenario does not trust the env write it just made.

`lib-test.sh` goes from 116 to **140 assertions**, 24 of them for this: every
variable is passed through, every default is empty, the scenario verifies
rather than assumes, and four traps below are pinned as tests.

---

## 3. What was built

`perf/openlinker-throughput/scenarios/f8-lane-caps.sh` - sweeps one lane's
per-scope cap across a list, one worker recreate per point, reporting
throughput and per-job latency at each. `--lane`, `--caps`, `--jobs`,
`--scopes`, `--smoke`. It restores every cap it found, plus the runner posture,
on any exit path including `die`.

Four design choices are load-bearing and each is a correction to the obvious
approach.

**The realtime load is `marketplace.offerQuantity.update`, not
`marketplace.order.sync`.** ADR-050's amendment names the latter. On this stand
that job is not a realtime-lane measurement: `OrderSyncService` fans an ingested
order out to every `OrderProcessorManager` connection, which here is
`perf-prestashop` **and** `perf-woocommerce`, so a 240-job arm would create 240
real orders in a real PrestaShop against its declared 60 req/min. F4 already
measured what happens then - both arms `DISCARDED`, the shop the ceiling.
`offerQuantity.update` is the same lane, is the lane's highest-volume real
member, makes exactly one synchronous call, fans out to nothing, and its
destination here is the `allegro-stub`, whose latency is a knob rather than a
shop. **A saturation curve taken against a contended destination is a curve of
the destination**, which is the whole reason the previous two runs could not
size a lane.

**Nothing is sized from lane occupancy.** F4 § 2 established that the
`sync_jobs`-row proxy over-reads (a slot is released in-process when the handler
resolves; the row stays `running` until a separate terminal write commits). The
over-read is a *larger fraction of a smaller cap*, and every cap swept here is
smaller than `bulk`'s 12 - at `fiscal`'s perScope of 1, a single in-flight
terminal write is a 100 % over-read. Occupancy is recorded as
`occMaxProxy`/`occMeanProxy` and used for nothing. Sizing reads
`sync_jobs.lastAttemptDurationMs` (#2611) and row timestamps, which the worker
writes at real precision.

**Claim/queue latency is not used either** - F7 established that its own
claim-latency band *is* the instrument (`POLL_INTERVAL_MS` plus a ~1 Hz poller),
so a sub-second difference between arms cannot be resolved by it.

**The fiscal arm measures the runner's floor and says so** - see § 4.5.

---

## 4. Findings

### 4.1 The rate limiter degrades on a healthy, essentially idle Redis (measured)

Observed in the worker log against `perf-allegro-a`:

```
ERROR [RedisRateLimiterAdapter] Redis rate limiter unavailable for connection
53d949aa-... - falling back to per-process in-memory limiting (degraded, not
unthrottled). Redis rate-limiter call "checkPace" timed out after 1000ms
```

Measured in the same minutes:

| Fact | Value | How |
|---|---|---|
| Redis command latency | **0.12-0.18 ms** | `redis-cli --latency-history`, ~300 samples |
| Redis memory / keys / ops | 18.40 MB / 82 059 / ~98 ops/s | `INFO`, `DBSIZE` |
| `maxmemory-policy` | `noeviction` (2 GB cap) | `INFO memory` |
| Stub `PUT /sale/offer-quantity-change-commands/:id` | **127.6 ms**, HTTP 200 | `curl -w`, from host |
| Stub `GET /me` | 127.4 ms, HTTP 200 | `curl -w` |
| Stub configured `eventsMs` | 276 ms | `GET /__stub/config` |
| Actual `GET /order/events` as the worker saw it | **1305 ms** | worker log |

**Redis was not slow.** A 1 s timeout on a store answering in 0.15 ms is not the
store; it is the client not being scheduled to read the reply. That is an
event-loop-lag signal - the "Channel 1" F7 recorded it could not measure. The
1305 ms against a 276 ms configured latency is ≈ +1 s, consistent with exactly
one limiter timeout being charged to that call.

Two things make this more serious than F4's sighting of the same line. F4 saw
it under a 600-job load and attributed it to load. **Here it appears on an
essentially idle stand** (one leftover poll job), which weakens "load" as the
explanation. And `perf-allegro-a` **declares no rate limit at all** - the
Allegro manifest carries no `defaultRateLimit` (verified by reading
`allegro-plugin.ts`, and ADR-050/#1810 say so deliberately) and the connection's
config is `{"apiBaseUrl": "...", "environment": "production"}` with no
`rateLimit` key. So a limiter with nothing to enforce still made a Redis call
and still spent its full 1 s budget failing it.

**This bounds every lane measurement taken on this stand**, which is why it is
the first finding rather than a curiosity: ~1 s added per outbound call means a
realtime curve measures the limiter, not the lane.

*Label: measured (the latencies, the log line, the config). The causal claim
"event-loop scheduling" is **derived** from the two measurements together and is
not directly instrumented - #2850's `ol_event_loop_lag_seconds` is what would
settle it.*

### 4.2 The realtime write path costs 9.1-9.8 s against a 127 ms destination (measured, n=12)

Smoke arm, `marketplace.offerQuantity.update`, `perf-allegro-a`, one scope,
caps 1/1 and 4/4, 12 jobs each. All 12 jobs of the recorded arm reached
`status=succeeded`, `outcome=ok` - **the path works, this is not a failure
mode.** `lastAttemptDurationMs`, sorted:

```
9116 9116 9116 9117 9138 9138 9139 9139 9848 9848 9849 9850
```

Three tight clusters of **four**, which is the per-scope cap of that arm. Four
concurrently-running jobs finishing within 1 ms of each other is not four jobs
each doing 9 s of work; it is four jobs sharing one synchronous wait.

Against a destination measured at 127.6 ms, that is **~72x the destination
latency, spent inside OpenLinker.** For sizing this lane it is the single most
important number, and **it is not yet attributed.** What has been ruled out by
measurement or by reading the code:

- Not the destination (127.6 ms, § 4.1).
- Not Redis (0.15 ms, § 4.1).
- Not rate-limit pacing: no `requestsPerMinute` and no `maxConcurrent` is
  configured anywhere for this connection (§ 4.1).
- Not a fan-out: this job type enqueues no children (`childrenEnqueued` = 0).
- Not round-trip count: the guarded write path
  (`InventorySyncService.updateOfferQuantities`) is one `SyncLockPort.acquire`,
  one cursor read, one marketplace call, one conditional cursor advance and one
  lock release per item.

The leading hypothesis is § 4.1's limiter timeout charged several times per job,
which would put ~9 s within reach. **It is a hypothesis and is labelled as one.**
Settling it needs the worker log for one traced job, which needs the stand; the
attempt to take it was refused by `guard_stand_exclusive` because a peer had
taken the stand two minutes earlier, and the smoke run's own container had
already been replaced by the scenario's restore, so its logs were gone.

*Label: the durations are **measured** (n=12, smoke mode - the harness's own
rule is that smoke numbers are not a measurement of the thing the scenario
exists to measure, and they are used here only as evidence about per-job cost,
never as a cap curve). The attribution is **open**.*

### 4.3 A freed slot waits up to a full poll interval (derived, from code)

`SyncJobRunner.runnerLoop` sleeps `POLL_INTERVAL_MS` whenever a tick started
nothing:

```ts
if (!startedAny) { await this.sleep(this.POLL_INTERVAL_MS, ...); }
```

Once a lane sits at its cap, every tick starts nothing, so the loop is asleep
when a job finishes. **Each completion therefore waits up to 1 s for its slot to
be refilled**, mean ~0.5 s if completions are uniform in the interval. Effective
throughput is about `C / (D + 0.5 s)` rather than `C / D`.

`POLL_INTERVAL_MS = 1000` is a **hardcoded `private readonly`** - unlike the
caps it sits beside, it is not env-tunable, so an operator cannot trade it off.

The consequence is lane-specific and it matters for exactly the two lanes this
issue could not measure. `fan-out` jobs are database reads plus child enqueues,
and the `fiscal` sweeps are paged reads - both are **short relative to 1 s**. For
a lane whose jobs are short, the refill latency, not the cap, is the dominant
term, and raising the cap is the only lever that exists. This is a better
explanation of #2609's observed backlog (a queue growing ~145 jobs/h faster than
it drained at `fan-out` 1/1) than "one slot serialised it" alone.

*Label: **derived** from the runner source. Not measured here - measuring it is
one arm of the fan-out sweep that did not get stand time.*

### 4.4 An oversized TOTAL turns every refill into claim-and-release churn (derived, from code)

`claimAndStartForLane` claims with `limit: cap.total - inFlightTotal` and only
*then* drops what exceeds `perScope`, releasing each surplus row individually
via `releaseSurplusClaim`. The pre-claim `excludedScopes` filter cannot prevent
it, because a scope is excluded only once it is **already** at cap - and on the
tick where a slot frees, it is not.

So a lane pinned at `total: 64, perScope: 2` with one active scope does, on
every single refill, a claim of up to 63 rows to start one, and releases 62.

**This was going to be my own methodology error**, and it is recorded because
the next person will reach for the same design. The obvious way to isolate a
per-scope sweep is to pin TOTAL high so "only perScope varies". That does not
isolate it; it adds row-lock churn proportional to `total` to every refill, and
the sweep measures the churn. `f8-lane-caps.sh` therefore **derives**
`total = perScope x scopes` unless explicitly overridden, and `lib-test.sh`
asserts it.

The operator-facing form of the same fact: **do not set a lane's TOTAL far above
`perScope` x the number of connections that actually have work in it.** It buys
no concurrency and costs claim/release traffic on the hottest query in the
system.

*Label: **derived** from the runner source. The churn's cost is not measured.*

### 4.5 `fiscal`: what actually bounds it (derived, from code)

The question was asked as "is the provider the constraint?" The code says the
lane's constraint is more specific than that, and in one direction the current
default is the constraint.

The lane holds **five** job types (`handler-registration.service.ts`):
`invoicing.issue`, `fiscalization.register`, and three cron-paced sweeps
(`invoicing.regulatoryStatus.reconcile`, `invoicing.offlineSubmission.resubmit`,
`invoicing.pendingRecovery.sweep`).

The two document-issuing types **share one per-order lock**:
`InvoiceService.issueInvoice` acquires `invoiceIssueLockKey(cmd.orderId)`, and
`FiscalRegistrationService` acquires the *same key* (#2157). So:

- **Above** the number of distinct orders being issued at once, lane concurrency
  buys nothing - the lock serialises it. This is what `.env.example` already
  says, and it is correct.
- **Below** it, the cap binds and the lock does not. `perScope: 1` means one
  fiscal job per connection at a time, so an operator's bulk issuance
  (`POST /invoices/bulk-issue` exists) over N distinct orders is serialised by
  the **cap**, entirely, even though the lock would permit all N to proceed.

Those bound different things and the second half is not currently stated
anywhere. A deadline-bearing lane whose bulk path is pinned at one document at a
time is worth an operator knowing about, whatever the provider's latency is.

**The measurement that is missing is unchanged**, and this does not substitute
for it: a run against a real invoicing or fiscalization connection issuing real
documents. That is a legal act, not a load generator, and it is why this lane is
the likeliest permanent holdout.

What a stand *can* contribute is the arithmetic bound: a burst of N documents at
cap C against a provider taking T seconds each drains in about `N x T / C` plus
the runner floor of § 4.3. **T is left unknown rather than filled in with a
plausible number.**

*Label: **derived** from code. The claim about bulk issuance is a reading of the
lock's scope, not an observed serialisation.*

### 4.6 `fan-out`'s 8/4 was reasoned, not measured - confirmed

Asked directly by #2867. The answer is **reasoned (derived)**, and both primary
sources say so in as many words.

ADR-050 § Amendment (#2609): *"The raise is not backed by a per-destination
measurement the way `bulk`'s is, and decision 6 still applies."*

`apps/worker/.env.example`: *"fan-out - DERIVED, not measured. Raised from 1/1
in #2609 on the strength of an observed BACKLOG ... - that measures the defect,
not the fix."*

The observation behind it is real and is a measurement *of the problem* (a queue
growing ~145 jobs/h faster than it drained, 15 066 rows backlogged from ordinary
operation), and the diagnosis - a synthetic all-zero connection id collapsing
every stock write in the install into one scope - is correct and was fixed. But
**8 and 4 are not measured values**; the supporting `results-D` convergence run
had `bulk` and `fan-out` in force together and attributes convergence to
neither.

Note the runner's own class-level default read `'fan-out': { total: 1, perScope: 1 }`
- the pre-#2609 value - while `resolveLaneCaps` fell back to 8/4 two methods
below. Behaviourally inert (the field is overwritten at `onModuleInit`, and on
the one path where it is not, the runner is disabled and consults no cap), but a
reader of that class saw a default the process never runs. Corrected, with the
reasoning in place; see § 6.

---

## 5. Per-lane recommendation

| Lane | Current | Recommended | Basis |
|---|---|---|---|
| `realtime` | 4 / 2 | **4 / 2 - unchanged** | No curve was taken. § 4.2's 9.1 s must be attributed first: if it is § 4.1's limiter, the lane's real per-job cost is ~130 ms and the correct cap is a different order of magnitude; if it is genuine work, 2 is defensible. Changing the number before knowing which would be a guess dressed as a measurement. |
| `fiscal` | 2 / 1 | **2 / 1 - unchanged** | Unmeasurable here (§ 4.5). Flag for the owner: `perScope: 1` serialises bulk issuance across distinct orders, which the per-order lock would not. |
| `fan-out` | 8 / 4 | **8 / 4 - unchanged** | Not reached (peers held the stand). Confirmed derived, not measured (§ 4.6). |

**No default is changed by this work.** The only defaults touched in code are a
withdrawn figure and a stale literal, both in § 6, neither of which changes what
any process runs.

---

## 6. Corrections to shipped documentation

**A withdrawn figure had survived in the runner.** ADR-066 correction 1 withdrew
the `p95 store impact 0.995` ratio by name (the probe never checked HTTP status,
so a fast error under load counted as a fast sample), and ADR-050 § Amendment
(#2851 / #2867) says it *"is removed there and stays removed here"*. It had been
removed from `apps/worker/.env.example` - which now carries an explicit *"Do NOT
quote a p95 store impact figure for this cap"* - but **not** from
`sync-job.runner.ts:136`, which still cited it as the `bulk` caps'
justification. Removed, with the prohibition restated where the next author
will be tempted.

The same docblock also called `fan-out` "illustrative" where `.env.example`
correctly calls it derived, and gave `bulk`'s `perScope: 8` the same standing as
its measured `total: 12`. Both corrected.

**A stale default literal.** `'fan-out': { total: 1, perScope: 1 }` in the
class-level initialiser, against `resolveLaneCaps`'s 8/4 fallback. Aligned; see
§ 4.6 for why this is behaviourally inert and still worth fixing.

---

## 7. What this did **not** establish

- **Any cap curve for any lane.** No sweep arm ran outside smoke mode. The
  scenario exists, is tested, and ran clean end to end; it did not get the stand.
- **The attribution of § 4.2's 9.1 s.** Ruled out: destination, Redis, pacing
  config, fan-out, round-trip count. Not ruled in: anything. One traced job's
  worker log settles it.
- **Whether § 4.1's limiter timeout occurs inside a measurement window.** It was
  observed outside one. `post_guard_limiter_degraded` would `DISCARD` an arm
  that contained one - and since #2851 that guard can actually see, so a future
  arm's verdict is trustworthy where F7's was not.
- **§ 4.3's refill latency, as a measured quantity.** It is read off the runner
  source; the arm that would measure it (a short-job lane at several caps) is
  the fan-out sweep.
- **§ 4.4's churn cost.** The scenario now avoids the condition rather than
  measuring it. `TOTAL_CAP` is overridable specifically so it can be measured
  on purpose.
- **Anything at more than one replica.** Single replica throughout, which is the
  posture the stand was found in and was restored to.
- **Anything about `bulk`.** Out of scope here; #2594 owns it.
- **Cross-scope behaviour.** `--scopes=2` exists and would be the first run in
  this campaign to reach a lane's TOTAL cap (F4 and F7 both record that one
  bulk-capable connection means `perScope` binds first and TOTAL is never
  reached). This stand has two Allegro connections, 200 distinct Offer mappings
  each, so it is reachable. Not run.

## 8. Next, in the order that buys the most

1. **Trace one `marketplace.offerQuantity.update` job's worker log.** Minutes of
   stand time. It either collapses § 4.2 into § 4.1 or opens a new question,
   and every realtime number depends on which.
2. **Run the fan-out sweep** (`--lane=fan-out`). It needs no destination -
   database reads and child enqueues - so it is the one lane whose curve is not
   hostage to § 4.1, and it is the lane whose current value is derived rather
   than illustrative.
3. **Run the realtime sweep**, once (1) is settled, at two destination
   latencies. If the knee moves with destination latency, then a single global
   default cannot be "the measured value" for this lane and the honest
   deliverable is guidance plus a range.
4. **`--scopes=2`**, to reach a lane TOTAL for the first time in this campaign.

---

## 9. Artefacts

| Path | What |
|---|---|
| `scenarios/f8-lane-caps.sh` | The sweep. `--lane`, `--caps`, `--jobs`, `--scopes`, `--smoke`. |
| `docker-compose.lab.yml` | Eight `OL_LANE_*` passthroughs, all defaulting to empty. |
| `lib-test.sh` | 116 -> 140 assertions. |
| `README.md` | "F8 - lane cap saturation" section. |
| `apps/worker/src/sync/sync-job.runner.ts` | § 6's two corrections. |
| `results/f8-lane-caps/run1788742711-realtime-*` | The smoke run. **Smoke numbers, not a measurement** - the § 4.2 durations are quoted from it as evidence about per-job cost only. |

**Stand posture** was runner-enabled / scheduler-off / one replica when taken,
and was restored to it. The exclusivity lock was released on every exit.
