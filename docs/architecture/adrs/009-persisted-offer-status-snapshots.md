# ADR-009: Persisted offer-status snapshots

- **Status**: Accepted
- **Date**: 2026-05-23
- **Authors**: @piotrswierzy

## Context

OpenLinker had no persisted, periodically-refreshed marketplace publication status for offers. The `OfferStatusReader.getOfferStatus` capability existed but was wired only into the creation poller (#447), which maps the observation straight into `OfferCreationStatus` and never persists it — the comment in `offer-status-read.types.ts` documented that "OL never persists this enum". `OfferCreationRecord` tracks the one-shot creation lifecycle and is abandoned at a terminal state; offer identity otherwise lives only as an `identifier_mappings` row (`entityType='Offer'`). So nothing reflected an offer going `ended` / `inactive` / sold-out on the marketplace without an on-demand read of each listing.

#816 needs a steady-state refresh that **persists** the live status so operators — and future filters/alerts — can rely on it. The open question was *where* to store `{ publicationStatus, lastStatusSyncedAt }` keyed to `(connectionId, externalOfferId)`.

## Decision

Persist offer publication status in a new, listings-owned `offer_status_snapshots` table (one row per `(connectionId, externalOfferId)`, carrying `internalVariantId`, `publicationStatus`, optional `statusDetails`, and `lastStatusSyncedAt`), refreshed by a new `marketplace.offer.statusSync` job. This intentionally narrows the previously-stated "publication status is never persisted" invariant to the *creation poller* only.

## Alternatives considered

- **New `offer_status_snapshots` table** (chosen): a first-class listings entity, mirroring the `offer_creation_records` pattern. Costs one migration; gains clean domain ownership and indexable `stale` / `ended` / per-status queries.
- **`identifier_mappings.context` JSONB**: zero migration, single-row write. Rejected — it bleeds offer-status (a listings concern) into the cross-cutting identifier-mapping spine that 5+ contexts depend on, and makes "all stale/ended offers" queries require JSONB extraction.
- **Reuse `offer_creation_records`**: rejected — semantic mismatch (creation lifecycle ≠ live status), not keyed to live status, and owned by the poller's write path.

## Consequences

**Pros:**
- Live offer status is queryable and persisted; downstream FE/filters/alerts can build on a stable column.
- Steady-state sync and the creation poller (#447) write disjoint tables — the creation record and the
  snapshot never contend. **Amended by #2039**: the disjoint-*tables* invariant still holds (the terminal
  creation record is never mutated), but `offer_status_snapshots` is no longer single-writer — the create path
  and the poller's `active` terminal now upsert it alongside the steady-state scan and `refreshOne`. Since
  nothing orders those writers, the repository resolves a conflict by **observation freshness**
  (`lastStatusSyncedAt`, monotonic via `GREATEST`) rather than by arrival order. Freshness, not status rank:
  `active → ended → active` is a legitimate sequence, so the rank ladder used for `webhook_deliveries` (#1916)
  does not transfer here.
- Marketplace-agnostic: any adapter implementing `OfferStatusReader` inherits the flow.

**Cons / trade-offs:**
- A `OfferPublicationStatus` union change is no longer purely non-breaking — a removed/renamed member needs a data migration for this table (additions stay additive).
- Snapshots can orphan if an offer is deleted upstream (a cleanup pass is a future follow-up).
- Enumeration loads the connection's offer mappings per run (bounded by page limit); a future optimization is `lastStatusSyncedAt`-ordered/keyset pagination.

**Migration path (if applicable):**
- Additive: `CreateOfferStatusSnapshots` migration adds the table + indexes; no backfill (natural sync churn populates it). No existing behaviour changes.

## Amendment (#1760, 2026-07-22): snapshot becomes the operator-facing live status + post-terminal reconcile

The snapshot table shipped write-only — populated by the hourly `marketplace.offer.statusSync` but read by nothing. #1760 closes that, and formalises the snapshot's role as the **authoritative operator-facing live publication status**, distinct from the creation record:

- **Read surface**: `OfferStatusReadService` + `OfferStatusSnapshotRepositoryPort.findByVariantIds` expose snapshots per product's variants through an authenticated `GET /listings/products/:productId/offer-status`. The FE renders them on the products drawer.
- **Post-terminal reconcile**: when the creation poller (#447) terminalises a record to `draft` or `failed(POLL_TIMEOUT)` — the case where Allegro's validator outran the ~9-min poll budget and later activates the offer — it schedules a bounded, delayed `marketplace.offer.refreshSnapshot` job (~2/8/20 min). The handler calls `OfferStatusSyncService.refreshOne`, which upserts the snapshot, and self-reschedules while the offer is still in-flight. This keeps the two tables disjoint (the creation record is **never** mutated post-terminal — the snapshot is the moving part), preserving the no-race property above while catching late activations well before the hourly backstop.
- A manual `POST .../offers/:externalOfferId/refresh-status` force-reads one offer's live status on operator demand.

This does not change the storage decision or the disjoint-tables invariant; it adds the missing read half and a targeted freshness path on top of the same table.

## Amendment (#2039, 2026-08-12): the create path writes the snapshot it already knows

#1760 made the snapshot the authoritative operator-facing status, but nothing on the **create** path ever wrote
one — `upsert` had exactly two callers, both inside `OfferStatusSyncService`. A freshly published offer
therefore had no live status until the hourly rolling scan reached it, which for a new mapping is the *end* of
the scan cycle (it enters the `createdAt DESC` scan at an offset the cursor has already passed), i.e. ~40 h
worst case on a 4,000-offer catalog. The `draft` branch's reconcile ladder did write, so a rejected offer
looked better-synced than a healthy one.

- **The rule**: persist a status only when an authoritative one is already in hand; otherwise write nothing.
  Adapters report it via an optional `CreateOfferResult.publicationStatus`, set only when the create response
  carried a platform status. Core never coerces the create-status vocabulary
  (`draft | validating | active`) into `OfferPublicationStatus` — only the adapter can map its own raw value,
  and a guessed `inactive` would read as a rejected offer.
- **One write seam**: `IOfferStatusSyncService.recordObservedStatus`, called from the end of
  `OfferCreationExecutionService.executeCreation` (unconditionally, which also covers a failed
  `scheduleFirstPoll`) and from the poller's `active` terminal (the live read just happened; a delayed re-read
  job would be waste). The `POLL_TIMEOUT` / `draft` ladder from the #1760 amendment is unchanged.
- **Never throws.** `loadOrCreateRecord` has no terminal-state guard, so a throw after the adapter create
  would let a job retry re-invoke `createOffer`, and Allegro does not deduplicate product-offer creates. Both
  call sites swallow-and-warn, with the hourly sync as the backstop.
- **Multi-writer consequence**: see the amended § Consequences bullet — `upsert` becomes a freshness-guarded
  `INSERT … ON CONFLICT DO UPDATE`, proven by an integration test (a SQL guard cannot be exercised through a
  mocked repository). Because that guard can now *reject* a write, `OfferStatusUpsertResult` also reports
  `applied`, read from the statement's own `RETURNING` so a concurrent write cannot skew it. The `previousStatus`
  → observed-status comparison only describes a real transition when the write landed, so `OfferStatusSyncService`
  gates its `updated` / `transitioned` counters and its transition log line on `applied`; otherwise a stale
  observation would be reported as an `active → inactive` change while the row still read `active`. Every caller
  also stamps `observedAt` with the instant the marketplace was actually read, so the guard orders observations
  rather than writes.

Erli remains uncovered by design: its create is an async 202 with no status, and its status *read* defaults
unknown wire values to `inactive` — the hazard the review-#1063 scheduler gate suppresses until #992.

Two adjacent defects in the #1760 machinery close with it:

- **The reconcile ladder's idempotency key was offer-id-scoped.**
  `refreshSnapshot:{externalOfferId}:{attempt}` against a globally unique, TTL-less
  `sync_jobs.idempotencyKey` meant one offer id could only ever receive one attempt-1 reconcile — across
  connections (an Erli `externalOfferId` *is* the internal variant id, shared by every Erli connection), across
  re-creates, and across retry waves. A `reconcileId` now identifies one chain: minted at attempt 1, carried
  through the handler's self-rescheduled follow-ups, and folded into the key by a shared builder so the two
  writers cannot drift. It is **optional**, so a chain already in flight across the deploy keeps rescheduling
  under its legacy key instead of dead-lettering. At-most-one chain per terminalisation was never the key's
  duty — the record state machine owns it (`pollOnce` no-ops once the record leaves `validating`).
- **The read surface hid offers it had no snapshot for.** `getPublicationStatusForProduct` returned snapshot
  rows only, so "this product has no offers" and "its offers have no status yet" were the same empty response —
  and because the manual refresh is rendered per returned row, it was unreachable for exactly the offers that
  needed it. It now returns one `OfferPublicationStatusView` per mapped offer, with a null status when unread.

## References

- Related PRs: #816, #1760
- Related issues: #816, #447, #464, #391, #400, #1520, #1760, #2039
- Related ADRs: [ADR-007](./007-syncjob-status-vs-outcome-split.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Listings (Offers)
