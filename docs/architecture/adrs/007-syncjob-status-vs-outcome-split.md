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

## References

- Primary doc: [docs/architecture-overview.md](../../architecture-overview.md) § Sync Manager.
- Related ADRs: [ADR-005](./005-postgres-authoritative-job-dedup.md) (the upstream webhook → job flow this consumes).
- Related PRs: #391 (initial outcome thinking), #400 (`status`/`outcome` split + `markSucceeded` API).
