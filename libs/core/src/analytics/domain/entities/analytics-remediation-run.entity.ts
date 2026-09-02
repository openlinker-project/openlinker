/**
 * Analytics Remediation Run Domain Entity
 *
 * One row of the `analytics_remediation_runs` audit ledger — a record that an
 * operator asked for a Data Coverage repair, and how that repair ended
 * (#2468, epic #2452 Phase 5).
 *
 * The ledger row is not bookkeeping: it is what makes the currency
 * recalculation an AUDITED restatement rather than a silent one. ADR-040
 * declares the FX stamp immutable ("a row that carries a figure is never
 * re-entered"), and this run is the documented exception to that — see
 * `OrderFxRestatementService` (`@openlinker/core/orders`) and ADR-040's
 * amendment for #2468. Without a durable row naming who asked, when, and over
 * how many orders, a restated financial figure would be unexplainable after
 * the fact.
 *
 * Anemic by construction per ADR-011 — every field is `readonly` and state
 * transitions go through explicit repository methods, never a mutator here.
 *
 * @module libs/core/src/analytics/domain/entities
 */
import type { CoverageResolutionStatus } from '@openlinker/core/orders/types';

export class AnalyticsRemediationRun {
  constructor(
    public readonly id: string,
    public readonly category: string,
    public readonly status: CoverageResolutionStatus,
    public readonly detail: string | null,
    public readonly affectedCount: number,
    public readonly triggeredByUserId: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}
}
