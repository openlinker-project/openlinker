# ADR-064: Analytics display-currency conversion is a read-only, aggregate-level transform

- **Status**: Proposed
- **Date**: 2026-08-25
- **Authors**: @norbert-kulus-blockydevs

## Context

`/analytics` renders every figure in each order's stamped `reportingCurrency` ([ADR-040](./040-order-time-fx-stamping-against-a-system-reporting-currency.md)). An operator running multi-currency sales — several wallets, or a shop also totaling crypto-token payments — wants to view the dashboard in a different currency than the one stamped at ingestion, without touching the stamp.

This proposal sits directly on top of a boundary ADR-040 draws deliberately: *"przeliczanie w momencie odczytu nie może dać wiarygodnej liczby finansowej"* — read-time conversion cannot produce a defensible financial figure, which is why ADR-040 stamps a rate once, at order time, instead of converting on every read. A display-currency picker looks like exactly the pattern ADR-040 forbids. **It is not**: the picker changes only what one viewer sees on one screen — `order_records.reportingCurrency` / `reportingTotalAmount` never change. ADR-040 governs what OpenLinker *records*; this ADR governs an optional, reversible *view* over what's already recorded. They answer different questions.

A related concern — orders whose `reportingCurrency` is stale relative to the current `reporting_currency_setting`, or was never stamped — is a data-coverage gap, not a display preference, and is out of scope here; see the sibling coverage-remediation decision (Phase 1 Task 1.2) and #2096 (stamp restatement, still unbuilt).

## Decision

Add an operator-facing display-currency preference to `/analytics` with two modes, **neither of which requires a background job, a queue, or a progress indicator**:

1. **Current rate** (default). Reads each order's own native `currency` / `totalAmount` directly, ignoring the ADR-040 stamp, groups by **distinct native currency** (not by order or date), resolves one live rate per currency via `ICurrencyRateService`, and sums. Cheap at any order volume, since the number of distinct native currencies is always small.
2. **Order-date / stable mode**. Reads the already-computed aggregate in the stamped reporting currency (today's normal `/analytics` result); a no-op if the display currency matches it. Otherwise applies **one** current rate to the already-summed total — a single multiply, not a per-order lookup. It answers "what's my current total worth in currency X," not "what would each order have converted to on its own date" — no per-order historical accuracy is attempted.

Both modes are exposed together in a visible Analytics Settings control (button, not a buried tooltip), URL-encoded like the existing date-range filter (`?displayCurrency=&rateBasis=`).

Because the preference lives in the URL it is shareable, so it can arrive naming a currency this deployment cannot serve - a link shared between two installs, or a currency that stopped being resolvable since the link was made. That is a distinct case from the runtime "unavailable" state below (which is about one native currency inside an otherwise valid view), and it is handled at the boundary rather than downstream: a `displayCurrency` that is not a valid ISO-4217 code, or that no registered rate provider quotes, is **rejected and ignored** - the dashboard renders in the stamped reporting currency exactly as if the parameter had been omitted, and the picker states that the requested currency is unavailable here rather than silently falling back with no explanation. A shared link never renders a total the recipient's deployment cannot stand behind.

## Alternatives considered

- **Per-order conversion inside the request** (fetch each order's historical rate on read). Rejected: reintroduces the per-order I/O this ADR avoids, needs a job/progress UI at scale, and doesn't improve on "order-date" mode's answer.
- **Restating the ADR-040 stamp on a currency-setting change.** Rejected — a data-repair operation on the record of truth, tracked as #2096 and the Phase 5 remediation job; conflating "what do I see" with "what is recorded" is the root confusion this ADR resolves.
- **One conversion mode only.** Rejected via `/grill-me`: "current rate" alone can't answer "my stable total in EUR today" without re-summing every view; "order-date" alone loses the wallet-portfolio framing. Both are cheap enough that shipping only one saves nothing.

## Consequences

**Pros:**
- No new job type, queue, or worker handler — both modes execute inside the existing `GET /analytics/sales` request/response cycle.
- Clear, auditable non-conflict with ADR-040: the stamped record is never read for mutation, only for display math.
- Reuses the existing `ICurrencyRateService` read path with no new outbound integration.

**Cons / trade-offs:**
- "Order-date" mode isn't historically accurate per order — it applies today's rate to a total mixing orders from many dates. Accepted, not a defect: the mode answers "what's it worth today," not an accounting-grade historical question.
- A native currency with no resolvable rate degrades to an explicit "unavailable" state (falling back to the reporting currency), never a silent omission or guess — this must be visible in the UI, not just logged.

**Migration path (if applicable):**
- Additive only. No existing `/analytics` response shape changes when `displayCurrency` is omitted.

## Related gaps, deliberately out of scope

Designing this surfaced further `/analytics` silent-exclusion states unrelated to currency display, not addressed by this ADR. See [docs/plans/analytics-dashboard-known-gaps.md](../../plans/analytics-dashboard-known-gaps.md) for the list and why each is deferred rather than folded into a speculative general framework.

## References

- Related issues: #2452 (parent epic), #2454 (this ADR's task), #2096 (deferred stamp restatement)
- Related ADRs: [ADR-040](./040-order-time-fx-stamping-against-a-system-reporting-currency.md) (order-time FX stamping — the boundary this ADR sits beside, not inside), [ADR-063](./063-per-line-tax-rate-resolution-and-provenance.md) (sibling decision for the tax-rate side of the same epic)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § 18. Currency
