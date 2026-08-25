# Analytics dashboard: known gaps deliberately out of scope for the display-currency epic

Related: [ADR-064](../architecture/adrs/064-analytics-display-currency-conversion.md) (display-currency conversion), #2452 (parent epic), and the sibling coverage-remediation decision (Phase 1 Task 1.2 of #2452).

Designing ADR-064 surfaced six further silent-exclusion states on `/analytics`, unrelated to currency display. Three are genuinely out of scope for this epic and are recorded here rather than in an ADR: order-record health statuses (`awaiting_mapping`/`source_deleted`) invisible on the dashboard, WooCommerce orders with a null `placedAt` permanently excluded from Top Products' date filtering, and a tooltip that conflates two unrelated exclusion counts into one ambiguous number. The other two known, concrete cases are covered by the sibling Data Coverage panel (Phase 4 onward of #2452); a further case gets its own treatment later, using the same pattern.

Per `CLAUDE.md`'s guidance against designing for hypothetical future requirements, this epic does not build a generic "any future silent exclusion" framework — each case is handled concretely, in its own scope, as it comes up.
