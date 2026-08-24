# ADR-057: Superseding ADR-017 for authoritative re-ingestion

- **Status**: Proposed.
  R1: restated as a **supersession** — "amends without superseding" is not an operation this
  repo's ADR practice defines, and this ADR's predicate *replaces* ADR-017's.
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

[ADR-017](./017-cross-origin-order-reingestion-guard.md) skips re-ingestion of an order re-read
from a connection other than its source — correct for today's topology, where a non-source
re-reader is always a **destination echo** (OL created the order there; re-ingesting it would
loop). Its Consequences flag the guard's *directional fragility* ("if shop→marketplace order push
is ever added, this guard would skip legitimate updates") — but that names OL pushing orders
outward; the gateway posture ([ADR-052](./052-independently-assignable-fulfillment-authorities.md))
is a **second, unanticipated expiry condition**: a third-party non-destination re-reader that is
the legitimate later authority on an order OL first ingested from a marketplace. Two further facts
constrain the fix: the defect ADR-017 fixed was not "re-ingestion happened" but that
`persistOrder`'s upsert **clobbers** `sourceConnectionId`/`sourceEventId`/the snapshot and resets
`syncStatus[]` (#940); and the canonical posture-B connection is **both** a destination and the
fact producer for the same order (OL creates the order in the OMS, which then owns it), so a
predicate whose arms are not disjoint silently disables one protection.

## Decision

Replace the source-connection-inequality test with a **total, ordered predicate** supplied by the
authority matrix: **(1)** the re-reader is the order's assigned lifecycle-fact producer (A4 —
declared via the advertised-without-dispatch `LifecycleAuthorityProvider` capability narrowed off
the dispatched `OrderSource`; the assignment is `Connection.config.lifecycleAuthority =
{ mode: 'external', connectionId }` on the source channel, resolved through the shared
`selectAuthorityHolder()` with **inert ambiguity**, and **bound per order at ingestion** so a
config change is prospective-only — R1: without the connection id the predicate was undecidable
with two capable connections) → **ingest, via a dedicated non-clobbering fact path**: vendor label observations, holds,
cancellation land as facts in [ADR-059](./059-order-lifecycle-derived-phase.md)'s model, and the
snapshot upsert is never invoked; **(2)** else the re-reader is a destination of this order →
skip (ADR-017's protection, verbatim); **(3)** else → skip. The both-true row takes arm (1) — the
destination-echo protection is then preserved by the write path's own shape, not by the predicate.
**Precondition**: `persistOrder` becomes source-attribution-immutable (refuses to change
`sourceConnectionId`/`sourceEventId` — the hardening ADR-017 listed and deferred), closing #940's
clobber before any fact producer can be assigned. Every existing install resolves no fact producer
and behaves byte-identically.

## Alternatives considered

- **Weaken the guard (ingest from any non-source reader)**: reintroduces the destination-echo loop
  ADR-017 exists to prevent, including OL's own writes bouncing back.
- **A per-connection "trusted re-reader" boolean**: expresses trust without saying *for what*; the
  same connection can be a destination and the fact producer at once, so the discriminator must be
  a total order over per-order roles, not a per-connection flag.
- **A second ingestion pipeline for OMS pushes**: duplicates `OrderIngestionService` (idempotency,
  locks, cursors, projections) to change one predicate — the two-builds failure in miniature.

## Consequences

**Pros:**
- Posture B's one real ingestion blocker closes with minimal surface; the guard's original
  protection is preserved verbatim for destinations.
- The predicate is supplied by declared configuration, not inferred from traffic.

**Cons / trade-offs:**
- A misdeclared fact producer could echo OL-caused changes; mitigated by ADR-044's
  confirmation-matching (an observed diff matching an open proposal records the confirmation, not
  a new fact).

## Supersedes

- [ADR-017](./017-cross-origin-order-reingestion-guard.md) — superseded because its
  source-connection-inequality predicate is replaced by the total ordered predicate above; its
  destination-echo protection survives verbatim as arm (2). Set ADR-017's status to
  `Superseded by ADR-057` when this merges.

## References

- Related ADRs: [ADR-017](./017-cross-origin-order-reingestion-guard.md), [ADR-044](./044-order-changeset-proposed-then-confirmed.md), [ADR-052](./052-independently-assignable-fulfillment-authorities.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md) §8
- Review record: [REVIEW-oms-authority-model](../../plans/analysis/REVIEW-oms-authority-model.md)
