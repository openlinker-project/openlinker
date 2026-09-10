# ADR-050: Workload isolation — concurrency lanes, not strict priority, not separate deployables

- **Status**: Proposed
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

Job execution concurrency is 1, and nothing discriminates between workloads.
`apps/worker/src/sync/sync-job.runner.ts` polls every second, locks up to 10 due jobs
(`findAndLockDueJobs(limit, workerId)` — no jobType, no priority; `ORDER BY "nextRunAt" ASC …
FOR UPDATE SKIP LOCKED`), and processes them strictly sequentially ("For MVP, process sequentially
to avoid overwhelming adapters"). Every one of the **34 registered job types** runs under
`runWithPriority({ priority: 'background' })`; the only `interactive` producer is the API request
interceptor. The per-connection rate limiter's own header states the consequence: *"There is no
reservation/floor guaranteeing background progress — a sustained stream of interactive callers can
starve a queued background waiter indefinitely"* (bounded only by `MAX_TOTAL_WAIT_MS = 120 s`). A
rate-limited job requeues into the same FIFO after a flat 30 s without incrementing attempts, so it
re-occupies slots.

Measured consequence: one operator bulk submit (`EXPANDED_OFFER_CEILING = 1000` children, ~2–5 s
each) is 35–80 minutes of serial work. Behind it wait a webhook order ingest, the
`inventory.propagateToMarketplaces` → `marketplace.offerQuantity.update` stock write (delayed stock
write ⇒ oversell), and `invoicing.issue` with a statutory deadline.

The 34 job types cluster into a small number of **workload profiles**, not into 34 shapes and not
into the ~15 bounded contexts. Domain boundaries organise code; execution boundaries organise
scheduling and blast radius.

## Decision

**1. Lanes are workload profiles, and a job's lane is chosen by what starving it costs — never by
its I/O shape or its bounded context.** Four lanes:

- **`realtime`** — someone or something is waiting on a single unit of work: `marketplace.order.sync`,
  `marketplace.order.fxStamp`, `marketplace.offerQuantity.update`, `marketplace.offer.updateFields`,
  `marketplace.offer.pollCreationStatus`, `marketplace.offer.refreshSnapshot`,
  `marketplace.offer.stockRestore`, `marketplace.offer.pauseStale`,
  `marketplace.shipment.syncByExternalId`, `master.product.syncByExternalId`,
  `master.inventory.syncByExternalId`, `invoicing.paymentStatus.refreshByExternalId` (12). The two
  `master.*.syncByExternalId` entries are the **webhook-triggered** children only — see the #2594
  amendment below.
- **`bulk`** — paged/cursored sweeps *plus the operator-wave children*: `marketplace.offers.sync`,
  `marketplace.offer.statusSync`, `marketplace.offer.pauseStaleSweep`,
  `marketplace.order.fxStampSweep`, `marketplace.shipment.statusSync`,
  `marketplace.fulfillment.statusSync`, `master.variants.autoMatch`,
  `shipping.pickupPoint.refreshFrequent`, `shop.product.statusSync`, `destination.taxonomy.sync`,
  `orders.taxRate.backfill` (#2440), the two sweep-triggered master children
  `master.product.syncFromSweep` / `master.inventory.syncFromSweep` (#2594),
  and — the rule's most consequential application — `marketplace.offer.create` and
  `shop.product.publish` (15). The last two are single-unit work, but they arrive in
  operator-triggered waves up to 1000 wide; starving one costs a slower batch an operator tolerates,
  while letting the wave monopolise slots is exactly the measured 35–80-minute failure above.
- **`fiscal`** — deadline-bearing, at-most-once: `invoicing.issue`,
  `invoicing.regulatoryStatus.reconcile`, `invoicing.offlineSubmission.resubmit`,
  `invoicing.pendingRecovery.sweep`, and `fiscalization.register` (5 — the last registered after
  this mapping was authored, #2156, and assigned by the same rule during Wave 3, #2278). The three
  sweeps are paged like `bulk`, but starving them
  costs a statutory deadline, so the rule places them here — the dual-profile cases are decided by
  cost-of-starvation, which is why the rule is stated before the mapping.
- **`fan-out`** — near-zero HTTP of their own, output is child jobs: `marketplace.orders.poll`,
  `master.product.syncAll`, `master.inventory.syncAll`, `master.product.syncDelta`,
  `master.product.reconcile`, `inventory.propagateToMarketplaces` (6).

Every registered jobType must be assigned to exactly one lane at registration; an unassigned type is
a boot error, not a silent default. *Reversal gate (countable):* a fifth lane entry
appearing in the lane assignment table, or lane membership churning across releases (diffable) —
either says the axis is wrong.

**2. Per-lane concurrency caps, never strict priority.** Every lane can always pull. River documents
the failure of the alternative directly: *"if your workers are swamped with more high-priority jobs
than they can handle, lower priority jobs may not be fetched"* — a naive realtime-first ordering
starves `bulk`, the inverse of the problem being solved, and OL's own rate-limiter header documents
the same failure shape in-process. *Reversal gate (prose-only):* a `fiscal` job misses a statutory
deadline while its lane cap had free slots — evidence that caps alone cannot express urgency and a
deadline-aware policy is needed.

**3. The isolation key is a `scope`, not `connectionId`.** Per-connection caps are right today, but
the Fleet/Partner-Console direction means one install serving many merchants, where a merchant may
hold several connections — and a per-connection cap cannot express *"this merchant's work must not
starve that merchant's"*. Making the key a scope now costs one field and avoids a migration later;
pg-boss's `groupConcurrency` (documented as *"tenant ID, project ID, customer ID"*, enforced
globally via the database) is the precedent. *Reversal gate (prose-only):* none expected — the field
degenerates cleanly to `scope = connectionId` on a single-merchant install.

**4. Round-robin fairness between scopes is deliberately not built.** It exists off-the-shelf only
in BullMQ Pro (paid); what OSS queues offer is per-key caps, and caps are sufficient for a handful
of connections per install. *Reversal gate (countable):* a scope observed waiting behind another
scope's full cap for longer than a stated window — countable from the per-lane metrics #1134
introduces, and not before.

**5. Separate deployables are deliberately not built.** The escalation ladder is: per-lane caps →
producer-side routing → role flag on one artifact (ADR-051) → second container from the same image →
separate artifact. **OL is before rung one** — no compose file declares `replicas`, and the base
`docker-compose.yml` has no `worker` service at all — so starting at rung four skips the cheapest
fix and multiplies containers for a self-hoster who does not scale even one today. *Reversal gate
(prose-only), owned by this ADR:* a lane whose measured contention per-lane caps demonstrably cannot
fix — e.g. a CPU-bound handler class appears, where process isolation rather than slot accounting is
the remedy. (ADR-051's out-of-process-plugins gate is the *topology* gate; the two are distinct and
must not be conflated.)

**6. Cap values are illustrative until they are measured.** A cap without a metric is a guess. Before
any number in a Wave 3 implementation is treated as more than a default, per-lane queue depth,
oldest-queued age, and pulls/min must be observable (#1134). *Reversal gate (prose-only):* not
applicable — this is a precondition, recorded so cap-tuning PRs cite measurements, not taste.

## Amendment (#2594) — the sweep child's lane, and the first measured cap

Two things this ADR got wrong in practice, both found by measuring a real PrestaShop catalogue.

**1. A job's lane depends on its trigger, not only on its type.** `master.product.syncByExternalId`
was placed in `realtime` because a webhook-driven single-product sync is work someone waits on. It
is also the child the catalogue sweeps enqueue, a budget (100) wide per tick. Decision 1's own rule
already covers that case — it is exactly why `marketplace.offer.create` sits in `bulk` — but the
mapping missed it, because one job type served two triggers with two costs of starvation. The
consequences were both directions of wrong at once: a catalogue cycle filled the realtime lane's
per-scope slots ahead of a buyer's order, *and* the catalogue was throttled to
`OL_LANE_REALTIME_SCOPE_CAP` (default 2), a cap sized for waited-on work.

The fix keeps the lane declared per job type at registration, and splits the type instead:
`master.product.syncFromSweep` and `master.inventory.syncFromSweep` are the sweep-triggered children,
registered in `bulk` against the SAME handler instances as their `…syncByExternalId` twins. A fifth
lane was rejected: decision 1 makes that a reversal gate, and nothing about the axis is wrong here.
Both types stay registered, so a child already queued under the old type at deploy time still runs,
and the boot-time full-union coverage assertion still holds. A visible side benefit: an operator can
now tell catalogue work from webhook work on the Jobs surface, which was previously impossible.

**2. `bulk`'s cap values are no longer illustrative.** Decision 6 asks that cap-tuning cite
measurements. An interleaved A/B run against a live PrestaShop shop, with the catalogue sweep running
against it:

| Run | req/min | p95 idle | p95 under load | ratio |
|---|---|---|---|---|
| Default lanes | ~50 | *withdrawn* | *withdrawn* | *withdrawn* |
| Default lanes, after the adapter fix | ~50 | *withdrawn* | *withdrawn* | *withdrawn* |
| Raised per-scope cap (~12 concurrent children) | **~277** | *withdrawn* | *withdrawn* | *withdrawn* |

**The p95 columns are withdrawn** ([ADR-066](./066-prestashop-request-reduction-without-a-module.md) correction 1, applied here by the #2627 review): the probe that produced them never checked the HTTP status code, so a fast error under load counted as a fast sample - which is why two of the three ratios were below 1.0, asserting the shop answered faster while being swept. They must not be quoted as evidence anywhere, including here, and this table quoted them while ADR-066 forbade it. ADR-066 correction 2 adds that store impact tracks cursor DEPTH rather than catalogue size, so a single ratio could not have justified the cap even if it had been measured correctly.

**What survives is the throughput column**, which is a count of requests OL issued and does not depend on the probe: the raised cap sustained ~277 req/min against ~50. Applied to the catalogue: 39 700 requests goes from ~26.5 h
to ~2.4 h. Raising the connection's own rate limit from 60 to 300/min, by contrast, moved traffic
from 50 to 63 req/min — the limiter was never the ceiling.

`bulk` therefore defaults to `total: 12, perScope: 8`, from `2 / 1`. `perScope` sits below the
measured ceiling on purpose: decision 4 deliberately ships no round-robin fairness between scopes, so
at `perScope === total` one connection's catalogue cycle could hold the whole lane while a second
connection's sweep made no progress at all.

Three limits on that number, all load-bearing:

- **It covers the PrestaShop catalogue read path only.** No other destination was measured. An
  operator on a slower shop or constrained hosting lowers `OL_LANE_BULK_SCOPE_CAP`.
- **It affects every other `bulk` job type**, not just the sweep children — the offer-create and
  shop-publish waves, the status-sync sweeps, the fx-stamp and tax-rate backfills all drain faster
  now. That is intended (those waves are the 35–80-minute failure this ADR was written about), but it
  is a global change and is stated as one.
- **It bounds one worker PROCESS.** Slot accounting is in-process, so N replicas multiply every
  effective cap by N. Size per replica.

`realtime`, `fiscal` and `fan-out` keep their untuned defaults. Nothing about the buyer-facing path
changed: the point of moving the sweep child out is that `realtime` did not need raising.

## Amendment (#2609) — the scope was the bug, not the lane

`inventory.propagateToMarketplaces` was serialised across the whole installation. Measured on the
demo stack, the queue grew about **145 jobs/h faster than it drained**, and the 15 066 backlogged
rows found there were days of ordinary operation rather than an incident.

**Decision 3's scope was never populated for this job.** Every enqueue used a synthetic
`00000000-0000-0000-0000-000000000000` connection id, so all propagation in the install shared one
scope, and the `fan-out` per-scope cap of 1 then made each stock write wait for the previous one -
however many connections the operator had. The job now carries **the master connection the stock was
read from**: `IInventoryService.setInventory` takes an optional `sourceConnectionId`, and
`MasterInventorySyncService` passes the connection it is syncing. Per-scope accounting now isolates
one master's burst from another's, which is what decision 3 says it is for.

**The lane is confirmed, not changed, and #2594's precedent does not apply here.** Propagation reads
stock and enqueues one `realtime` quantity write per mapped destination; it makes no marketplace call
itself, so `fan-out` is right. #2594 split a job type because one type served two triggers with two
different costs of starvation. Propagation has two triggers as well - a stock webhook and the
inventory sweep - but **one cost**: both discover real stock drift, and on a master with no stock
webhook the sweep is the *only* thing that discovers it (see § Inventory, `master.inventory.syncAll`).
Sweep-triggered propagation is therefore not tolerable-slow background work, so there is nothing to
separate and the job type stays single. The lane tally is unchanged at 12 / 15 / 5 / 6.

**`fan-out` defaults to `total: 8, perScope: 4`, from `1 / 1`.** A cap of 1 fitted the lane's other
members, which are **cron-paced** - one tick per connection, each additionally serialised one level
down, so raising the cap cannot multiply catalogue fan-out. Precisely: the four catalogue enumerators
take a per-(kind, connection) `SyncLockPort` lock in the handler, while `marketplace.orders.poll` has
no handler lock and is instead serialised inside `OrderIngestionService`, which takes its own
per-connection lock and reports `skippedDueToLock` as a success.
Propagation is **event-paced**: one job per changed stock row, thousands per sweep. Three notes:

- The raise is not backed by a per-destination measurement the way `bulk`'s is, and decision 6 still
  applies. It does not need one in the same sense: a `fan-out` job's work is database reads plus
  child enqueues, so the cap bounds queue fan-out rather than a shop's request budget. The outbound
  pacing stays where it already was, on `marketplace.offerQuantity.update` in `realtime`.
- It also lets two connections poll orders or enumerate a catalogue concurrently. The old cap
  prevented that across the whole install, which was a second, quieter instance of the same defect.
- `perScope` sits below `total` for decision 4's reason: with no round-robin fairness, one scope must
  not be able to hold the lane.

**Consequence for the out-of-order quantity-write guard (#2617).** More propagation in flight means
more often two writes for one offer, so the guard fires more. It still holds: it takes a per-(connection,
offer) lock, compares the quoted observation against the mark, and advances the mark only after a
successful write, so a refusal always means a strictly newer quantity is already live. That advance is
a **compare-and-set** (`ISyncCursorsService.advanceCursorIfNewer`, one `ON CONFLICT ... WHERE` statement),
so monotonicity does not depend on the 30 s write lock surviving the marketplace call: a call that
outran its TTL could otherwise set the mark BACK to its own older observation after a peer had written
a newer quantity, and admit a stale write behind it - the very defect the guard exists to prevent. The **ceiling**
on concurrent writes to one offer is unchanged, because `realtime`'s per-scope cap was not raised -
what changes is frequency. What that frequency exposes is the guard's known cost: a contended write is
reported as a failure, so it consumes a retry attempt and could eventually dead-letter under sustained
contention. That is a defect in the retry classification, not in the ordering rule, and it is why this
change and that fix belong in the same release.

## Amendment (#2594 review) - the rolling scan sweeps needed the lock the caps used to give them

Raising `bulk`'s per-scope cap from 1 to 8 removed an implicit serialisation. At 1, two ticks of one
connection's rolling scan sweep could never overlap. Eight `bulk` sweeps were relying on that without
owning a lock: the offer status sync, the offer-mapping sync, the shop product status sync, the
shipment and fulfillment status syncs, the fx stamp sweep, the tax-rate backfill and
`marketplace.offer.pauseStaleSweep`. Only `destination.taxonomy.sync` and the four catalogue
enumerators held one.

**Six of them are locked, and the split is by whether the sweep keeps a cursor.** A sweep that reads a
scan cursor, does a page, then writes the cursor back is a read-modify-write: two overlapping runs
race it, one advances past the page the other is still reading, and a whole cycle of rows is skipped
with no error anywhere. The offer status sync, offer-mapping sync, shop product status sync, shipment
status sync, fulfillment status sync and tax-rate backfill all have that shape and now take a
per-(kind, connection) lock through one shared helper (`apps/worker/src/sync/scan-sweep-lock.ts`),
in the shape the catalogue enumerators already prove: contention is not a failure, the run reports
`ok` without touching the cursor, and the TTL bounds a lost release
(`OL_SCAN_SWEEP_LOCK_TTL_MS`). One helper rather than six copies, because a per-handler copy is six
places for the release to be forgotten.

**Two are deliberately left unlocked.** `marketplace.order.fxStampSweep` and
`marketplace.offer.pauseStaleSweep` keep no cursor. Each re-derives its work from a predicate on every
run - the unstamped-order predicate, and `product_variants.isStale` - and each write is conditional or
idempotent: the FX stamp is a narrow `WHERE reportingCurrency IS NULL` update, and the pause re-asserts
quantity 0. Two overlapping runs therefore duplicate reads and converge on the same state; they cannot
skip work, because there is no position to advance past. Locking them would buy nothing and would add
a second thing to reason about on the one path (#1689's pause) whose whole point is that it re-asserts
what an event may have lost.

## Amendment (#2594 / #2609 review) - the pool sizes with the caps

Both raises left the database connection pool where it was. `libs/shared/src/database/database.module.ts`
set no `extra.max`, so pg's default of **10** applied while concurrent handler capacity in one process
went from 9 to **26** (4 + 12 + 2 + 8). That is a real ceiling and it fails quietly: pg's
`connectionTimeoutMillis` also defaults to 0, so an over-subscribed pool queues without erroring and
the symptom is "the raised caps did nothing". A handler holding a transaction connection while
awaiting a second pooled query - the order read model's `upsertWithLineItems`, the webhook gate - can
also deadlock the pool once every connection is held that way.

The pool is therefore **derived from the lane caps, not picked**: at least one connection per
concurrent handler slot, plus headroom for that nesting and for the runner's own claim and heartbeat
queries. `OL_DB_POOL_MAX` defaults to **40** against the caps' 26, and `OL_DB_POOL_CONNECTION_TIMEOUT_MS`
defaults to 10 s so exhaustion surfaces as a job failure on the retry ladder rather than a stall. The
rule for a future raise is written beside the caps in `apps/worker/.env.example`: keep the pool at or
above the sum of the four TOTAL caps, plus headroom.

Two limits. The pool, like the caps, bounds **one process** - N worker replicas and the api each hold
their own, so the deployment total is this value times the process count and must stay under the
server's `max_connections`. And a fourth limit belongs beside the three in the #2594 amendment: some
`bulk` work reaches a public API that the per-connection rate limiter does not cover.
`marketplace.order.fxStampSweep`'s NBP/ECB reads have no connection to key a bucket on (see § Currency),
so lane concurrency was the only thing bounding them. Low risk today - one job per tick, its per-order
children stayed in `realtime` - but it is the constraint a future raise has to argue against.

## Amendment (#2613 / #2617) - a deferred job is queued, not running, and what that costs a lane

[ADR-007](./007-syncjob-status-vs-outcome-split.md) § Amendment (#2613) records the retry-ladder half of penalty-free deferral: a failure that is neither the job's fault nor a terminal platform answer requeues without consuming an attempt, bounded by a cumulative `sync_jobs.deferredTotalMs` budget. This amendment records what it does to lane occupancy, because that is this ADR's subject and it is easy to state wrongly.

**The precise claim.** A deferred job sits at `status: 'queued'` with a future `nextRunAt`. Slot accounting here is in-process and counts **started** jobs, so a job parked on its `nextRunAt` holds **no** lane slot while it waits. What it does hold is queue depth, and it re-consumes a `(lane, scope)` slot on every re-pickup - so a destination that keeps deferring turns one job into an indefinite sequence of short occupancies in its own scope. **That recycling is what the budget bounds**, and it is the reason the deferral could not ship without one: an unbounded penalty-free requeue is a job that can never leave the lane's rotation.

The scope cap is what keeps that bounded in the meantime. Deferral is per-job and the cap is per-(lane, scope), so a throttling destination's jobs recycle inside their own connection's slice and cannot crowd out another connection's work in the same lane - the property decision 3 exists for, doing its job on a failure mode decision 3 did not anticipate.

**Contention is the second source of deferral, and it is this ADR's own doing.** Decision 2 made a lane run jobs concurrently and #2609 removed the last accidental serialisation, which is what made a per-target write guard necessary ([ADR-067](./067-freshness-token-write-ordering.md)). A write refused because a peer holds that guard's lock is reported as `write_contended` and reaches the runner as a neutral `ContendedWriteError` with a fixed short grant. Retrying it under the ordinary ladder would spend attempts - and eventually a `dead` row - on the guard **working**, which would make the concurrency this ADR chose look like a defect in the very path it protects.

**Two things are deliberately not done.** No lane is exempt from deferral, and no lane gets its own budget: the grant is a property of the destination's answer, not of the workload profile, and a per-lane budget would be a second pacing knob with no measurement behind it ([ADR-069](./069-operator-settable-sweep-pacing.md) covers the pacing knobs that do have one). And nothing counts deferred jobs against a cap - a parked job consumes no worker, and charging it a slot would idle capacity to model a job that is not running.

*Reversal gate (prose-only):* a lane whose queue depth is dominated by deferred jobs. That is the signal that deferral has become a pacing mechanism rather than an exception, and the destination in question needs a real rate-limit configuration rather than a retry policy.


## Amendment (#2851 / #2867) - enforcement stays per-process, and the cap provenance table

> Superseded in part by § Amendment (#2840) below: `fiscal` left the illustrative column, so the heading's original "three of the four caps stay illustrative" now reads two.

Decision 6 says a cap without a metric is a guess, and #2302 has carried two open
questions ever since: set the cap values from measurement, and take an explicit decision on
global versus per-process enforcement. This amendment answers both. The honest headline is
that **no default changes**, and the reason is not that the numbers were confirmed - it is
that this programme's own measurements say the binding constraint is somewhere else.

### 1. Enforcement stays PER-PROCESS. That is now a decision, not a scope cut.

Slot accounting is in-process, so N replicas multiply every effective cap by N. Until now
that was recorded as a Wave-3 omission. It is adopted as the decision, for four reasons.

**A global ledger would sit on the hottest query in the system.** The claim is the one
statement every replica runs constantly - four claim transactions per second per replica at
idle, and unbounded under load, because `runnerLoop` sleeps only on a tick that started
nothing. Enforcing a cap globally means a durable, contended counter consulted on that path,
which turns a `FOR UPDATE SKIP LOCKED` claim - a query specifically chosen because it does
not serialise - into a read-modify-write on a shared row. The cost lands on every install,
including the overwhelming majority that run one worker.

**OL is still before rung one of decision 5's ladder.** No compose file in this repository
declares `replicas`, and the multi-replica arm could not be run at all until #2851 removed a
fixed `container_name` from the perf stand's own worker. Paying a global-enforcement cost to
correct a topology nobody runs is the shape decision 5 already rejects.

**The pool is per-process too, and it is DERIVED from the caps.** The #2594/#2609 review
amendment sets `OL_DB_POOL_MAX` at or above the sum of the four TOTAL caps, per process.
Making the caps global while the pool stays per-process leaves two ceilings that no longer
relate to each other, and the one that binds first would depend on the replica count.

**The measurement says the caps are not what an operator should reach for anyway** - see
section 3.

*What this costs an operator, stated where they read it:* `OL_LANE_BULK_SCOPE_CAP=8` on three
replicas is up to 24 concurrent bulk children per connection. `apps/worker/.env.example` says
so on the caps themselves, `docs/operations/perf-lab-stand.md` says so beside the scaling
command, and every perf manifest now carries `workerReplicas` and a `laneCapEnforcement` note
next to `laneCaps`, because a cap figure without a replica count beside it does not state a
deployment's real concurrency. pg-boss's `groupConcurrency` remains the design precedent for
the day this reverses.

*Reversal gate (countable):* a deployment running more than one worker replica where a
destination's own declared rate limit is exceeded because the limiter degraded to its
per-process fallback - the hazard `results-C` measured at one replica and `results-D` named
as unexercised.

**F4 (#2851) has now observed it, and the observation argues FOR this decision rather than
against it.** At three replicas the PrestaShop connection saw **158.4 req/min against its
declared 60**, while a Redis-limiter call timed out at its own 1 s budget and the adapter
fell back to per-process pacing - N x 60/min. The gate fires on the *effect*; the *cause* is
one layer below the lane model, and **a globally-enforced lane cap would not have prevented
it.** The limiter is already globally enforced and it still degraded. A global slot ledger
would have throttled the queue while leaving the failure open. So the gate stands as
written, and what it now points at is the limiter's degradation path - it fails **open**,
to the full per-process allowance - rather than at the caps. That is filed as its own issue
candidate in `results-F4-2026-09-06.md`; this ADR's decision is unchanged.

### 2. Cap provenance, per lane

| Lane | Default | Provenance | The measurement that is missing |
|---|---|---|---|
| `realtime` | 4 / 2 | **Illustrative** | A saturation run: many concurrent `marketplace.order.sync` against one destination, finding the concurrency at which per-order latency degrades. F7 (#2852) probed this lane's *isolation*, not its size. |
| `bulk` | 12 / 8 | **TOTAL measured** (#2594); **perScope derived** | Nothing for `total` - F4 (#2851) ran 600 `bulk` jobs on one connection and never reached it, because a single scope is bounded by `perScope` first. For `perScope`: a run with two bulk-capable connections, the only way to reach the lane's TOTAL and therefore the only way to test the fairness argument the 8 was chosen for. |
| `fiscal` | 8 / 4 | **perScope MEASURED** (#2840); **total derived** | Nothing for `perScope` - see § Amendment (#2840) below. For `total`: a run with two document-issuing connections, the only way to reach the lane's TOTAL, exactly as `bulk` still needs. |
| `fan-out` | 8 / 4 | **Derived** (#2609) | A sustained stock-write load that isolates this lane. `results-D` measured the queue converging at 100 000 products (arrival 348/h against drain 380/h; net 0.0/h over an hour), but with `bulk` and `fan-out` in force together, so it attributes convergence to neither. |

Two entries in that table are more precise than the prose they replace, and both matter.

**`bulk`'s two numbers have different standing.** The A/B run measured ~12 concurrent
children sustaining ~277 req/min against ~50. `total: 12` is that figure. `perScope: 8` is
*below* it on purpose, by decision 4's no-round-robin argument - it is a derived, deliberately
conservative fraction, never a measured ceiling, and no run has yet driven the lane to its
total.

**And the p95 "store impact" figure must not reappear.** `apps/worker/.env.example` was still
quoting `p95 store impact 0.995` as the bulk caps' justification, which ADR-066 correction 1
withdrew by name - the probe never checked HTTP status, so a fast error under load counted as
a fast sample. It is removed there and stays removed here.

### 3. What a cap promises, and what it does not

This is the finding that changes how the knob should be described. Two runs establish two
halves of it, and they are different facts rather than one repeated.

**A cap bounds worker SLOTS in one process. It does not bound the destination's capacity.**
F7 (#2852): with the `bulk` lane held at its per-scope cap for seventeen minutes against one
PrestaShop connection, a probe sharing that connection had *flat* claim latency and **5.5x**
its normal execution time (median 3.3 s to 18.1 s), while a sibling probe that touches no
adapter at all was unchanged. Lane isolation held on the axis it governs; the shop did not.

**And a cap does not bound the destination's REQUEST RATE either, once replicas multiply
it.** F4 (#2851), same aggressor at one and three replicas: the identical 600 jobs and
effectively identical request count (983 vs 1006) were delivered **2.77x faster** because the
shop was hit at **158.4 req/min against the 60/min its connection declares**. Everything the
lane model governs behaved - the claim's per-call cost was flat (0.087 ms against 0.086 ms
while replicas tripled), `sync_jobs` lock waits were zero in every sample, the pool never
timed out, and the three replicas split the work 33.4 / 33.3 / 33.3 with no coordination
beyond `FOR UPDATE SKIP LOCKED`. The outbound pacing is what gave way.

The operator-facing consequence is the opposite of the intuition #2594's throughput result
invites: **raising a scope cap to make a slow destination faster makes it slower.** If the
destination is the constraint, the remedies are to lower the cap, raise the destination's
capacity, or reduce the work - not to widen the lane. That sentence now sits on the caps in
`apps/worker/.env.example`, because an operator reading a cap is exactly the person about to
get this wrong.

This bounds what section 1's decision costs, and F4 makes the bound tighter than the earlier
draft of this paragraph claimed. Per-process enforcement means N replicas see N x the cap. The
comforting reading - that a saturated destination makes the multiplication academic, because
the cap was never the ceiling - is **only true while the shared limiter holds**. When it
degrades, N x the cap becomes N x the declared request rate at the shop, which is precisely
the reversal gate above and precisely what F4 measured. So: the multiplication is usually
absorbed by the limiter, and the day it is not is the day an operator's destination is taking
three times the traffic they configured. Size per replica, and treat a degraded-limiter log
line as an operational event rather than a curiosity.

## Amendment (#2840) - `fiscal` leaves the illustrative column

The provenance table above named the missing fiscal measurement as "a run against a real
invoicing or fiscalization connection issuing real documents". #3006's fiscal-lane sweep is the
adjacent, sufficient half of it: real `fiscalization.register` jobs through the real eparagony
adapter, against a stub whose latency is declared rather than a rejection short-circuit like
F7's. Six runs, per-scope 1 versus 4 crossed with three declared provider latencies, every one
VALID with zero deaths and zero deferrals.

| provider answers in | per-scope 1 | per-scope 4 | gain |
|---|---|---|---|
| 2 s | 58.0 s | 13.5 s | 4.3x |
| 10 s | 100.9 s | 32.2 s | 3.1x |
| 90 s | 543.3 s | 181.2 s | 3.0x |

At per-scope 1 the elapsed time is the sum of the waits almost exactly - 543.3 s measured
against 540 s predicted at a 90 s provider - which is the signature of a lane doing nothing but
queueing behind one outstanding call to somebody else's server. Documents are I/O-bound on a
third party, so a cap of 1 bought nothing and cost the whole multiple.

**The old note's premise was right and its conclusion was wrong.** `apps/worker/.env.example`
argued the cap "may matter less here than the number suggests" because `invoicing.issue` is
serialised PER ORDER by its own lock (ADR-041 §3a). That is true, and it is about ONE sale. It
says nothing about many different sales, which is the entire load a busy shop presents.
Exactly-once issuance rests on the durable per-(connection, idempotencyKey) index plus the
in-flight lease (ADR-042 decision 7), never on lane width - so widening the lane admits more
DIFFERENT orders and cannot produce a second document for one of them.

**Provenance discipline, unchanged from `bulk`.** `perScope: 4` is the measured figure.
`total: 8` is not: it exists only so one connection cannot hold the whole lane, because
decision 4 still ships no round-robin fairness, and it needs the same two-connection run
`bulk`'s total needs. Decision 6 stands for `realtime` and `fan-out`.

**One limit worth stating where it will be read.** The sweep's provider is a stub at a declared
constant latency. It bounds what OpenLinker's own lane will admit; it says nothing about what a
real provider's rate limit will accept. An operator whose provider publishes a tighter one
lowers `OL_LANE_FISCAL_SCOPE_CAP` - that ceiling is a property of the provider, and § 3 below
is the general form of the same point.

## Alternatives considered

- **Strict priority ordering** (realtime first): starves `bulk` under sustained realtime load — the
  inverse failure, documented by River and already exhibited in-process by OL's own limiter.
  Rejected in decision 2.
- **Bounded contexts as lanes**: ~15 lanes, each too small to size a cap for, and the axis is wrong —
  `invoicing.issue` and `invoicing.regulatoryStatus.reconcile` share a context but not a starvation
  cost. Rejected in decision 1.
- **Adopting an OSS queue engine** (pg-boss, River, BullMQ) for its per-key caps: replaces the
  `sync_jobs` table and the ADR-005/ADR-007 semantics built on it (Postgres-authoritative dedup,
  status-vs-outcome) to buy a feature implementable on the existing `FOR UPDATE SKIP LOCKED` shape.
  Rejected as cost-without-benefit; pg-boss's `groupConcurrency` is kept as the design precedent.
- **Separate deployables per workload**: rung four of a ladder OL has not started climbing.
  Rejected in decision 5, with this ADR's own reversal gate.

## Consequences

**Pros:**
- A buyer's order sync no longer queues behind an operator's 1000-child publish wave; the stock
  write and the fiscal deadline get lanes whose starvation cost is stated.
- Blast radius of a fan-out is bounded by its lane cap, not by hoping the queue is short.
- The `scope` key makes the multi-merchant direction a config change, not a migration.

**Cons / trade-offs:**
- Lane assignment is a judgment call per new jobType — the boot-time assignment requirement turns a
  forgotten judgment into a loud failure rather than a silent `background` default, but the judgment
  remains.
- The dual-profile assignments (invoicing sweeps in `fiscal`, wave children in `bulk`) will surprise
  a reader who classifies by I/O shape; the cost-of-starvation rule is stated first for exactly that
  reader.
- Until #1134 lands, cap values are defaults, not tuned figures.

**Migration path:**
- Wave 3 (#2162) implements: lane declared at handler registration, `findAndLockDueJobs` becomes
  lane-aware, the runner pulls under per-lane caps keyed by `scope`.
- #1134's k6 harness supplies the measurements decision 6 requires.
- #2169 makes the `(countable)` gates executable in `check:invariants`.

## References

- Related issues: #2167, #2162, #1134, #2169, #2594, #2609, #2613, #2617
- Related ADRs: [ADR-005](./005-postgres-authoritative-job-dedup.md),
  [ADR-007](./007-syncjob-status-vs-outcome-split.md),
  [ADR-049](./049-durability-spine-and-domain-event-contract.md),
  [ADR-051](./051-worker-topology-one-artifact-roles.md),
  [ADR-067](./067-freshness-token-write-ordering.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Sync Manager
