# ADR-072: Recurring price propagation is opt-in, destination-owned, and cost-blind by necessity

- **Status**: Proposed
- **Date**: 2026-09-10
- **Authors**: @norbert-kulus-blockydevs

## Context

`applyPricingRule`/`readPricingRule` (`libs/core/src/identifier-mapping/domain/types/pricing-rule.types.ts`) compute a destination price from the master catalog price only at offer-create / product-publish time (`OfferBuilderService.buildCreateOfferCommand`, `ProductPublishBuilderService.buildPublishProductCommand` — confirmed the only two call sites by grep). There is no ongoing re-price: a later master-price change never reaches an already-published listing. #3010 named this gap and deferred it as a product decision, since silent price propagation has a direct commercial consequence for the operator.

A design session (interactive mockup, iterated across many review rounds including 6 specialist sub-agent reviews and a real-codebase backend-gap audit) converged on: opt-in, per (source connection, destination connection) pair, surfaced as a review queue. This ADR records the resulting architectural decisions, several of which reverse or extend existing patterns.

## Decision

Build `price_change_episodes` (a new aggregate in the existing `listings` context) plus a default + per-source-override extension to `Connection.config.pricingRule`, and a review queue UI. Eight sub-decisions follow.

**1. Episode pattern, not per-event rows.** `price_change_episodes` mirrors `ReservationShortfallEpisode` (`libs/core/src/inventory/domain/entities/reservation-shortfall-episode.entity.ts`): a row opened once, a partial unique index enforcing at most one OPEN row per `(productVariantId, destinationConnectionId, sourceConnectionId)`, re-detection updates the same open row.

**2. Pricing rule ownership: destination, not source.** A default rule + optional per-source overrides live on the DESTINATION connection. The feeding source connection's own page gets a read-only rollup, never its own editable copy.

**3. Two sync modes, not three.** `Manual review` / `Automatic`. A `Digest` mode was considered and cut.

**4. Currency: same-currency only in v1.** A mismatch is a persisted `blockReason`, following the `SalesDocumentBlockOutcome` pattern (`libs/core/src/sales-documents`).

**5. Pinned/custom price is a new mechanism.** Not a reuse of the destination-reported `frozen` field (#2262).

**6. No margin/profitability warning.** Only a magnitude signal (≥10% change).

**7. Bulk apply reuses `BulkOfferCreationBatch` / `bulk_batch_advancements`.**

**8. Publish failure follows ADR-007's status/outcome split.**

## Alternatives considered

- **A flat insert-per-detection-event row** instead of the episode pattern. Rejected: a re-detected change before review duplicates rows, and nothing tracks "this is the same pending decision, updated."
- **Rules on the source connection** (each source lists every destination it feeds, with its own rule per destination). Rejected: `Connection.config.pricingRule` is already destination-scoped in the shipped code, the common cardinality is one destination fed by several sources (not the reverse — a marketplace's fee structure is a property of the marketplace, not of any one supplier), and `StockAndPricingSection`'s existing precedent is "this connection's page describes this connection's own outbound behavior." A neutral sub-agent, given both models with no steer, reached the same conclusion independently.
- **A third `Digest` sync mode** (auto-apply, batched into one daily summary). Rejected after a full-repo audit found zero existing notification/summary/digest surface anywhere in the app — building one properly is separate, unscoped design work, not a third radio button. What ships instead for an Automatic connection is a lightweight "N changes went live automatically today" link opening a small list, reusing the existing `.mini-list` component.
- **Automatic FX conversion** for a currency mismatch. Rejected: no conversion is attempted anywhere in this path today (verified by grep — `applyPricingRule` is currency-blind), and guessing a rate for a fiscal-adjacent figure is a materially different feature (see ADR-040) that this epic does not attempt. A mismatch blocks with a stated reason instead.
- **Reusing the existing `frozen` field** for pinned/custom prices. Rejected: that field is destination-REPORTED (a marketplace telling OL a seller froze something on the marketplace's own dashboard) — structurally the wrong direction for "an OL operator overrode a price OL is about to publish."
- **A hard block on prices below cost.** Rejected outright as infeasible in v1: no cost/COGS field exists anywhere in `Product`/`ProductVariant` (verified by grep). A magnitude-only "steep change" signal ships instead, with copy that never implies a profitability check occurred.
- **Silent background bulk apply** (no visible progress). Rejected: a large batch against several connections, each with its own rate limit, can take minutes; the operator sees a live per-connection progress widget instead of an opaque wait, reusing the batch-progress mechanism the bulk offer-creation wizard already has rather than inventing a second one.

## Consequences

**Pros:**
- No new bounded context — `listings` already owns offer/price-adjacent concerns, so this is an extension, not a new module with its own DI ceremony.
- Reuses three real, load-bearing precedents (episode pattern, `SalesDocumentBlockOutcome`, `BulkOfferCreationBatch` progress) instead of inventing three new mechanisms.
- The cost-tracking and digest gaps are stated explicitly rather than silently absent, so a future reader doesn't rediscover them by surprise.

**Cons / trade-offs:**
- `Connection.config.pricingRule`'s shape change (flat rule → `{ default, sourceOverrides }`) requires every existing reader to be updated with a backward-compatible fallback for connections that predate this change (resolve at read time; no backfill migration).
- The "steep change" signal is a real, acknowledged compromise — it will both miss genuinely unprofitable small changes and flag harmless large ones. This is accepted as strictly better than building a cost-tracking feature as an undiscussed side effect of a pricing-sync feature.
- The currency restriction means a cross-currency connection gets zero automation from this feature until a separate FX effort lands.

**Migration path (if applicable):**
- None required for existing installs at ship time: every connection defaults to `Manual review` with the CURRENT flat rule read as the new `default` (no `sourceOverrides`), so behavior is unchanged until an operator explicitly opts a connection into review/automation.

## References

- Related issues: #3010 (originating gap), #3139 (epic), #3140 (this ADR's own tracking issue), #3141 (companion mockup), #3142–#3153 (implementation sub-issues)
- Related ADRs: [ADR-007](./007-syncjob-status-vs-outcome-split.md) (status/outcome split, decision 8), [ADR-040](./040-order-time-fx-stamping-against-a-system-reporting-currency.md) (why FX conversion is out of scope here), [ADR-050](./050-workload-isolation-concurrency-lanes.md) (lane/retry machinery referenced by decision 8)
- Primary doc section: [docs/architecture-overview.md § Listings](../../architecture-overview.md) (this feature will be documented there once implemented)
- Mockup: `docs/plans/mockups/price-changes-review-queue.html` (companion artifact, #3141)
