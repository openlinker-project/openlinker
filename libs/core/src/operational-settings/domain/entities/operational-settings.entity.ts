/**
 * Operational Settings Domain Entity
 *
 * Singleton-row representation of the operator-settable sweep budgets and
 * deletion-audit cadence (#2651). Every value is nullable, and `null` means
 * "not set - fall through to the env var, then to the code default", which is
 * what keeps an install that sets nothing byte-identical to its pre-#2651
 * behaviour.
 *
 * Anemic by construction (ADR-011): the resolution rule that turns these
 * nullable fields into effective values is a pure function beside the types it
 * belongs to, not a method here, because the env rung is not a field of this
 * entity.
 *
 * @module libs/core/src/operational-settings/domain/entities
 */

export const OPERATIONAL_SETTINGS_SINGLETON_ID = 'singleton';

export class OperationalSettings {
  constructor(
    public readonly catalogueSweepBudget: number | null,
    public readonly inventorySweepBudget: number | null,
    public readonly sweepPageSize: number | null,
    public readonly deletionAuditBudget: number | null,
    public readonly deletionAuditCadence: string | null,
    public readonly updatedAt: Date,
    public readonly updatedBy: string | null
  ) {}
}
