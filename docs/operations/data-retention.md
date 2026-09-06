# Data retention - what OpenLinker keeps, and for how long

**Nothing in the OpenLinker database is deleted by age today.** There is no
retention job, no cron, and no operator action that prunes history. This page
states what that means per table, what each table would keep under the proposed
policy, and what an operator loses when a row goes.

The policy below is **proposed, not shipped**. The mechanism that would enforce
it is designed in [ADR-072](../architecture/adrs/072-append-only-table-retention.md)
and is not registered. Read this page as an inventory and a plan, not as a
description of running behaviour.

## The one retention implementation that does exist

It is PHP, in the shop module:
`apps/prestashop-module/openlinker/classes/OutboxRepository.php` (the constants
at lines 110-145, `runRetention()` at 1013). It prunes the shop's own webhook
outbox and it is the shape everything below copies: only terminal rows are ever
eligible, deletes are bounded per pass, the operator sets the horizon, and a
pass that spends its whole budget arranges for the next one to continue.

## How many tables this is about

**79 tables** exist in the schema (`@Entity(...)` declarations across `libs/`
and `apps/`, counted 2026-09-05). They fall into four classes:

| Class | Count | Grows with | Anything delete? |
|---|---|---|---|
| **A - append-only, time-unbounded** | 21 | elapsed time and job/event cadence | no |
| **B - append-only, business-record grain** | 18 | orders, returns, shipments, invoices | no |
| **C - bounded by catalogue or connection count** | 13 | catalogue size, not time | upsert-keyed, or self-pruning |
| **D - operator configuration** | 27 | operator actions | yes, by operator intent |

The issue that opened this work estimated "roughly twenty". That is right for
class A and undercounts by about half for the honest question, which is *how
many tables grow without bound and nothing deletes from* - **39** (A + B).
Class B is not exempt because it is a business record; it is exempt because
most of it is legally or operationally load-bearing, which is a different
reason and is stated per table below.

Class C is the reassuring part: it is already bounded. `destination_categories`
self-prunes on a `syncedAt` watermark
(`destination-category.repository.ts:299`), `allegro_category_cache` evicts on
TTL, and the rest are upsert-keyed so a row count tracks the catalogue rather
than the calendar.

## Which tables grow fastest

**Derived from write cadence in the source, not measured.** No growth rate
exists for any table on this page; #2843 supplies them. What follows is an
argument about shape.

1. **`sync_jobs`** - one row per job. Two catalogue sweeps fan out a budget of
   children every 20 and 15 minutes per master connection, and every webhook,
   every polled order and every stock propagation adds one more. This is the
   only table with any measurement at all behind it, and it is #2590's, not
   this page's.
2. **`allegro_quantity_commands`** - one row per offer per quantity write, not
   per command: a batched write persists several rows under one shared Allegro
   `commandId`. On an install with an inventory sweep every 15 minutes it
   tracks stock churn one-for-one across every mapped offer.
3. **`webhook_deliveries`** - one row per inbound webhook, so it tracks shop
   event volume one-for-one. A PrestaShop shop with a one-minute outbox cron
   delivers as fast as the shop changes.
4. **`automation_runs`** - one row per rule firing, with the deadline sweep
   ticking every 15 minutes per `OrderSource` connection.

The surprise, if you are counting by intuition, is **`refresh_tokens`**: it
takes a row per login *and* per rotation, and rotation happens on every
refresh, so it tracks session activity rather than login count and nothing has
ever deleted an expired one.

## The window vocabulary

A table is placed on one of five values, or on **never**. A closed set exists so
that a reader can compare two tables, and so that a new table has to argue for
its placement rather than inventing a number.

| Value | Means | Placed here when |
|---|---|---|
| **7 d** | one week past the row becoming terminal | the row has no operational value after a week and no idempotency, dedup or claim consequence at all |
| **30 d** | a month | operational diagnosis reaches back about a month |
| **90 d** | a quarter | an operator investigating "why did this happen" plausibly starts from a quarter ago |
| **365 d** | a year | year-over-year comparison, or an incident record someone may still be arguing about |
| **2 y** | two years | order-scoped audit - a buyer or carrier dispute about what was agreed, held or routed |
| **never** | no window | the row is a claim, a legal record, or live state |

**7 d is the hard floor for `sync_jobs` specifically, and it is a floor rather
than a margin.** It is exactly where the Redis `jobdedup:{key}` mark expires
(`redis-streams-job-enqueue.service.ts:24`), so a table placed on 7 d that
participates in job dedup is sitting on the boundary, not comfortably inside it.
That is why `sync_jobs` is **not** placed there and never should be: see the
re-enqueue section below. The two tables that do carry 7 d -
`password_reset_tokens` and `email_confirmation_tokens` - have no interaction
with an idempotency key of any kind, so the floor does not apply to them and
the coincidence of number is not a coincidence of meaning.

## Class A - the tables this policy is for

Every row is `createdAt`-ordered history that nothing reads after a point.
"Window" is the proposed retention; "unmeasured" means the row count and growth
rate are not known and #2843 is the input that supplies them.

| Table | One row per | Proposed window | What you lose |
|---|---|---|---|
| `sync_jobs` | every job, including sweep children | **90 days**, terminal rows only (`succeeded`/`dead`). **Never 7 d**: that value is this table's hard floor, not a margin - see the re-enqueue section. | job history on the Jobs page and the connection health panel past 90 days. This one is not only disk. |
| `allegro_quantity_commands` | every Allegro quantity write, per offer | **30 days**, `status` terminal | the ability to explain a stock write that Allegro accepted and later failed asynchronously (#2621) |
| `webhook_deliveries` | every inbound webhook | **90 days** | the delivery log, and the durable replay gate for events older than the window |
| `automation_runs` | every rule firing | **90 days** | the automation run log. The spec already asks for 90 days; the UI currently says *"Every automation run recorded so far is listed here"* precisely because nothing prunes (`automation.copy.ts:474-485`). |
| `automation_trigger_firings` | every `(rule, subject)` deadline firing | **never** | this is the at-most-once record for T3/T4. Pruning it re-fires an automation that may buy a label. Its own entity docblock says the retention policies are incompatible with `automation_runs`, which is why it is a separate table. |
| `fulfillment_progress_claims` | every executor progress report | **never** | permanent replay memory. A pruned claim re-admits a duplicate progress report and double-counts fulfilled quantities. Its migration pre-created `IDX_..._claimed_at` for "an age-based retention sweep, which does not exist yet" - the index is ready and the decision is not. |
| `return_line_events` | every custody act | **never** | `seq` is the `{seq}` in the master idempotency key `return:{returnId}:{lineId}:{seq}` (#2368). Deleting a row lets a later act re-mint a used key and double-restock. |
| `fulfillment_work_rejections` | every holder refusal | **never** | `blocking` is the re-sourcing exclusion set. Deleting one re-admits the holder that just refused, which is the loop the table exists to terminate. |
| `fulfillment_work_verifications` | every pack-bench scan gesture | **never** | the scan idempotency key, and the "who handled this box" audit. Voided rows are retained by design (a reopen voids, it never deletes). |
| `routing_decisions` | every routing intent | **never** for `live`; **2 y** for terminal | a `live` row is the double-ship guard. A terminal row is order-scoped audit: which location and holder was chosen, which is what a shipping dispute turns on. |
| `order_changes` | every change request | **2 y**, terminal only | what was agreed on an order, and when. A buyer dispute reaches back further than a year. |
| `order_holds` | every hold | **2 y**, released only | why an order was held, which is what a "why was this late" dispute turns on |
| `fulfillment_holds` | every work hold | **2 y**, released only | the suspension audit, one grain below `order_holds` and read beside it on the order timeline - so the two carry the same window deliberately. An **open** hold must never be pruned: deleting it silently un-suspends work. |
| `reservation_shortfall_episodes` | every shortfall episode | **365 days**, closed only | the record that stock was promised and not there. Deliberately *not* 2 y: only OPEN episodes are read by any surface (`listOpenByOrderRecordId`), so a closed one is operational history rather than dispute evidence. |
| `tax_rate_journal` | every observed tax-rate change | **never** | **the latest row per `(product, variant, connection)` is live state, not history** - `getLatestPerConnection` serves the operator product surface from it. An age window would delete the current rate for any product whose rate has not changed inside it. That is a live-data hazard, not a retention trade-off, and it is why no window is offered rather than a long one. |
| `refresh_tokens` | every login **and every rotation** | **90 days past `expires_at`** | session forensics. `rotated_from_id` is a chain, so the predicate must not cut one in the middle: prune a chain only once its whole descent is past the window. |
| `password_reset_tokens` | every reset request | **7 days past `expires_at`** | nothing. `used_at` is a single-use marker and an expired token cannot be replayed. No idempotency-key interaction, so the `sync_jobs` 7-day floor does not apply here. |
| `email_confirmation_tokens` | every signup / email change | **7 days past `expires_at`** | nothing. Same reasoning as `password_reset_tokens`. |
| `mcp_tokens` | every issued MCP token | **never** | `revoked_at` is the revocation record, and `last_used_at` is the usage evidence. Operator-paced; growth is negligible. |
| `exchange_rates` | every `(source, pair, date)` | **never** | the audited rate behind every stamped order amount. One row per pair per day: negligible. |
| `invoice_number_gap_notes` | every operator-explained numbering gap | **never** | the written justification for a missing fiscal sequence number |

## Class B - kept, and why

`order_records`, `order_line_items`, `returns`, `return_lines`, `shipments`,
`invoice_records`, `fiscal_registration_records`, `refund_records`,
`reservations`, `fulfillment_works`, `fulfillment_work_lines`,
`offer_creation_records`, `listing_creation_records`,
`bulk_offer_creation_batches`, `bulk_batch_advancements`,
`customer_projections`, `customer_address_projections`,
`destination_address_mappings`.

**Kept forever, and the policy is that they stay that way**, for three
different reasons:

- **Legal.** `invoice_records` and `fiscal_registration_records` are the fiscal
  document records. They carry `documentContent`, `issuedLineSnapshot`,
  `artefacts` and the numbering evidence. **They are deliberately not placed on
  2 y**, even though it is the longest value in the vocabulary and the obvious
  shelf for anything fiscal: putting them there would assert that two years is
  *enough*, which is an invented legal requirement in the permissive direction
  and is the more dangerous of the two. Nothing in this tree establishes a
  statutory horizon - no migration, no constant, no comment names one - and the
  real figures differ by jurisdiction and are commonly several years measured
  from the end of a tax year rather than from the row. What would settle it is a
  jurisdiction decision by the operator, and the shape it should then take is a
  **per-install setting they justify**, never a shipped default. `never` is the
  only defensible default.
- **Cascade.** `fulfillment_works` is the parent of **five** `ON DELETE CASCADE`
  children, one of which (`fulfillment_progress_claims`) is permanent replay
  memory and another (`fulfillment_work_rejections`) is the re-sourcing
  exclusion set. Pruning the parent destroys both silently. `returns` cascades
  to `return_lines` but **not** to `return_line_events`, which has no FK - so
  pruning a return orphans its act ledger rather than removing it.
- **Money and reconciliation.** `refund_records.idempotencyKey` is the refund
  replay guard. `reservations` is the authoritative ledger that
  `inventory_items.olReservedQuantity` is reconciled against.

`customer_projections` and `customer_address_projections` are the one entry
here with a different problem: they hold PII gated by `OL_STORE_PII`, and the
right mechanism for them is **subject erasure on request**, not age. That is
not this policy and is not designed here.

## Class C and D - already bounded

Class C tracks the catalogue: `products`, `product_variants`,
`identifier_mappings`, `inventory_items`, `product_content_field`, the three
`*_snapshots` tables, `connection_cursors`, `seller_policies_cache`,
`webhook_auth_rejections`, plus the two self-pruning caches named above. Every
one is upsert-keyed, so its row count is the size of the thing it mirrors. They
need no age policy. If one of them is large, the catalogue is large, and the
remedy is a catalogue question.

Class D is operator configuration - connections, credentials, the mapping
tables, the rule tables, prompt templates, users, and five singleton settings
rows. An operator deletes these deliberately through the product. Nothing here
grows on its own.

## `sync_jobs`: deleting a row re-arms its idempotency key

This is the part that is a **correctness** property rather than housekeeping,
and it is stated per window because the answer differs by window.

`sync_jobs.idempotencyKey` is declared `unique: true` with no predicate and no
expiry (`sync-job.orm-entity.ts:62`). There is a second dedup layer - the Redis
`jobdedup:{key}` mark set by `RedisStreamsJobEnqueueService` - but it carries a
**7-day TTL**. So:

- **Under 7 days.** The Redis mark still stands, so a repeat enqueue is refused
  there and never reaches Postgres. Pruning inside this window changes nothing
  observable about dedup - and it blinds the connection health panel, whose
  historical half reads a fixed 7-day window
  (`BACKLOG_HISTORY_WINDOW_MS`, `connection-sync-status.types.ts:79`). **7 days
  is a hard floor.** Nothing below it may be configured.
- **At or past 7 days.** The Redis mark has expired, so the Postgres row is the
  **only** remaining guard. Deleting it fully re-arms the key.

What "re-armed" means depends on which enqueue path re-presents it, and the
webhook path is the sharpest because the job is inserted **first**:

```
webhook-job-gate.repository.ts:50   insertOrFindJob(...)          <- sync_jobs, ON CONFLICT DO NOTHING
webhook-job-gate.repository.ts:52   INSERT webhook_deliveries ... <- ON CONFLICT DO NOTHING
```

With the `sync_jobs` row present, a redelivered webhook conflicts on
`idempotencyKey`, resolves to the historical job, and nothing runs. With the
row pruned, **the insert succeeds and a new job runs**, while the delivery
insert still conflicts and the source is answered with the ordinary idempotent
202. So the operator sees a replay reported and a sync executed. Keeping
`webhook_deliveries` does not prevent this - the job insert runs first and
unconditionally.

The reverse ordering is only cosmetic: pruning `webhook_deliveries` while
keeping `sync_jobs` writes a fresh delivery row claiming `job_enqueued` with a
`downstreamJobId` pointing at a job that finished days ago.

### Which keys can actually recur

| Key shape | Recurs? | If it re-runs |
|---|---|---|
| `{platformType}:{connectionId}:{sourceEventId}` (webhooks) | yes, on source redelivery | an idempotent re-pull. Redundant marketplace calls. |
| `marketplace:{cid}:order:{eventKey}` (order poll) | yes, on a **cursor rewind** | the whole rewound window re-ingests |
| `bootstrap:{cid}:product:syncAll`, `bootstrap:{cid}:taxonomy:sync` | yes, on connection re-enable | a full catalogue or taxonomy re-walk. These keys carry **no timestamp** and are run-once-per-connection by design. |
| operator-supplied `clientIdempotencyKey` | yes, whenever the client re-presents it | an external API contract silently becomes "deduped for N days" |
| `taxrate:{cid}:{variantId}:{rate}` | yes, if the rate flips back | an idempotent re-publish |
| `fx:{internalOrderId}` | yes | a no-op; the stamp is a conditional UPDATE |
| `master:...:{cycleId}`, `content:...:{publishedAt}`, `stale-pause:...:{eventId}`, `bulk:...:{retryWaveId}` | **no** - the key carries a per-run discriminator | n/a |

### Why 90 days is nonetheless safe

Every re-run that would be **harmful** rather than merely wasteful is caught by
a second durable guard in its own context's table:

| Re-run | Second guard |
|---|---|
| `invoice:{cid}:{orderId}` | `UQ_invoice_records_connection_idempotency` |
| `fiscal:{cid}:{orderId}` | `UQ_fiscal_registration_records_connection_idempotency` |
| `refund:{recordId}:{lineIds}` | `UQ_refund_records_order_idempotency` |
| `return:{returnId}:{lineId}:{seq}` | `UQ_return_line_events_line_seq` |
| executor progress | `fulfillment_progress_claims` primary key |
| routing | `UNIQUE (orderId) WHERE state = 'live'` |

**So the rule is: `sync_jobs` may be pruned only while every table in that
column is retained on a window at least as long, or forever.** All of them are
forever in this policy, which is what makes 90 days defensible - and it is why
the second-guard column above must be re-checked before any of those tables is
ever given a window of its own.

Two further constraints on any `sync_jobs` window:

- **Terminal rows only.** `queued` and `running` are never eligible, the PHP
  module's first rule. A job's maximum queued lifetime is the retry ladder plus
  the deferral budget: 10 attempts backing off `30s x 2^n` sums to about 4.3
  hours (the 6-hour cap at `RETRY_MAX_DELAY_SECONDS` is never reached, because
  no `maxAttempts` in this tree exceeds 10), plus up to 24 hours of
  penalty-free deferral (`OL_JOB_MAX_DEFERRED_WAIT_SECONDS`) - about **29
  hours** in total. The comment at `connection-sync-status.types.ts:76` says
  "around two days"; that is an overestimate assuming the 6-hour cap is
  reached, and it is safely conservative either way.
- **There is no index for a global age prune.** `sync_jobs` carries
  `(connectionId, createdAt)` but no standalone `createdAt`, so
  `DELETE ... WHERE "createdAt" < $1` sequential-scans the table this policy
  exists because it is large. Either iterate per connection on the existing
  index, or add a partial index on the terminal statuses first.

## What an operator can do today

Nothing prunes, so the answers are all manual and all require database access.

**Check what you are carrying.** Per connection, the sync-status panel on the
connection health tab reports live queue depth and a 7-day history. For the
whole install:

```sql
SELECT relname, n_live_tup
  FROM pg_stat_user_tables
 ORDER BY n_live_tup DESC
 LIMIT 20;
```

`n_live_tup` is an estimate maintained by autovacuum, not an exact count. It is
the right instrument here because an exact `COUNT(*)` on the table you are
worried about is itself a sequential scan.

**Do not write your own `DELETE`.** Every caveat on this page applies to a
hand-written statement too, and three of them are silent: the `sync_jobs`
re-enqueue above, the five `ON DELETE CASCADE` children of `fulfillment_works`,
and `return_line_events` having no FK to the return it belongs to. If you must,
delete terminal rows only, in bounded batches, and never a table in the "never"
column.

## Where every figure on this page came from

| Claim | Label | Source |
|---|---|---|
| 79 tables; 21 / 18 / 13 / 27 per class | **measured** | `@Entity(...)` declarations across `libs/` and `apps/`, counted 2026-09-05, each classified by reading its repository for a delete path |
| No scheduler task is cleanup-shaped | **measured** | all 34 `taskId` declarations, 19 in `scheduler.service.ts` and 15 plugin-side |
| `webhook-delivery.repository.ts:217` has no production caller | **measured** | the only references are the port declaration, one comment and one test mock |
| Redis `jobdedup` TTL is 7 days | **measured** | `redis-streams-job-enqueue.service.ts:24` |
| Retry ladder sums to about 4.3 hours | **derived** | `30s x 2^(n-1)` summed over 9 backoffs, from `sync-job.runner.ts:54-56` and the `nextAttempt >= maxAttempts` branch at `:632`. Every `maxAttempts` in the tree is <= 10, so `RETRY_MAX_DELAY_SECONDS` is unreachable. |
| Maximum queued lifetime about 29 hours | **derived** | that ladder plus `MAX_DEFERRED_TOTAL_SECONDS_DEFAULT` (24 h) at `sync-job.runner.ts:72` |
| `sync_jobs` fell 33 537 -> 30 933 mid-campaign | **measured, by #2590** | `perf/prestashop-baseline/results-D-2026-08-28.md:96-105`, taken 2026-08-28. Not this page's measurement. |
| 15 066 accumulated rows over 8 days on one connection | **measured, by #2590** | as cited in #2862, taken during that campaign |
| Every proposed window | **judgement** | none is sized against a measured growth rate. See below. |

## What this did not establish

- **Growth rate, for any table.** Not rows per day, not bytes per order, not
  per connection. #2843 is the designated input and has not run. The "which
  tables grow fastest" ordering above is inferred from write cadence in the
  source, which is an argument about shape and not a measurement of volume.
- **The row count at which each table becomes a problem.** No aggregate on any
  of these tables has been timed at a large history. #2590's own read-path
  figure is labelled *"not exercised at a large history"* because every runner
  purged the queue.
- **The date an install arrives there.** That needs a growth rate and an
  arrival rate, and this page has neither. Nothing here can tell an operator
  *when*.
- **Whether 90 days, 30 days or 365 days is right for anything.** The windows
  are placed by what an operator plausibly needs to look back at and by the
  correctness floors that are derivable. They are not placed by cost.
- **Disk.** No table size, index size or total database size was measured.
- **Whether pruning would help the slow reads.** The two unbounded aggregates
  #2843 measures are already `WHERE`-bounded to a 7-day window, so a retention
  policy may change their cost very little. That is a reason to measure before
  registering a cron, not a reason to skip the policy.
- **The legal retention horizon** for `invoice_records` and
  `fiscal_registration_records`. Stated as a jurisdiction question and left
  open.

## References

- [ADR-072](../architecture/adrs/072-append-only-table-retention.md) - the
  decision and the mechanism design
- [docs/operations/redis-stream-retention.md](./redis-stream-retention.md) -
  the Redis half, which does have retention (#2163)
- `apps/prestashop-module/openlinker/classes/OutboxRepository.php` - the shop
  module's outbox retention, the shape this copies (#2604)
- #2843 - supplies the row count and growth rate. Until it runs, no window on
  this page is sized against measured data.
- #2590 - `perf/prestashop-baseline/results-D-2026-08-28.md:96-105` records
  `sync_jobs` falling from 33 537 to 30 933 during that campaign, because every
  runner purges the queue. That report's own read-path figure is labelled *"not
  exercised at a large history"* for the same reason.
