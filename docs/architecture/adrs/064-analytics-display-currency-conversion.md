# ADR-064: Analytics display-currency conversion is a read-only, aggregate-level transform

- **Status**: Proposed
- **Date**: 2026-08-25
- **Authors**: @norbert-kulus-blockydevs

## Context

`/analytics` renders every figure in each order's stamped `reportingCurrency` ([ADR-040](./040-order-time-fx-stamping-against-a-system-reporting-currency.md)). An operator running multi-currency sales — several currency wallets, or a shop that also totals crypto-token payments — wants to view the dashboard in a currency other than the one stamped at ingestion, without touching the stamp.

This proposal sits directly on top of a boundary ADR-040 draws deliberately: *"przeliczanie w momencie odczytu nie może dać wiarygodnej liczby finansowej"* — read-time conversion cannot produce a defensible financial figure, which is why ADR-040 stamps a rate once, at order time, rather than converting on every read. A display-currency picker looks, on first glance, exactly like the pattern ADR-040 forbids, and a reviewer pattern-matching against that ADR should stop here and ask why this is allowed. **The answer this ADR records**: the picker changes only what one viewer sees on one screen. Nothing is written back — `order_records.reportingCurrency` / `reportingTotalAmount` (the actual financial record) never change. ADR-040 governs what OpenLinker *records* as an order's financial figure; this ADR governs an optional, reversible *view* over already-recorded figures. The two do not conflict because they answer different questions.

A related, separate concern — orders whose `reportingCurrency` has gone stale relative to the current `reporting_currency_setting`, or was never stamped — is a data-coverage gap, not a display preference. That is out of scope here; see the sibling coverage-remediation decision (Phase 1 Task 1.2) and [#2096](https://github.com/openlinker-project/openlinker/issues/2096) for restating historical stamps, which remains explicitly unbuilt.

## Decision

Add an operator-facing display-currency preference to `/analytics` with two modes, **neither of which requires a background job, a queue, or a progress indicator**:

1. **Current rate** (default). Reads each order's own native `currency` / `totalAmount` directly — ignoring the ADR-040 stamp entirely — groups the result by **distinct native currency** (not by order, not by date), resolves one live rate per distinct currency via the existing `ICurrencyRateService`, and sums. This is cheap regardless of order volume because the number of distinct native currencies in any real dataset is small.
2. **Order-date / stable mode**. Reads the already-computed aggregate in the system's stamped reporting currency (today's normal `/analytics` result). If the requested display currency equals the reporting currency, this is a no-op. Otherwise it applies **one** current rate to the whole already-summed total — a single multiply, not a per-order historical-rate lookup. This mode answers "what does my current total look like in currency X," not "what would each order have converted to on its own date" — it does not attempt per-order historical accuracy.

Both modes are exposed together in a visible Analytics Settings control (button, not a buried tooltip), URL-encoded like the existing date-range filter (`?displayCurrency=&rateBasis=`). Default mode is "current rate."

## Alternatives considered

- **Per-order asynchronous conversion inside the request** (fetch each order's own historical rate on read). Rejected in an earlier `/tech-review` pass: it reintroduces exactly the per-order I/O this ADR avoids, needs a job/progress UI to stay responsive at scale, and does not actually improve on "order-date" mode's answer to the question an operator is really asking.
- **Restating the ADR-040 stamp itself on a currency-setting change.** Rejected — that is a data-repair operation on the record of truth, tracked separately as [#2096](https://github.com/openlinker-project/openlinker/issues/2096) and as the currency-mismatch remediation job in Phase 5 of the parent epic. Conflating "what do I see" with "what is recorded" was the root confusion this ADR exists to resolve.
- **One conversion mode only.** Rejected via `/grill-me`: "current rate" alone can't answer "what's my stable total in EUR today" without re-summing on every view, and "order-date" alone loses the portfolio/wallet framing that motivated the feature. Both are cheap enough that shipping only one saves nothing.

## Consequences

**Pros:**
- No new job type, queue, or worker handler — both modes execute inside the existing `GET /analytics/sales` request/response cycle.
- Clear, auditable non-conflict with ADR-040: the stamped record is never read for mutation, only for display math.
- Reuses the existing `ICurrencyRateService` read path with no new outbound integration.

**Cons / trade-offs:**
- "Order-date" mode is not historically accurate per order — it applies today's rate to a total that mixes orders from many dates. This is a stated, accepted limitation, not a defect: the mode is answering a "what's it worth today" question, not an accounting-grade historical one.
- A native currency with no resolvable rate degrades to an explicit "unavailable" state (falling back to the reporting currency) rather than silently omitting or guessing — this must be visible in the UI, not just logged.

**Migration path (if applicable):**
- Additive only. No existing `/analytics` response shape changes when `displayCurrency` is omitted.

## Related gaps, deliberately out of scope

An audit while designing this surfaced six further silent-exclusion states on `/analytics` unrelated to currency display: order-record health statuses (`awaiting_mapping`/`source_deleted`) invisible on the dashboard, WooCommerce orders with a null `placedAt` permanently excluded from Top Products' date filtering, and a tooltip that conflates two unrelated exclusion counts into one ambiguous number. Per `CLAUDE.md`'s guidance against designing for hypothetical future requirements, this epic does not build a generic "any future silent exclusion" framework — the sibling Data Coverage panel (Phase 4 onward of the parent epic) covers exactly the two known, concrete cases in scope. A third case gets its own treatment later, using the same pattern, not a speculative engine now.

## References

- Related issues: #2452 (parent epic), #2454 (this ADR's task), #2096 (deferred stamp restatement)
- Related ADRs: [ADR-040](./040-order-time-fx-stamping-against-a-system-reporting-currency.md) (order-time FX stamping — the boundary this ADR sits beside, not inside), [ADR-063](./063-per-line-tax-rate-resolution-and-provenance.md) (sibling decision for the tax-rate side of the same epic)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § 18. Currency
