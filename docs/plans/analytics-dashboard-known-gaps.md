# Analytics dashboard: known gaps deliberately out of scope for the display-currency epic

Related: [ADR-064](../architecture/adrs/064-analytics-display-currency-conversion.md) (display-currency conversion), #2452 (parent epic), and the sibling coverage-remediation decision (Phase 1 Task 1.2 of #2452).

Designing ADR-064 surfaced six silent-exclusion states on `/analytics` unrelated to currency display - cases where a figure is under-counted and the dashboard says nothing. This is the ledger of all six and where each one stands, so a later reader can check them off rather than re-derive them from prose.

| # | Gap | Status |
|---|---|---|
| 1 | Order-record health statuses (`awaiting_mapping` / `source_deleted`) are invisible on the dashboard - such an order is excluded from every figure with no annotation. | Out of scope for this epic |
| 2 | WooCommerce orders with a null `placedAt` are permanently excluded from Top Products' date filtering (the WC order source sets `createdAt` but not `placedAt`). | Out of scope for this epic |
| 3 | A tooltip conflates two unrelated exclusion counts into one ambiguous number, so the operator cannot tell which cause they are looking at. | Out of scope for this epic |
| 4 | Orders whose `reportingCurrency` is stale relative to the current `reporting_currency_setting`, or was never stamped. | Covered by the Data Coverage panel (Phase 4 onward of #2452) |
| 5 | Orders with `taxRateEra = 'pre-rollout'` permanently excluded from Net Sales even once their rate resolves. | Covered by the Data Coverage panel (Phase 4 onward of #2452) |
| 6 | A further concrete coverage case, not in this epic's scope. | Deferred - handled later with the same per-category panel pattern, not a generic engine |

Per `CLAUDE.md`'s guidance against designing for hypothetical future requirements, this epic does not build a generic "any future silent exclusion" framework - each case is handled concretely, in its own scope, as it comes up.
