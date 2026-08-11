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
- Steady-state sync and the creation poller (#447) write disjoint tables — no coordination or race.
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

## Amendment (#2024, 2026-08-11): channel-side commercial snapshots ride the same status read

The listings redesign needs each mapped offer's **live channel-side price and available quantity**, at list
scale, without spending a second marketplace call per offer per tick. #2024 adds a second listings-owned
table, `offer_commercial_snapshots` (one row per `(connectionId, externalOfferId)`, carrying
`internalVariantId`, nullable `price` / `currency` / `availableQuantity`, and `lastCommercialSyncedAt`),
written by the same `marketplace.offer.statusSync` pass and by the same `refreshOne` path (#1760).

**The data is carried on the status read** - `OfferStatusReadResult` gains an optional `commercial` field
that adapters populate off the response they already fetched - rather than by calling `OfferReader.getOffer`
alongside it. Three independent reasons:

1. **`getOffer` really would cost a second HTTP call.** Allegro's `getOfferStatus` and `getOffer` both route
   through the same private `fetchProductOfferById`, and Erli's both route through `fetchErliProduct`, with
   no memoization on either helper. Each invocation is its own GET, so calling both is +1 request per offer
   per tick - exactly what #2024 rules out.
2. **Calling `getOffer` *instead* would be worse.** `MarketplaceOffer.status` is a deliberate raw-string
   passthrough (Allegro emits uppercase native, Erli its own vocabulary), while
   `offer_status_snapshots.publicationStatus` persists the closed neutral union this ADR established.
   Swapping the call would force per-platform status mapping into a core service (a CORE/Integration
   boundary violation) or corrupt the snapshot column.
3. **It would silently drop a side effect.** Erli's `getOfferStatus` writes the frozen-stock cache flag
   (#1066); `getOffer` does not. `getOffer` is not a superset of `getOfferStatus`.

The **disjoint-tables invariant still holds**, and is in fact the reason for a new table rather than extra
columns on `offer_status_snapshots`: the steady-state sync and the creation poller (#447) continue to write
tables neither one else touches, and the commercial write is a third disjoint target with a single writer.
The `OfferStatusReader` method signature is unchanged, so there is no manifest change, no `dispatchCapability`
entry, and every existing or third-party implementer still compiles - a reader that never populates
`commercial` behaves exactly as it did before.

Two nullability rules follow from the table being *observational*:

- **Every column of the observation is independently nullable, and `null` never means zero.** A sparse
  marketplace response persists "not reported", because a stored `0` is indistinguishable from a genuine
  sell-out at list scale, and a stored `0.00` from a free item. Price and quantity are nullable separately so
  a good reading on one axis is never discarded because the other was missing; the row (and its freshness
  stamp) is written whenever the read succeeded.
- **The values are what the marketplace reports, not what OL intended to publish** - already net of the
  connection's `stockSafetyBuffer` (#1844) and already the output of its `pricingRule` (#1843). A constant
  delta against master is correct configuration, not a sync defect, and operator-facing surfaces must read
  "on channel".

Finally, the commercial write is **strictly supplementary**: it is wrapped in a catch that warn-logs and
continues, so a failed commercial write can never abort the pre-existing #816 status pass nor prevent its
`nextOffset` cursor from advancing. Without that, one poison offer would wedge a connection's status sync
indefinitely.

**Migration path:** additive - `AddOfferCommercialSnapshotsTable1832000000008` adds the table + indexes
(unique `(externalOfferId, connectionId)`, reverse-variant, and `lastCommercialSyncedAt` for stalest-first
sweeps); no backfill, so rows fill at the sync's natural page rate. No existing behaviour changes.

## References

- Related PRs: #816, #1760, #2035
- Related issues: #816, #447, #464, #391, #400, #1520, #1760, #2024
- Related ADRs: [ADR-007](./007-syncjob-status-vs-outcome-split.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Listings (Offers)
