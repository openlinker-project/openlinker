# ADR-039: Order analytics read model — denormalized columns + line-item table, no materialized view

- **Status**: Proposed
- **Date**: 2026-08-07
- **Authors**: @jakubret

## Context

`/analytics` (#1976) needs order data to be queryable without JSON expansion. Today all
analytically-relevant order data lives only inside `order_records.orderSnapshot` (JSONB): totals,
currency, tax treatment, per-line prices/quantities, and the buyer's true order time (`placedAt`).
There is no `order_items` table and no money columns. "Top products by revenue" means
`jsonb_array_elements` per query; a date-range filter on order time means a JSONB path expression
under `->>`.

#1985 must decide, and document, the persistence strategy for making this queryable: live query
over denormalized/typed data, generated columns, or a materialized projection — per its own
acceptance criteria ("the chosen strategy... is recorded with its rationale"). [ADR-036](./036-cross-context-read-model-joins.md)
already rejected a materialized view for a *different* problem (products-list sort/filter/pagination)
at current data volume; this ADR makes the equivalent call for the analytics substrate, where the
access pattern is materially different (aggregate SUM/COUNT/GROUP BY over a bounded date range, not
per-request pagination).

This persona's volume (10–100 orders/day) means the total corpus is small for years; there is no
current evidence a live query won't perform acceptably.

## Decision

1. **Denormalize four scalar order-level facts onto `order_records`** — `placedAt` (timestamptz,
   nullable), `currency` (varchar(3), nullable), `taxTreatment` (varchar, nullable — `null` means
   "not asserted by the source", never defaulted), `totalAmount` (numeric, nullable, from
   `totals.total`). This follows the existing precedent of `dispatchByAt` / `fulfillmentState`
   (#927/#1108) — denormalize at write time (`persistOrder`) rather than read every aggregate
   through a JSONB path expression.
2. **Add a new child table `order_line_items`**, one row per order line, written transactionally
   alongside `order_records` at `persistOrder` time (delete-then-reinsert per order, idempotent
   under re-ingestion). Carries `orderRecordId`, `lineNumber`, `productId`, `variantId`, `quantity`,
   `unitPrice`, denormalized `sourceConnectionId` + `placedAt` (so a channel/time-bucketed
   per-product query never has to join back to `order_records`).
3. **No materialized view, no refresh job.** Aggregates read the live tables directly. Revisit only
   if a real deployment's query latency becomes a measured problem — matching the migration-path
   discipline in ADR-036.

## Alternatives considered

- **Materialized view aggregating revenue/units per day/channel/product.** Rejected: adds a
  refresh-staleness story (conflicts directly with the data-trust "freshness" pillar, L1–L3 of the
  spec) and a migration/ops surface disproportionate to 10–100 orders/day. A stale materialized view
  is exactly the "quietly wrong number" risk (spec § 1a) this epic is trying to eliminate.
- **PostgreSQL generated columns on `order_records` for the scalars (instead of a write-time
  denormalize in `persistOrder`).** Rejected: a generated column re-derives from `orderSnapshot` on
  every write regardless of whether the source data actually changed, and cannot express the
  line-item fan-out at all (`items[]` needs a real table, not a scalar generated column). Using it
  only for the four scalars while still needing an application-level write for the line-item table
  would split one concern across two mechanisms for no real benefit.
- **Live JSONB expansion at query time (`jsonb_array_elements`), no new columns or table.**
  Rejected: this is the status quo the epic explicitly identifies as the problem — no index can
  cover an expression that must first explode a JSON array, and every consuming query (#1987, #1988)
  would re-implement the same fragile parsing `readItems`-style logic independently.

## Consequences

**Pros:**
- Every downstream aggregate (#1987 sales/channel, #1988 top-products) reads typed columns with
  ordinary btree indexes — no JSONB parsing duplicated across issues.
- No refresh/staleness window; the trust header (L1–L3) can assert data is current as of the last
  successful ingestion, full stop.
- Matches an already-accepted pattern in this exact table (`dispatchByAt`, `fulfillmentState`).

**Cons / trade-offs:**
- `order_line_items` is a second table that must be kept in sync with `order_records` at write
  time — a bug in `persistOrder`'s transaction could desync them. Mitigated by writing both inside
  one transaction and by the backfill migration being idempotent/re-runnable.
- The four denormalized scalars duplicate data already present in `orderSnapshot`; a future
  snapshot-shape change must remember to update both the JSONB writer and the column writer. Same
  trade-off already accepted for `dispatchByAt`/`fulfillmentState`.
- Cancellation exclusion depends on #1984 landing first with its own column; this ADR's tables are
  designed to be additive and independent of that column so the two efforts don't block each
  other's schema work, but the exclusion predicate itself cannot be wired until #1984 merges.

**Migration path (if applicable):**
- If a real deployment's order volume grows enough that live aggregate queries measurably degrade,
  revisit a materialized/incrementally-refreshed projection then, with real numbers — not
  speculatively now.

## References

- Related issues: #1985, #1976, #1984, #1987, #1988
- Related ADRs: [ADR-036](./036-cross-context-read-model-joins.md) (rejected materialized view for a
  different read-model problem at current scale — same reasoning applied here)
- Spec: `docs/specs/product-spec-1976-analytics.md` § 1a, § 4 (dependencies [L][T][X][G])
