/**
 * Gift Rule Ledger Port (#3938)
 *
 * Persistence of what gift rules have DONE: the per-rule state (pause, raised
 * cap) and the grant ledger (one row per rule per order). Both are written by the
 * ingestion path and read by the rule list; neither is part of a rule's
 * definition.
 *
 * @module libs/core/src/automation/domain/ports
 */
import type { GiftGrant, GiftRulePauseReason, GiftRuleState } from '../types/gift-rule.types';

export interface GiftRuleLedgerPort {
  /**
   * Run `work` while holding a transaction-scoped advisory lock per rule id (taken
   * in sorted order, so two callers cannot deadlock). It serialises the
   * read-sum-then-insert-grant of two concurrent ingestions, which is what stops
   * them overshooting a unit cap or a customer limit.
   */
  withRulesLocked<T>(ruleIds: readonly string[], work: () => Promise<T>): Promise<T>;

  findStates(ruleIds: readonly string[]): Promise<Map<string, GiftRuleState>>;

  /** Total gift units given per rule. A rule that gave nothing is absent from the map. */
  sumUnitsGiven(ruleIds: readonly string[]): Promise<Map<string, number>>;

  /** Units one resolved customer received per rule. */
  sumUnitsForCustomer(
    ruleIds: readonly string[],
    customerId: string,
  ): Promise<Map<string, number>>;

  findGrantsForOrder(internalOrderId: string): Promise<GiftGrant[]>;

  /**
   * Record a grant. `true` when this call wrote it, `false` when the (rule,
   * order) pair already had one - the idempotency answer, not an error.
   */
  recordGrant(grant: Omit<GiftGrant, 'createdAt'>): Promise<boolean>;

  /**
   * Delete every grant of a cancelled order so its units return to the rule's cap
   * and the customer's limit. Returns how many rows were removed; idempotent.
   */
  releaseGrantsForOrder(internalOrderId: string): Promise<number>;

  /**
   * Units granted for these gift variants whose order has not reserved yet (no
   * held reservation) and whose grant is newer than `notOlderThan`, per variant,
   * leaving `excludeOrderId` out. The availability read cannot see them, so the
   * stock check subtracts them or two simultaneous orders both read the last unit.
   */
  sumPendingUnitsForVariants(
    variantIds: readonly string[],
    excludeOrderId: string | null,
    notOlderThan: Date,
  ): Promise<Map<string, number>>;

  /** Set (`reason`) or clear (`null`) the pause, creating the state row if needed. */
  setPause(ruleId: string, reason: GiftRulePauseReason | null): Promise<void>;

  /**
   * Raise the rule's cap by `extraUnits` and clear a `unit-cap` pause (the
   * explicit resume, spec R1). A `gift-out-of-stock` pause is left alone.
   */
  extendCap(ruleId: string, extraUnits: number): Promise<void>;
}
