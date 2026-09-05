# ADR-072: Retention for the append-only tables

- **Status**: Proposed
- **Date**: 2026-09-05
- **Authors**: @norbert-kulus-blockydevs

## Context

Nothing in the OpenLinker database is deleted by age. Of the **79 tables** in
the schema, **39 grow without bound and have no delete path at all** - 21 whose
growth tracks elapsed time and job cadence, 18 more at business-record grain.
The full inventory, with a proposed window and a stated loss per table, is
[docs/operations/data-retention.md](../../operations/data-retention.md).

Four places in the source already say so, and one of them cannot ship the
sentence its own spec asks for: the automation run log renders *"Every
automation run recorded so far is listed here"* instead of *"Runs older than 90
days are removed"*, because nothing removes them
(`automation.copy.ts:474-485`). None of the 34 registered scheduler tasks is
cleanup-shaped. The only retention this project has already reasoned about is
PHP, in the shop module (`OutboxRepository.php:110-145`, `runRetention()` at
1013).

Two constraints shape any answer. `sync_jobs.idempotencyKey` is globally unique
with no predicate and no expiry, so deleting a row makes a previously
deduplicated key re-enqueueable - a correctness property, not a disk one. And
the row count at which any of this becomes urgent is **unmeasured**: #2843 is
the designated input and has not run, so no window here is sized against data.

## Decision

**One mechanism, a window per table class, and no cron until #2843 has run.**

1. **A per-table registry** declares what is prunable: table, age column,
   terminal predicate, window setting key, and the reason. One list, read by
   the handler and asserted against the operator page, so code and documentation
   cannot drift.
2. **One job**, `retention.prune`, global scope under the nil-UUID
   `SYSTEM_CONNECTION_ID`, `bulk` lane, registered beside
   `inventory-provenance-backfill`. `OL_RETENTION_PRUNE_ENABLED` defaults to
   **`false`** and `OL_RETENTION_PRUNE_CRON` to `17 3 * * *`.
3. **Frontier-as-query, not scan-offset**, and no cursor. Every page consumes
   its own selection, so an advancing offset steps over rows - the distinction
   `bounded-sweep.ts` draws in its own header, and the reasoning #2317 recorded
   verbatim. The sweep *primitives* (`resolveSweepBudget`,
   `resolveSweepLockTtlMs`, `sweepLockKey`) are reused; the offset machinery is
   not.
4. **Bounded deletes.** `DELETE ... WHERE id IN (SELECT id ... WHERE <predicate>
   ORDER BY <age col> LIMIT n FOR UPDATE SKIP LOCKED)`, 1 000 rows per statement
   and 10 statements per table per pass - the PHP module's constants. A pass
   that spends its budget reports `drainPending` and the next tick continues.
   `SKIP LOCKED` is what keeps it off a row a live writer holds.
5. **Only terminal rows, ever.** The module's first rule.
6. **A dry-run mode**, `OL_RETENTION_PRUNE_DRY_RUN`, default `true` on first
   ship: it counts what it would delete and deletes nothing. That is how
   #2843's figure becomes actionable without a destructive first run.
7. **Windows resolve through `operational_settings`** on the #2651
   `row -> env -> default` ladder, so a change reaches a running worker with no
   restart and the settings page reports the resolved value with its `source`.

**Three exclusions are load-bearing.** No table that is the parent of an
`ON DELETE CASCADE` may enter the registry: pruning `fulfillment_works` silently
destroys `fulfillment_progress_claims` (permanent replay memory) and
`fulfillment_work_rejections` (the re-sourcing exclusion set) with it. No table
whose uniqueness is an at-most-once claim may enter it -
`automation_trigger_firings`, `fulfillment_progress_claims`,
`return_line_events`, `fulfillment_work_verifications`. And no fiscal record.

**`sync_jobs` gets 90 days on terminal rows, with a hard floor of 7.** Below 7
days the Redis `jobdedup:{key}` mark is still standing, so the prune changes
nothing about dedup while blinding the connection health panel, whose historical
half reads a fixed 7-day window. At or past 7 days the Postgres row is the sole
guard and deleting it fully re-arms the key - and on the webhook path the job is
inserted *before* the delivery row, so keeping `webhook_deliveries` does not
prevent the re-run. 90 days is defensible because every re-run that is harmful
rather than merely wasteful is caught by a second durable guard in its own
context's table (invoice, fiscal, refund, return-event, progress-claim,
routing), and this policy retains all of them forever. **That is a standing
condition, not a one-time check**: giving any of those tables a window of its
own re-opens the question.

## Alternatives considered

- **A prune per context, each owning its own table.** Rejected: 39 tables would
  mean 39 places to get the bounded-delete and terminal-only rules right, and
  the shop module already proved those rules are subtle enough to need
  comments. One mechanism, many declarations.
- **A hard row cap instead of an age window** (the module's
  `RETENTION_MAX_ROWS`). Rejected as the primary rule: a cap deletes the oldest
  rows under exactly the burst it was sized for, and here the oldest rows are
  the audit an operator reaches for after an incident. Worth adding later as a
  ceiling behind the age horizons, as the module does.
- **Ship the cron now with conservative windows.** Rejected: deletion is
  irreversible, no window is sized against a measured growth rate, and a
  registered cron that deletes production data must not land on an
  unmeasured guess. The dry run is the honest first step.
- **Partition `sync_jobs` by month and drop partitions.** Genuinely attractive
  for the worst table and rejected only for now: it needs a migration on the
  hottest table in the system, and the unique `idempotencyKey` index would have
  to become part of the partition key or be dropped, which changes the dedup
  property this ADR is otherwise careful to preserve.

## Consequences

**Pros:**
- The operator page can state what is kept and for how long, which today it
  cannot.
- The automation run log can ship the sentence its spec asks for.
- The two knowingly-unbounded aggregates #2843 measures get a bound that is a
  policy rather than an accident of `createdAt >= now() - 7 days`.

**Cons / trade-offs:**
- Every window here is a judgement, not a measurement. They are wrong until
  #2843 runs, and the dry run exists to say by how much.
- `sync_jobs` has no standalone `createdAt` index, only `(connectionId,
  createdAt)`. A global age prune sequential-scans the table this exists
  because it is large. Iterating per connection, or a partial index on the
  terminal statuses, is a prerequisite.
- The re-enqueue property becomes an operator-visible behaviour change: past
  the window, a redelivered webhook or a rewound cursor re-runs work that used
  to be silently deduplicated.
- PII erasure is **not** solved here. `customer_projections` and
  `customer_address_projections` need subject erasure on request, which is a
  different mechanism with a different trigger.

**Migration path:**
- Ship the registry, the handler and the dry run first; leave the task
  unregistered or default-off.
- Run #2843, then size the windows against its growth rate and record the date
  the figure was taken.
- Register the task, still default-off, and enable it on one install with the
  dry run on.

## References

- Related issues: #2862 (this work), #2843 (the measurement that sizes it),
  #2840 (the programme), #2590 (`results-D-2026-08-28.md:96-105`), #2604 (the
  shop module's outbox retention), #2163 (Redis stream retention), #2656 (may
  change `sync_jobs` access patterns - re-check the index assumptions if it
  lands first)
- Related ADRs: [ADR-005](./005-postgres-authoritative-job-dedup.md) (the
  `idempotencyKey` guarantee this must not break),
  [ADR-050](./050-workload-isolation-concurrency-lanes.md) (lane choice),
  [ADR-069](./069-operator-settable-sweep-pacing.md) (the settings ladder the
  windows resolve through)
- Primary doc section:
  [docs/operations/data-retention.md](../../operations/data-retention.md)
