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

## References

- Related PRs: #816
- Related issues: #816, #447, #464, #391, #400
- Related ADRs: [ADR-007](./007-syncjob-status-vs-outcome-split.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Listings (Offers)
