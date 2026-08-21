# ADR-049: Durability spine and the domain-event contract

- **Status**: Proposed
- **Date**: 2026-08-20
- **Authors**: @piotrswierzy

## Context

OL has three "event" streams and **zero fan-out**. Each has at most one consumer, and each consumer
does exactly one thing: turn the event into a job. `events.sync.jobs` has no consumer at all — a
publisher, a barrel export, a spec, and nothing reading it. By the standard test (*if the producer
expects a specific outcome, it is a command wearing event clothing*), all three are commands. The
streams buy indirection, not decoupling.

Durability sits **after** the indirection. On the webhook path: HTTP → `webhook_deliveries` row →
XADD → consumer → routing → XADD → consumer → `sync_jobs` row. Seven hops before the work is
durable, four with no crash recovery until #2164.

Three facts constrain any answer.

**Redis holds the sole record of several facts.** Not by design — by accumulation. `jobdedup:*` keys
(a 7-day `SET NX` gate with no durable counterpart), every un-ACKed Pending Entries List entry, and
`events.master.deletion.dead` (whose write is the only record that a deletion event was discarded).
`docker-compose.yml` mounts a volume but declares no `appendonly`/`save` policy, so the default RDB
snapshotting applies: an unclean stop can lose the last snapshot interval *and* all consumer-group
state and PELs.

**Ids are assigned before commit, so id order is not visibility order.** A transaction holding a
lower id can commit after one holding a higher id. A reader advancing a scalar `id > cursor` past the
gap never sees the earlier row again — silently, permanently, and invisibly to a lag metric.

**The Redis version floor is 6.2.** The dev stack runs `redis:8.4-alpine`, integration tests run
`redis:7-alpine`, and #1396 proposes `valkey/valkey:8-alpine`. Valkey froze Streams near the 7.0
feature set, so Redis 8.2's PEL-aware trim modes (`XDELEX`, `KEEPREF`/`DELREF`) are unavailable on
two of three targets.

## Decision

**Nine decisions. Most are a decision not to build something.**

**1. The spine is the work row, written in the same transaction as the business change.** When a
business fact and the work it implies commit together, the outbox and the queue are the same table,
the fire-after-commit window disappears, and the at-most-once caveat documented in
`master-deletion-events.types.ts` becomes unnecessary. Redis becomes a *wake-up hint*, not a system
of record. *Reversal gate (prose-only):* a durable work row is contended enough to show measurable write
amplification on the business transaction — observable as p99 latency on the enclosing write.

**2. Build the contract; keep exactly one transport implementation. Do not build a general bus.**
With zero fan-out, a bus is speculative infrastructure; but the *contract* (envelope shape, identity
rule, payload constraints) is cheap now and expensive to retrofit once producers ship against its
absence. *Reversal gate (countable):* the first stream to acquire a **second independent consumer** — a consumer
that is not a job-creating shim — at which point the transport question is reopened.

**3. If a bus: a composite cursor plus a visibility barrier. Never a scalar `id > cursor`.** A
reader must not advance past a position that a still-in-flight transaction can later fill. The
known-good shape is a composite cursor read below a barrier set at the oldest in-flight transaction.
*Reversal gate (prose-only):* not applicable while decision 2 holds — this decision exists so that the shape is
already settled if it is.

**4. `eventId` is derived from the business fact, never minted at insert.** A transaction retry
would otherwise produce two identities for one fact, and consumer-side dedup could not collapse
them. Derivation is deterministic from the identifiers already in the payload. *Reversal gate (prose-only):* a
fact is found whose natural key is not stable across a retry.

**5. No `EntityManager` in a core port signature.** Domain-layer independence (ADR-001) forbids a
persistence handle in a port. Composition belongs in the repository performing the business write,
or behind an opaque transaction handle owned by `events`. *Reversal gate (prose-only):* none — this follows from
an existing decision.

**6. Payload schemas are structurally incapable of carrying PII.** Allowlisted identifiers and
scalars, validated at catalog registration. A months-retained log is a new PII surface that
`OL_STORE_PII` does not cover, and redaction-on-write fails open — a new field ships unredacted
until someone notices. Structural exclusion fails closed. *Reversal gate (prose-only):* a consumer requires a
field that cannot be expressed as an identifier or scalar.

**7. Catalog enforcement is registration-time validation, not a central type union.** Compile-time
enforcement needs a union importing from `orders`, `products`, `listings`, `invoicing` — inverting
the infrastructure spine, since `events` is depended upon by those contexts and must not depend back.
Registration-time validation is the shape `AdapterRegistryService` already uses. *Reversal gate (countable):*
`events` gains a legitimate compile-time dependency on every producing context (i.e. the spine is
restructured).

**8. Nothing depends on a stream primitive above Redis 6.2.** `XPENDING` / `XCLAIM` / `XRANGE` /
plain `MAXLEN` and `MINID` only. (`XAUTOCLAIM` is also 6.2, but #2164 deliberately does not use it:
node-redis throws while transforming a reply that describes a trimmed entry, so recovery is built
from `XPENDING` + `XCLAIM` + `XRANGE`, whose replies it can always transform.) This keeps #1396 (Valkey) a drop-in retag rather than a redesign, and it
is a further argument for Postgres as the transport of record: the durable path then does not care
which engine serves the hint. *Reversal gate (prose-only):* #1396 is closed without merging **and** a newer
primitive measurably fixes a problem the 6.2 floor cannot.

**9. Redis is never the sole record of a fact.** Stated because it is currently false in at least
three places (see Context). Each is tracked to a durable counterpart or an accepted, documented loss:
the master-deletion DLQ gets an age bound rather than a count bound so an incident's first entries
survive (#2163); `jobdedup:*` is a Redis-authoritative gate whose loss window is bounded by the
retention horizon exceeding its TTL; PEL entries become recoverable via #2164. *Reversal gate (prose-only):* any
new write that makes Redis the only record of an operator-visible fact.

## Alternatives considered

- **Broker as system of record** (RabbitMQ/Kafka): real durability and real fan-out, but adds an
  operational dependency to a project whose distribution constraint is a single `docker-compose up`,
  and buys fan-out that has zero consumers today. Rejected on cost-without-benefit, not on merit.
- **General transactional outbox with a relay process**: the textbook answer, and strictly more
  machinery than decision 1 — which gets the same atomicity by making the work row *be* the outbox
  row. A relay is warranted when several heterogeneous consumers need the same fact; that is the
  condition in decision 2's reversal gate. Rejected as premature.
- **Durable-execution engine**: Temporal fails the docker-compose distribution constraint outright.
  DBOS is the honest library-in-Postgres alternative and is not rejected on merit — it is deferred
  because adopting it means adopting its programming model across every handler, which is a larger
  change than the defect being fixed. Named so a future reader knows it was weighed.
- **CloudEvents**: a real standard with real tooling, but the value is interoperability with external
  producers/consumers, and every producer and consumer here is in-repo. Adopting the envelope now
  would be conformance without a counterparty. Revisit alongside outbound webhooks.
- **Event-carried state transfer** (fat events instead of thin notification): removes the consumer's
  read-back, but multiplies the PII surface decision 6 exists to close and makes every payload a
  versioned contract. Rejected — thin notification plus an authoritative re-read is already the
  established pattern (`PaymentStatusReader`, the master-deletion `isStale` re-verify).

## Consequences

**Pros:**
- The durable write moves to hop one on the paths that adopt decision 1, from hop seven.
- The contract is fixed now, so producers cannot ship divergent envelope shapes while the transport
  question stays open.
- #1396 stays a retag. No design work is stranded by a Valkey swap.
- The PII posture of a retained log is decided rather than inherited.

**Cons / trade-offs:**
- Decision 2 leaves real indirection in place: three streams that are commands, not events. This is
  accepted, with a named gate, rather than pretended away.
- Decision 6 will eventually block a consumer that wants a human-readable field, forcing a read-back.
  That is the intended trade.
- Decision 7 means a malformed payload is caught at registration, not at compile time — a later
  signal than a type union would give.
- Decision 1 is stated but not yet implemented anywhere; it constrains future work rather than
  changing current behaviour.

**Known gap — no terminal state for a poison entry.** #2164 makes repeated delivery
reachable for the first time (before it, a failing entry was simply never redelivered), so an
entry whose handler always throws is now retried indefinitely. Per-entry error isolation stops it
starving its siblings, the drain pages forward with an exclusive cursor so one stuck entry cannot
re-present its own page (which would stall boot rather than merely skip work), and a per-consumer
`RecoveryAttemptTracker` alarms once on crossing `MAX_RECOVERY_ATTEMPTS`.

That counter is deliberately **local, not Redis'**. `deliveriesCounter` is incremented only on an
actual delivery (`XREADGROUP` / `XCLAIM`); the drain path is `XPENDING` + `XRANGE`, both pure reads,
so keying the alarm on it would leave it unreachable on precisely the path where poison
accumulates. What is deliberately *not* done is
auto-dead-lettering: two of the three consumers cannot construct their dead-letter payload from a
raw pending entry (the webhook handler needs a decoded event, job-intake a parsed job request), and
discarding the entry instead would be unrecoverable loss. *Reversal gate (prose-only):* the first
poison entry
observed in production, or the Wave 5 spine (decision 1) removing the PEL from the durable path
entirely.

**Migration path:**
- #2164 makes PEL entries recoverable (stable identity, startup drain, orphan reclaim).
- #2163 bounds every stream and makes the Redis memory policy explicit.
- Wave 5 implements decision 1 on the webhook path first, where loss is least detectable.
- `events.sync.jobs` is removed rather than consumed (#2163) — the clearest instance of decision 2's
  reasoning applied to an existing stream.

## References

- Related issues: #2162, #2163, #2164, #2165, #1135, #1134, #1396
- Related ADRs: [ADR-001](./001-hexagonal-architecture-and-bounded-contexts.md),
  [ADR-005](./005-postgres-authoritative-job-dedup.md),
  [ADR-007](./007-syncjob-status-vs-outcome-split.md),
  [ADR-015](./015-inbound-event-routing-capability-translated.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Data Flow
