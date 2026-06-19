/**
 * Order Ship-by SLA Types
 *
 * The dispatch-SLA axis (#1108): is this order late to ship? Derived from the
 * order's own `dispatchByAt` deadline (#927) reconciled with its fulfillment
 * rollup (#1108) — an order that has already shipped carries no SLA pressure.
 *
 * **Orthogonal to order-health.** Sync-health (`order-record.types.ts`) answers
 * "did it sync to destinations?"; SLA answers "is dispatch late?". They are
 * separate axes — SLA is NOT a fifth health bucket.
 *
 * **Single source of truth (BE).** `slaState` is computed server-side via
 * `deriveSlaState` and surfaced on the order response; the FE consumes it and
 * never re-derives the bucket (it computes only the live ticking countdown from
 * `dispatchByAt`). The list filter + summary encode the same rule in SQL. This
 * guarantees the list filter and the row badge agree.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * Ship-by SLA bucket values (#1108).
 *
 * PRECEDENCE (the rule `deriveSlaState` and the orders SQL filter/summary both
 * encode):
 *   - `none`     — no deadline (`dispatchByAt` null) OR already shipped
 *                  (`fulfillmentState ∈ { dispatched, delivered }`)
 *   - `overdue`  — not shipped AND `dispatchByAt <= now`
 *   - `at_risk`  — not shipped AND `now < dispatchByAt <= now + SLA_AT_RISK_WINDOW_MS`
 *   - `on_track` — not shipped AND `dispatchByAt > now + SLA_AT_RISK_WINDOW_MS`
 */
export const SlaStateValues = ['none', 'on_track', 'at_risk', 'overdue'] as const;

/**
 * Ship-by SLA bucket type (#1108).
 */
export type SlaState = (typeof SlaStateValues)[number];

/**
 * At-risk lead window: an order whose ship-by deadline falls within this window
 * ahead of `now` (and hasn't shipped) is `at_risk`. Single owned constant so the
 * derivation helper and the SQL filter/summary share one threshold. 24 hours.
 */
export const SLA_AT_RISK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Aggregate count of order records per SLA bucket (#1108) for the list KPI
 * strip. `total` equals the sum of the four buckets for the same filter scope.
 * Reuses `OrderHealthSummaryFilters` for its scope subset.
 */
export interface OrderSlaSummary {
  total: number;
  onTrack: number;
  atRisk: number;
  overdue: number;
  none: number;
}
