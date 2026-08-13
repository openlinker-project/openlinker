# ADR-040: Order-time FX stamping against a connection-derived base currency

- **Status**: Proposed
- **Date**: 2026-08-13
- **Authors**: @norbert-kulus-blockydevs

## Context

An operator selling mostly in PLN may take an order denominated in another currency — a
PrestaShop shop with a secondary EUR currency, or a whole channel that trades in EUR.
[ADR-039](./039-order-analytics-read-model-persistence-strategy.md) denormalizes the order's
*native* `currency` + `totalAmount` onto `order_records`, which makes per-currency aggregates
queryable but leaves every cross-currency total unanswerable: summing 120 000 PLN and 8 400 EUR
produces a number that means nothing.

Converting at read time is not an option for a financial figure. The rate that applied on the day
the buyer paid is the only defensible one, and it must stay fixed no matter when the report runs or
how many times the order is re-ingested. So the conversion has to be *stamped* at ingestion and
never recomputed.

That raises the question this ADR answers: **converted into what?** OL has no notion of a settlement
currency. Introducing a global one was explicitly rejected by the operator — a deployment may run a
single-currency estate today and a mixed one tomorrow, and a global setting is one more thing to
configure wrongly before the first order arrives.

## Decision

1. **The base currency is the default currency of the order's SOURCE connection**, resolved by a
   three-step ladder: explicit `Connection.config.currency` (already operator-authored and
   persisted, #362) → the dominant `baseCurrency` across that connection's existing
   `order_records` → no history, in which case the order's own currency becomes the base and no
   conversion happens. There is no global setting and no new settings table.
2. **Convert only when the order's currency differs from that base.** The equal case — the
   overwhelming majority of orders — writes `baseTotalAmount = totals.total` with no rate lookup
   and no I/O.
3. **Rates live in a shared `exchange_rates` registry keyed `(source, from, to, rateDate)`**, not
   per order. Five hundred EUR orders on one day resolve to one row; each order references it by
   id. The registry is immutable and append-only.
4. **The stamp is written by a narrow conditional UPDATE that fires only when the order carries no
   stamp yet**, never through the `persistOrder` upsert path. Re-ingestion therefore cannot move a
   figure that has already been reported.
5. **A new leaf core context `libs/core/src/currency/`** owns the registry, the rate providers
   (plain `@Injectable` classes, not plugin adapters), and the rule → rate-date derivation. It
   depends on no sibling context; the caller passes the rule and source down.

## Alternatives considered

- **A global settlement-currency setting** (singleton row, mirroring `ai_provider_active_setting`).
  Rejected by the operator: it forces a deployment-wide answer to a question a single-currency
  estate never has to ask, and it is a configuration step that silently breaks analytics when
  skipped. The connection-derived ladder degrades to the same behaviour with no configuration at
  all.
- **The DESTINATION connection's currency as the base** (the shop where OL creates the order).
  Rejected: analytics reports what the buyer paid on a sales channel, not what the fulfilling shop
  booked. A marketplace order routed to two shops would also have two bases.
- **Converting at read time in the analytics query.** Rejected: it produces a different number every
  time the rate moves, which is precisely the "quietly wrong number" failure ADR-039 set out to
  eliminate.
- **One rate row per order.** Rejected: it multiplies identical rows by order volume and makes
  "which rate did we use on 3 August" a `DISTINCT` scan instead of a primary-key read.

## Consequences

**Pros:**
- Zero configuration for the common case; the ladder self-heals from order history.
- The equal-currency path costs nothing — no query, no HTTP call, no rate row.
- A stamped order is reproducible: `exchangeRateId` joins to the exact rate, its date, its source,
  and the source's own document reference (e.g. an NBP table number).
- The rule is persisted per stamp, so adding a second rule later cannot make history ambiguous.

**Cons / trade-offs:**
- Analytics must `GROUP BY base_currency` rather than sum one column outright. With connections
  whose defaults differ, there is still no single grand total — by construction, since no
  deployment-wide currency exists to express one in. An operator who wants one sets
  `config.currency` explicitly on the foreign-currency channel, which is why that field is being
  surfaced on the remaining setup forms.
- The ladder's step 2 can shift as history accumulates (a connection's dominant currency changes).
  Already-written stamps are unaffected — they are never recomputed — but a long-lived connection
  can end up with two base-currency eras in its history. Setting `config.currency` pins it.
- The rate registry is a new persistence surface with an external dependency behind it. A provider
  outage degrades to an unstamped order plus a backfill job, never a failed ingestion.

**Migration path (if applicable):**
- Existing orders carry no stamp (`baseCurrency IS NULL`). No backfill ships with this change: the
  historical rate for an arbitrary past date is available from the provider, so a backfill remains
  possible later, but it is a separate decision about restating already-reported figures.

## References

- Related issues: #2049 (this work), #1976 (analytics epic), #1985 (order analytics read model),
  #362 (per-connection `config.currency`)
- Related ADRs: [ADR-039](./039-order-analytics-read-model-persistence-strategy.md) (denormalized
  order scalars — this ADR adds the FX pair alongside them),
  [ADR-011](./011-domain-entity-behavior.md) (pure read-only derivations on entities)
- Plan: [implementation-plan-2049-order-fx-rate-snapshot.md](../../plans/implementation-plan-2049-order-fx-rate-snapshot.md)
