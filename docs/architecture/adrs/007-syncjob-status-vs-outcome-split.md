# ADR-007: SyncJob status-vs-outcome split

- **Status**: Accepted
- **Date**: 2026-04-15
- **Authors**: OpenLinker maintainers (retrospective documentation of decisions made across PRs #391, #400)

## Context

`SyncJob` is the durable record of every background operation OpenLinker runs (offer create, inventory propagate, order sync, …). It started life with a single `status` column carrying both orchestration state ("is the worker actively running this?") and business outcome ("did the job's domain operation succeed?"). The conflation produced ambiguous queries — `WHERE status = 'failed'` mixed "the worker crashed retrying" with "the marketplace rejected our payload as invalid" — and gave the UI no way to distinguish "infrastructure flake, retry-eligible" from "permanent business failure, needs operator review."

The most visible symptom: offer-creation failures from Allegro 422 validation errors looked identical to transient HTTP 503 worker retries.

## Decision

Split into **two orthogonal columns** on `sync_jobs`:

- `status: 'queued' | 'running' | 'succeeded' | 'dead'` — orchestration. Tracks where the job is in the worker lifecycle.
- `outcome: 'ok' | 'business_failure' | null` — business result. Set only on the `succeeded` path; `null` everywhere else.

Each `SyncJobHandler.execute()` returns a typed `SyncJobHandlerResult` whose `outcome` field the runner persists via `markSucceeded(id, outcome)` — atomic with the `status` flip. A job that reaches `dead` after retry exhaustion is *orchestration-failed* (the worker gave up); a job that reaches `succeeded + business_failure` is *business-failed* (we got a deterministic "no" from the platform that's not worth retrying).

`OfferCreationExecutionService` was the first handler to derive `business_failure` from a terminal-rejection branch. Other handlers return `'ok'` mechanically until they grow their own domain-failure semantics.

## Alternatives considered

- **Keep a single status with more values** (`'succeeded' | 'business_failed' | 'dead' | …`) — Rejected: every consumer doing status-based reasoning needs to know which subset is "actually done." Composability is worse than two independent enums.
- **Make outcome a JSON sidecar on success** — Rejected: query overhead (JSON-path predicates), and a sidecar makes "did this job business-succeed?" a complex query when it should be a column-level predicate.
- **Track business outcome only via a separate `sync_job_failures` table** — Rejected: scattered state. Reading "the result of job X" should be one row read, not a join.

## Consequences

**Pros:**
- Queries are sharp: `WHERE status = 'dead'` is infrastructure failure; `WHERE status = 'succeeded' AND outcome = 'business_failure'` is permanent business rejection.
- Worker retry policy reads only `status`; business-outcome consumers read only `outcome`. No false-positive cross-coupling.
- Adding a third outcome value (e.g., `partial_success` for batch jobs) is a column-value addition, not a schema redesign.

**Cons / trade-offs:**
- Two columns to keep consistent. The `markSucceeded(id, outcome)` API enforces atomicity; ad-hoc updates that touch only one are a footgun.
- "Did this succeed?" now has two correct definitions (orchestrationally vs. business-wise). Callers must say which they mean.
- Existing handlers default to `outcome='ok'` mechanically until they grow domain-failure branches; risk of "outcome looks reliable but most handlers don't compute it" until coverage catches up.

## Amendment (#2613 / #2617) - a third arm on the retry ladder: penalty-free deferral, and the budget that keeps it finite

This ADR splits *orchestration* from *business result*. It says nothing about a third case the concurrency work made common: a failure that is **neither** - not the job's own fault and not a deterministic "no" from the platform. A destination throttling us (429), a destination in maintenance (503), a rate-limit slot that timed out, or a write refused because a peer held the serialisation lock ([ADR-067](./067-freshness-token-write-ordering.md)) are all evidence about the world at that instant, not about the job.

Spending a retry attempt on those walks a healthy job toward `dead` for reasons it cannot influence. So the runner **requeues without consuming an attempt** (`requeueWithoutPenalty`): `status` returns to `queued` with a future `nextRunAt`, `attempts` is deliberately left standing, and `outcome` stays `null` - the job has not succeeded, so the outcome column is untouched. The two columns' meanings are unchanged; deferral is a new arm on the path *between* them.

**A deferral must be bounded, or a job becomes immortal.** A deferral consumes no attempt, so a destination answering 503 for ever would recycle its jobs for ever and never reach `dead` - the terminal state an operator's alerting reads. `sync_jobs.deferredTotalMs` (nullable integer, no default, `NULL` = never deferred) accumulates the wait GRANTED to the job; once the next grant would pass the budget (`OL_JOB_MAX_DEFERRED_WAIT_SECONDS`, default 24 h) the job **rejoins the ordinary ladder** at `attempts + 1` and can reach `dead` exactly as before.

Four properties are load-bearing.

- **A cumulative time budget, not a deferral count.** The grants differ by an order of magnitude by reason, so a count would mean a different amount of patience per reason.
- **A deferral never beats a terminal answer.** The deferral check runs only when the non-retryable check said no, because both registry lookups OR across every registered classifier - so a cause one plugin calls deterministic and another reports as deferrable must die rather than defer for ever.
- **The grant is coerced and clamped, not trusted.** A platform adapter reports it through the optional `RetryClassifierPort.getRetryDeferral`, probed at runtime rather than trusted to the type ([ADR-046](./046-adapter-declared-description-format.md)'s shape); a non-positive or non-finite delay is ignored and anything above one hour is clamped, so a buggy plugin cannot park a job for decades. The one core-recognised cause is `ContendedWriteError`, which no platform classifier could see.
- **A deferred job is visible AS deferred**, not merely as queued. The reason and the spent budget are written into `lastError`, and the jobs surfaces render `deferred` beside the attempts counter that a deferral deliberately leaves standing still. Without that, an unmoving attempts count on a `queued` row reads as a stuck worker.

One reporting detail follows from the split this ADR made: the recorded attempt duration is honest about what ran. A 429 or 503 means the handler executed and spent real time before the destination turned it away, so that path writes `lastAttemptDurationMs`; the paths where nothing executed (a rate-limit slot that never opened, a job killed for having no registered handler) **clear** the column rather than leaving an earlier attempt's number beside a new state.

The lane-occupancy half of this decision is recorded in [ADR-050](./050-workload-isolation-concurrency-lanes.md) § Amendment (#2613). The whole ladder - attempts, backoff, dead, and this third arm - lives in these two ADRs and nowhere else; a standalone ADR for the deferral was rejected precisely so it does not end up described in three places.

## References

- Primary doc: [docs/architecture-overview.md](../../architecture-overview.md) § Sync Manager.
- Related ADRs: [ADR-005](./005-postgres-authoritative-job-dedup.md) (the upstream webhook → job flow this consumes); [ADR-050](./050-workload-isolation-concurrency-lanes.md) (lanes, and the deferral's lane-occupancy half); [ADR-067](./067-freshness-token-write-ordering.md) (the contended-write refusal the deferral carries).
- Related PRs: #391 (initial outcome thinking), #400 (`status`/`outcome` split + `markSucceeded` API), #2613 (penalty-free deferral + `deferredTotalMs`), #2617 (the contended-write cause).
