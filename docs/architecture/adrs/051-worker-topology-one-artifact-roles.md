# ADR-051: Worker topology — one artifact, four roles, cardinality-driven

- **Status**: Proposed
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

The current API/worker split is not what the names suggest. **The API process owns scheduling**:
`ScheduleModule.forRoot()` is registered only in `apps/api/src/app.module.ts`, `SchedulerService`
is provided by `apps/api/src/sync/sync.module.ts`, and **23 task descriptors** fire there (11
host-side — the ten `CORE_CAPABILITY_TASKS` plus the bespoke `destination-taxonomy-sync` — and 12
plugin-contributed via `SchedulerTaskRegistryService`). The API also hosts the
`events.inbound.webhooks` consumer, whose file header says *"Runs in the API process for MVP"*. The
worker owns job intake, job execution (34 handler types, sequential — ADR-050's subject) and the
master-deletion consumer, and registers no cron of its own.

Which of this may run in more than one process is already decided by the code, unevenly:

- **Job dispatch is N-replica-safe**: `findAndLockDueJobs` uses `FOR UPDATE SKIP LOCKED` +
  per-worker `lockedBy`.
- **Stream consumption is N-replica-safe** since #2164: stable `OL_WORKER_ID` identity
  (`resolveConsumerName`), startup drain, orphan reclaim. (The runner's *DB-lock* identity is still
  the ephemeral `worker-${process.pid}-${Date.now()}` — safe under SKIP LOCKED, but a split worth
  knowing.)
- **The scheduler is a singleton by accident**: no leader election, no lock on cron firing. N API
  replicas ⇒ N duplicate ticks, absorbed only by job idempotency keys.
- **Two periodic loops run once per replica with no lock**: the worker's stuck-job-recovery
  `setInterval` and the API's `demo-account-cleanup` `@Cron`.

Both apps boot everything unconditionally: the worker instantiates a handler provider for every one
of the 34 registered job types, plus the intake consumer, the runner, and all 13 plugin entries;
the API loads the same 13. Every existing role-ish distinction is a runtime flag
inside an already-instantiated provider (`WORKER_INTAKE_ENABLED`, `WORKER_RUNNER_ENABLED`,
`OL_MASTER_DELETION_CONSUMER_ENABLED` — the last documented in **no** `.env.example`). Code sharing
is total: `Dockerfile`'s `FROM production AS worker` differs from `production` only by two `COPY`
lines and the `CMD`. The base `docker-compose.yml` has no `worker` service; the demo overlay runs
exactly two Node app containers (`api`, `worker`); no compose file declares `replicas`.

## Decision

**1. One artifact. Roles are boot configurations of the existing image, never separate services.**
Separate implementations would be four thin shells around one library — every role needs the same
core services, entities, and plugin registry, and the Dockerfile already proves the shells-are-CMDs
point. *Reversal gate (prose-only):* out-of-process plugins (#546 Milestone 3). Until then every
argument for a separate service reduces to an argument for a role.

**2. Four roles, and cardinality — not scaling — is the driver.** The question a role answers is
*"is it correct for this to run twice?"*:

| Role | Instances | Why |
|---|---|---|
| `jobs` | many | already safe — `FOR UPDATE SKIP LOCKED` + per-worker `lockedBy` |
| `events` | many | already safe — stable `OL_WORKER_ID` identity + orphan reclaim (#2164) |
| `scheduler` | **one** | N replicas ⇒ N duplicate cron ticks across 23 task descriptors |
| `maintenance` | **one** | today the unlocked stuck-job-recovery interval and demo-cleanup cron; the home for future destructive periodic work (retention sweeps, partition drops) |

Singleton-ness today holds only because the scheduler sits in the API and nobody scales the API — an
accident, not a design. *Reversal gate (countable):* a singleton role observed running in two
processes (the lease in decision 3 makes this observable rather than silent).

**3. Scheduling moves out of the API process, and singletons are enforced by a lease, not by
deployment discipline.** The `scheduler` role owns cron; the API returns to serving requests. The
mechanism is a `SyncLockPort` lease — the seventh key family, after orders-poll, order-create,
invoice-issue, shipment-dispatch, taxonomy-sync, and WooCommerce customer-provisioning — renewed for
the life of the process, so a second `scheduler` instance parks instead of double-ticking. One
honest caveat about the mechanism: the port's contract today is exactly `acquire(key, ttlMs)` /
`release(key, token)` — the six existing families are short-lived critical sections, and a
process-lifetime lease is a new usage shape, so Wave 4 either adds a token-checked extend to the
port or implements renewal as periodic re-acquire by the same holder; the ADR commits to the lease,
not to the port being sufficient unchanged. The same lease pattern covers `maintenance`. The API-hosted webhook consumer's target home is the `events`
role — deciding that here retires the "MVP shortcut" comment; the move itself is Wave 4.
*Reversal gate (prose-only):* none — this corrects an accidental placement.

**4. A role boots the modules it needs — conditional module imports, never a runtime flag on a
fully-booted graph.** A `scheduler` process must not instantiate 34 job handlers it will never run;
it only enqueues. Today's pattern — boot everything, gate behaviour with env flags inside live
providers — is the anti-pattern this decision names: it spends memory and start-up time on dead
weight and makes "what runs here?" unanswerable from the module graph. *Reversal gate (prose-only):*
a role whose conditional graph diverges enough to need its own package — which is the separate-
artifact conversation, gated by decision 1.

**5. `OL_WORKER_ROLE`, default `all`.** The `OL_` prefix matches `OL_STORE_PII` /
`OL_WEBHOOK_SKEW_WINDOW_MS` (bare `WORKER_INTAKE_ENABLED` predates the convention). Default `all`
preserves the two-container baseline exactly — a small install changes nothing on upgrade. The
variable is documented in **both** `.env.example` files at introduction;
`OL_MASTER_DELETION_CONSUMER_ENABLED`, present in neither, is the mistake not to repeat for an
operator-facing switch. *Reversal gate (prose-only):* not applicable — naming and defaults.

**6. Boot asserts that the enabled roles cover every registered job type and consumer group.** A
role nobody claims does not announce itself — work simply sits. The failure mode already exists in
prose-only form; the assertion makes it loud: a deployment whose union of roles leaves a jobType
unpullable or a consumer group unserved fails at startup with the uncovered names. *Reversal gate
(countable):* the assertion itself is the countable check; #2169 wires the same rule into
`check:invariants` for the static half (every registered jobType maps to a role).

## Alternatives considered

- **Separate services per role**: four deployables around one library, quadrupling containers for a
  self-hoster who runs two — rejected by decision 1, gated on #546 M3.
- **Leave scheduling in the API**: keeps ~23 cron tasks and their marketplace calls in the
  request-serving process, and keeps the singleton accidental. Rejected by decision 3.
- **Runtime flags on the fully-booted graph** (the current pattern, extended): cheapest to write,
  but every process pays full boot cost and the module graph stops describing the deployment.
  Rejected by decision 4.
- **External leader-election machinery** (Kubernetes leases, a Redlock library): correct but new
  operational surface; `SyncLockPort` already serialises six key families with the same
  SET-NX-PX-plus-token shape and is sufficient for a lease whose failure mode is a missed tick, not
  a split brain. Rejected by decision 3.

## Consequences

**Pros:**
- `jobs` and `events` can scale to N with documented safety instead of folklore.
- Cron leaves the request path; singleton-ness becomes enforced and observable instead of
  accidental.
- The two-container default install is byte-for-byte preserved (`OL_WORKER_ROLE=all`).
- Singleton roles boot a fraction of the module graph — less memory, faster start, and "what runs
  here?" readable from the graph again.

**Cons / trade-offs:**
- Conditional module composition is real complexity in a NestJS graph that is unconditional today.
- Role misconfiguration becomes a new failure class — bounded by decision 6's startup assertion.
- A scheduler lease introduces renewal/TTL semantics for a long-lived singleton; a crashed holder
  delays ticks by up to the lease TTL, which is acceptable for cron but must be sized deliberately.

**Migration path:**
- Wave 4 (#2162) implements: role flag + conditional imports, scheduler extraction with its lease,
  webhook consumer to the `events` role, `.env.example` documentation in both apps, the startup
  coverage assertion.
- #1136's scaling guide documents the operator-facing role matrix.
- ADR-050's lanes are orthogonal and land independently (Wave 3); roles decide *where* work runs,
  lanes decide *how much at once*.

## References

- Related issues: #2168, #2162, #546, #1136, #2164, #2169
- Related ADRs: [ADR-003](./003-plugin-sdk-trust-model.md),
  [ADR-049](./049-durability-spine-and-domain-event-contract.md),
  [ADR-050](./050-workload-isolation-concurrency-lanes.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Module
  Organization
