# ADR-080: Operator cost price, snapshotted at ingestion

- **Status**: Accepted
- **Date**: 2026-10-29
- **Authors**: @norbert-kulus-blockydevs

## Context

OpenLinker holds no cost basis anywhere. No master reports one (PrestaShop's wholesale price and WooCommerce's cost-of-goods plugins are not read, and neither is reliable), so revenue was the only money figure and the pilot could not answer "what do I earn on this". Margin has two hard requirements. A later edit of a cost must not move the margin of an order already sold, and a figure computed from partial data must say how much of the revenue it covers rather than present a partial number as the total (#3516, D27).

## Decision

1. **The cost is operator-authored and lives on `ProductVariant`**: a net (VAT-exclusive) unit cost with its currency, plus `costUpdatedAt` and `costUpdatedByUserId`. `NULL` means "not recorded" and `0.00` is a valid cost. Master sync never writes it: the columns are omitted from the repository's `toOrmEntity`, so a sync upsert cannot null them.
2. **It is snapshotted onto `order_line_items` at the first `ready` ingestion** (`unitCostNet`, `unitCostCurrency`, `costState` = `recorded | not-recorded`). Re-ingestion is delete-then-reinsert, so the snapshot is carried forward inside the write transaction by `productId|variantId` (lowest prior line number wins, reused exactly as stored, never upgraded) through the pure `carryForwardLineCosts`.
3. **G11-G**: a candidate cost is offered to a line only when the variant's `costUpdatedAt` is not later than the order's `placedAt`; an old order imported after a cost was entered stores `not-recorded`, not today's cost.
4. **Margin is computed on net revenue only** (the existing Net Sales SQL, no returns subtraction, G11-E). A line is "covered" when its cost is `recorded` and its cost currency equals the order's native currency (G11-C); cost is converted into the reporting currency with the same per-order ratio net revenue uses. Everything else is a gap with a reason derived at READ time: `no-variant`, `currency-mismatch`, `cost-entered-after-sale`, `no-cost`. The invariant is covered revenue + sum of gap revenue = net revenue.
5. **Reads belong to `orders`.** `products` owns the cost columns and writers; every margin, coverage and work-list read lives in `orders` and joins `product_variants` by table name under [ADR-036](./036-cross-context-read-model-joins.md). `products` never imports `orders`.

## Alternatives considered

- **Read-time cost lookup** (join the variant's current cost when reporting). Rejected: an edit would rewrite history, which D27 forbids.
- **A cost history table** (effective-dated rows per variant). Rejected for the pilot: more schema and a lookup per line for a need the snapshot already meets; the cost is only ever "what it was when the order arrived".
- **Cost inside the `Order.items` snapshot JSON / persistOrder allowlist.** Rejected: that JSON is the source's statement of the order and is read by `@AnyRole()` surfaces (packers); cost is commercially sensitive and must stay off them.
- **FX conversion of a cost in another currency.** Rejected: it would put an FX rate into a figure the operator typed in one currency; a mismatch is surfaced as `currency-mismatch` instead.

## Consequences

**Pros:**
- Margin of a sold order never changes when the cost changes.
- Partial coverage is explicit: the report carries covered revenue, each gap reason with its count and amount, and a `no-cost` coverage category.
- No migration backfill: existing lines read `not-recorded`, which is true.

**Cons / trade-offs:**
- **No cost history.** The variant holds only its current cost; the snapshot is the only record of earlier ones.
- **`ready -> awaiting_mapping -> ready` loses the snapshot.** Line rows exist only for `ready` records (ADR-039), so the rows, and the cost with them, are dropped on the way out and re-derived on the way back from the then-current cost.
- **Product-only lines are always a gap** (`no-variant`): cost is per variant.
- A cost is only snapshotted if the ingestion-time lookup succeeds; that read is deliberately not caught, because a swallowed failure would freeze `not-recorded` for good.

## References

- Related issues: #3516, #3586, #3587, #3588, #3589, #3590, #3591
- Related ADRs: [ADR-036](./036-cross-context-read-model-joins.md), [ADR-039](./039-order-analytics-read-model-persistence-strategy.md), [ADR-040](./040-order-time-fx-stamping-against-a-system-reporting-currency.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)
