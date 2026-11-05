/**
 * Gift Rule Service Interface (#3938)
 *
 * The seam other contexts and the API use for everything about a gift rule that is
 * not the rule's definition: its place in the list, what it has given, its pause
 * state, and the grant ledger. The rule's own CRUD stays on
 * `IAutomationRulesService`.
 *
 * @module libs/core/src/automation/application/interfaces
 */
import type { AutomationRule } from '../../domain/entities/automation-rule.entity';
import type { GiftGrant, GiftRuleState, GiftRuleStateChange } from '../../domain/types/gift-rule.types';

export interface GiftRuleView {
  readonly rule: AutomationRule;
  readonly state: GiftRuleState | null;
  readonly unitsGiven: number;
  /** `unitCap + capExtension`, or `null` when the rule has no cap. */
  readonly effectiveCap: number | null;
}

/** The ledger facts the planner needs for a set of matched rules. */
export interface GiftLedgerSnapshot {
  readonly states: ReadonlyMap<string, GiftRuleState>;
  readonly unitsGiven: ReadonlyMap<string, number>;
  /** Units the resolved customer already received per rule; empty when no customer was resolved. */
  readonly customerUnits: ReadonlyMap<string, number>;
}

export interface IGiftRuleService {
  /** Every gift rule in list order, with its state and what it has given. */
  listGiftRules(): Promise<GiftRuleView[]>;

  /** The gift rules in list order, without the ledger (what ingestion evaluates). */
  listOrderedRules(): Promise<AutomationRule[]>;

  /** Serialise concurrent evaluations of the same rules; see `GiftRuleLedgerPort.withRulesLocked`. */
  withRulesLocked<T>(ruleIds: readonly string[], work: () => Promise<T>): Promise<T>;

  getLedgerSnapshot(ruleIds: readonly string[], customerId: string | null): Promise<GiftLedgerSnapshot>;

  getGrantsForOrder(internalOrderId: string): Promise<GiftGrant[]>;

  /** `true` when this call wrote the grant, `false` when the pair already had one. */
  recordGrant(grant: Omit<GiftGrant, 'createdAt'>): Promise<boolean>;

  /** Return a cancelled order's gift units to the rules' caps; returns the rows removed. */
  releaseGrantsForOrder(internalOrderId: string): Promise<number>;

  /** See `GiftRuleLedgerPort.sumPendingUnitsForVariants`. */
  getPendingGrantUnits(
    variantIds: readonly string[],
    excludeOrderId: string | null,
  ): Promise<Map<string, number>>;

  applyStateChange(ruleId: string, change: GiftRuleStateChange): Promise<void>;

  /**
   * The explicit resume of a rule paused at its unit cap (spec R1): raise the cap
   * by `additionalUnits` (at least 1) and lift the pause. Throws
   * `AutomationRuleNotFoundError` for an unknown rule.
   */
  resumeAfterCap(ruleId: string, additionalUnits: number): Promise<GiftRuleView>;
}
