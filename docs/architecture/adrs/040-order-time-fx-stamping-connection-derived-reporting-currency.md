# ADR-040: Order-time FX stamping against a connection-derived reporting currency

- **Status**: Proposed
- **Date**: 2026-08-13
- **Authors**: @norbert-kulus-blockydevs

## Context

An operator selling mostly in PLN may take an order denominated in another currency — a PrestaShop
shop with a secondary EUR currency, or a whole channel that trades in EUR. The order analytics read
model (#1985) denormalizes the order's *native* `currency` + `totalAmount` onto `order_records`,
which makes per-currency aggregates queryable but leaves every cross-currency total unanswerable:
summing 120 000 PLN and 8 400 EUR produces a number that means nothing.

Converting at read time is not an option for a financial figure. The rate that applied when the
order was placed is the only defensible one, and it must stay fixed no matter when the report runs
or how many times the order is re-ingested. So the conversion has to be *stamped* at ingestion and
never recomputed.

That raises the question this ADR answers: **converted into what?** OL has no notion of a reporting
currency. Introducing a global one was explicitly rejected by the operator — a deployment may run a
single-currency estate today and a mixed one tomorrow, and a global setting is one more thing to
configure wrongly before the first order arrives.

*Terminology note:* an earlier draft of this ADR called the target a **base** currency. That was
renamed after review, because in FX the *base* currency of a pair is the one being priced — precisely
what the rate registry stores as `fromCurrency`, i.e. the order's **own** currency. `baseTotalAmount`
therefore read, to anyone with an accounting background, as the native total: the exact opposite of
its meaning. The analytics product spec already used *reporting currency*, so that is the term used
throughout.

## Decision

1. **The reporting currency is derived per SOURCE connection**, by a four-rung ladder: explicit
   `Connection.config.fx.reportingCurrency` → the pre-existing `Connection.config.currency` (#362)
   → the dominant **native** currency across that connection's existing `order_records` → no
   history, in which case the order's own currency is used and no conversion happens. There is no
   global setting and no new settings table.

   Rung 2 is a deliberate reuse of a field whose existing meaning is *"the currency this shop prices
   products in"* (read today at `PrestashopAdapterFactory`). For every shipped platform those two
   currencies coincide, so reusing it preserves the zero-configuration property; rung 1 exists so an
   operator whose catalogue currency and reporting currency genuinely differ can separate them
   without the two meanings fighting.

   Rung 3 aggregates the **native** currency (from `orderSnapshot`), never the stamped reporting
   currency. Aggregating the stamp would feed the ladder its own output: one atypical first order
   would set the reporting currency and then reinforce itself forever. The aggregate carries a
   deterministic tie-break so a tied connection cannot resolve differently between two ingestions.

2. **Convert only when the order's currency differs from the reporting currency.** The equal case —
   the overwhelming majority of orders — writes `reportingTotalAmount = totals.total` with no rate
   lookup and no I/O.

3. **Rates live in a shared `exchange_rates` registry keyed `(source, from, to, rateDate)`**, not per
   order. Five hundred EUR orders on one day resolve to one row; each order references it by id. The
   registry is append-only **by convention** — no service exposes an update, and nothing enforces it
   at the database level.

   **Direction is a stated invariant, not an implementation detail**: `rate` is the number of `to`
   units per one `from` unit, `from` is always the order's own currency, and `to` is always the
   reporting currency. A stamp is therefore always `total × rate`, never a division. A rate that had
   to be **inverted** (the source quotes the pair the other way) or **pivoted** (derived from two
   quotes through a third currency) records how it was obtained, and the pivot legs' own document
   references, so a derived figure stays auditable — without that, a row whose `rate` appears in no
   published table is unverifiable exactly where verification is hardest.

4. **The stamp is written by a narrow conditional UPDATE that fires only when the order carries no
   stamp yet**, never through the `persistOrder` upsert path. Re-ingestion therefore cannot move a
   figure that has already been reported.

5. **A new leaf core context `libs/core/src/currency/`** owns the registry, the rate providers, and
   the rule → rate-date derivation. It depends on no sibling context; the caller passes the rule and
   source down. Providers are plain `@Injectable` classes rather than plugin adapters, because a
   published reference rate is a shared read, not a per-connection integration capability. This makes
   the NBP provider the **first outbound HTTP call in `libs/core`** — acceptable for a single
   unauthenticated public GET, and bounded by a rule: **a rate provider that needs a credential or an
   SDK ships as `libs/integrations/fx-*` implementing `ExchangeRateProviderPort`**, so keys and vendor
   SDKs never enter core. That mirrors the existing split between `AiCompletionPort` in core and the
   vendor adapters in `@openlinker/integrations-ai`.

## Alternatives considered

- **A global reporting-currency setting** (singleton row, mirroring `ai_provider_active_setting`).
  Rejected by the operator: it forces a deployment-wide answer to a question a single-currency estate
  never has to ask, and it is a configuration step that silently breaks analytics when skipped. The
  connection-derived ladder degrades to the same behaviour with no configuration at all.
- **The DESTINATION connection's currency** (the shop where OL creates the order). Rejected:
  analytics reports what the buyer paid on a sales channel, not what the fulfilling shop booked. A
  marketplace order routed to two shops would also have two reporting currencies.
- **Converting at read time in the analytics query.** Rejected: it produces a different number every
  time the rate moves, which is precisely the "quietly wrong number" failure the analytics epic
  (#1976) set out to eliminate.
- **One rate row per order.** Rejected: it multiplies identical rows by order volume and makes "which
  rate did we use on 3 August" a `DISTINCT` scan instead of a unique-index read.

## Consequences

**Pros:**
- Zero configuration for the common case; the ladder self-heals from order history.
- The equal-currency path costs nothing — no query, no HTTP call, no rate row.
- A stamped order is reproducible: `exchangeRateId` joins to the exact rate, its date, its source,
  its document reference, and — for an inverted or pivoted rate — the legs it was derived from.
- The rule is persisted per stamp, so adding a second rule later cannot make history ambiguous. This
  holds for any rule that maps one instant to one published calendar day (`same-day`, `order-date`);
  a period-based rule (`month-average`) does not fit the `(source, pair, date)` key and would need a
  `rateKind` column.

**Cons / trade-offs:**
- **Analytics must `GROUP BY` the reporting currency; this ADR does not produce a single grand
  total.** Where connections resolve to different reporting currencies there is still no
  deployment-wide figure — by construction, since no deployment-wide currency exists to express one
  in. What it does deliver is that each per-currency figure is now a *stamped, immutable, auditable*
  number rather than a read-time computation, and that an estate whose connections share one
  reporting currency does sum correctly. An operator who wants one figure sets rung 1 or rung 2 on
  the foreign-currency channel, which is why that field is being surfaced on the remaining setup
  forms. **The two consuming issues (#1987 / #1988) currently specify the opposite** ("multiple
  currencies never sum into a single figure"); reconciling their acceptance criteria with this
  stamping model is a precondition for those issues, not for this one.
- The ladder's rung 3 can shift as history accumulates (a connection's dominant native currency
  changes). Already-written stamps are unaffected — they are never recomputed — but a long-lived
  connection can end up with two reporting-currency eras in its history. Setting rung 1 or 2 pins it.
- **A stamped figure is an analytics figure, not a fiscal one.** NBP table A is the Polish statutory
  average rate, but PL VAT anchors the rate on the last business day preceding the date the *tax
  obligation* arose, whereas this stamp anchors on order placement; and NBP publishes no statutory
  PLN→X or X→Y rate at all, so an inverted or pivoted rate carries no reference authority for anyone.
  Invoicing derives its own `saleDate` from the same `order.placedAt` and FA(3) carries its own
  `KursWaluty` field that OL deliberately does not emit — whoever implements it must consume this
  stamp rather than compute a second, divergent rate for the same order.
- **NBP-only coverage is narrower than "any currency pair".** Table A carries the major currencies
  against PLN; the exotic set is table B (weekly, different endpoint) and table C is bid/ask. A
  currency absent from table A is permanently unreachable, and a non-PL deployment reporting in, say,
  EUR against CHF gets a synthetic cross derived through a PLN pivot on the Polish business-day
  calendar. That is why the provider port reports which pairs it supports, and why an unsupported
  pair must fail as a terminal business failure rather than retry forever.
- The rate registry is a new persistence surface with an external dependency behind it. A provider
  outage degrades to an unstamped order plus a retry job, never a failed ingestion — and because a
  dead retry job would otherwise hold its idempotency key forever, a periodic reconcile reads the
  unstamped rows directly rather than trusting the job to survive.
- **The stamp is only as good as the order's placement timestamp, and one shipped source does not
  supply one.** The WooCommerce order source emits no order-placed timestamp at all, so a
  foreign-currency WooCommerce order cannot resolve a rate date and is recorded as unstamped —
  deliberately as a *terminal* condition, so it neither throws inside ingestion nor retries forever.
  Populating that field is a one-line adapter change but it also moves invoicing's `saleDate` for
  every WooCommerce order, so it is tracked separately rather than folded in here. Sources that do
  supply it (PrestaShop, Allegro, Erli) are unaffected. Note also that no source supplies a
  *payment* timestamp — Allegro reads one and discards it — which is why this ADR anchors on
  placement and says so rather than claiming the rate of the day the buyer paid.

**Migration path (if applicable):**
- Existing orders carry no stamp (`reportingCurrency IS NULL`). **No restatement of historical orders
  ships with this change** — the inline retry job covers orders that could not be stamped at
  ingestion, which is a different thing. The historical rate for an arbitrary past date is available
  from the provider, so a backfill remains possible later, but it is a separate decision about
  restating already-reported figures.

## References

- Related issues: #2049 (this work), #1976 (analytics epic), #1985 (order analytics read model),
  #1987 / #1988 (the consuming queries), #362 (per-connection `config.currency`)
- Related PRs: #2050 (this ADR + the implementation plan)
- Related ADRs: [ADR-007](./007-syncjob-status-vs-outcome-split.md) (status-vs-outcome split, applied
  to the retry job), [ADR-011](./011-domain-entity-behavior.md) (pure read-only derivations on
  entities), [ADR-026](./026-country-agnostic-invoicing-domain.md) (the country-agnostic posture this
  ADR follows for the provider boundary). The order analytics read-model ADR proposed under #1985 is
  the read model this stamp extends; it is referenced by issue number rather than by link because it
  is not yet merged, and this ADR is intentionally mergeable without it.
- Primary doc section: `docs/architecture-overview.md` § Currency (added by #2049)
- Plan: [implementation-plan-2049-order-fx-rate-snapshot.md](../../plans/implementation-plan-2049-order-fx-rate-snapshot.md)
