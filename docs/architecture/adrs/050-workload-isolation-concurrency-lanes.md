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
| Default lanes | ~50 | 0.0386 s | 0.0382 s | 0.989 |
| Default lanes, after the adapter fix | ~50 | 0.0378 s | 0.0380 s | 1.005 |
| Raised per-scope cap (~12 concurrent children) | **~277** | 0.0405 s | 0.0403 s | **0.995** |

At 5.5x the tempo the shop did not move. Applied to the catalogue: 39 700 requests goes from ~26.5 h
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
members, which are **cron-paced** - one tick per connection, each additionally serialised by its own
per-(kind, connection) `SyncLockPort` lock, so raising the cap cannot multiply catalogue fan-out.
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
successful write, so a refusal always means a strictly newer quantity is already live. The **ceiling**
on concurrent writes to one offer is unchanged, because `realtime`'s per-scope cap was not raised -
what changes is frequency. What that frequency exposes is the guard's known cost: a contended write is
reported as a failure, so it consumes a retry attempt and could eventually dead-letter under sustained
contention. That is a defect in the retry classification, not in the ordering rule, and it is why this
change and that fix belong in the same release.

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

- Related issues: #2167, #2162, #1134, #2169, #2594, #2609, #2617
- Related ADRs: [ADR-005](./005-postgres-authoritative-job-dedup.md),
  [ADR-007](./007-syncjob-status-vs-outcome-split.md),
  [ADR-049](./049-durability-spine-and-domain-event-contract.md),
  [ADR-051](./051-worker-topology-one-artifact-roles.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Sync Manager
