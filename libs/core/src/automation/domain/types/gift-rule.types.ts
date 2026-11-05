/**
 * Gift Rule Types (#3938, gifts spec section 4)
 *
 * The vocabulary of an "add gift" rule's MUTABLE state and of the named outcomes
 * of evaluating one against an order. The rule itself is an ordinary
 * `AutomationRule` (trigger `order.ingested`, one `add-gift` action); what is
 * kept out of the rule is whatever changes while it runs, because the rule's
 * definition hash is its identity and "units given so far" is not part of it.
 *
 * @module libs/core/src/automation/domain/types
 */

/**
 * Why a gift rule is paused. `unit-cap` is cleared only by an explicit resume
 * (spec R1: an operator decides whether the promotion goes on); `gift-out-of-stock`
 * clears itself the next time the rule is evaluated and the gift is in stock
 * again (spec R2).
 */
export const GiftRulePauseReasonValues = ['unit-cap', 'gift-out-of-stock'] as const;
export type GiftRulePauseReason = (typeof GiftRulePauseReasonValues)[number];

export function isGiftRulePauseReason(value: unknown): value is GiftRulePauseReason {
  return (
    typeof value === 'string' && (GiftRulePauseReasonValues as readonly string[]).includes(value)
  );
}

export interface GiftRuleState {
  readonly ruleId: string;
  readonly pausedReason: GiftRulePauseReason | null;
  readonly pausedAt: Date | null;
  /** Units the operator added to the cap by resuming; the effective cap is `unitCap + capExtension`. */
  readonly capExtension: number;
}

/**
 * One order's gift from one rule. Idempotency and the unit/customer counts both
 * come from this ledger: `(ruleId, internalOrderId)` is unique, so a re-ingestion
 * cannot give twice, and the sums are over what was actually given.
 */
export interface GiftGrant {
  readonly ruleId: string;
  readonly internalOrderId: string;
  /** The resolved OpenLinker customer (not the channel buyer id), null when unresolved. */
  readonly customerId: string | null;
  readonly quantity: number;
  readonly createdAt: Date;
}

/**
 * Every way a gift rule can fail to add its gift, named so the run history and
 * the dry run never end in silence (spec 4.5). `rule-not-matching` carries the
 * evaluator's own reason beside it.
 */
export const GiftNonApplicationReasonValues = [
  'rule-not-matching',
  'superseded-by-earlier-rule',
  'paused-unit-cap',
  'unit-cap-reached',
  'below-per-unit-threshold',
  'gift-already-in-order',
  'customer-limit-reached',
  'customer-unknown',
  'gift-out-of-stock',
  'gift-stock-unknown',
] as const;
export type GiftNonApplicationReason = (typeof GiftNonApplicationReasonValues)[number];

/** What evaluating a rule changes in its persisted state. */
export type GiftRuleStateChange =
  | { readonly kind: 'pause'; readonly reason: GiftRulePauseReason }
  | { readonly kind: 'clear-stock-pause' };

export interface GiftRuleOutcome {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly applied: boolean;
  /** `true` when the gift was already on the order from an earlier ingestion. */
  readonly alreadyApplied: boolean;
  readonly quantity: number;
  readonly reason: GiftNonApplicationReason | null;
  /** The evaluator's own reason, set with `rule-not-matching`. */
  readonly nonFiringReason: string | null;
  /** The earlier rule that stopped this one, set with `superseded-by-earlier-rule`. */
  readonly supersededByRuleId: string | null;
  readonly stateChange: GiftRuleStateChange | null;
}

/** What the planner knows about the gift's stock; `unknown` is NEVER read as zero. */
export type GiftStockAnswer =
  | { readonly kind: 'known'; readonly available: number }
  | { readonly kind: 'unknown' };

/** Everything the planner needs about one rule that the rule row does not carry. */
export interface GiftRuleContext {
  readonly state: GiftRuleState | null;
  readonly unitsGiven: number;
  /** Units this resolved customer already received from the rule; `null` = no customer resolved. */
  readonly customerUnits: number | null;
  readonly stock: GiftStockAnswer;
}

export interface GiftPlanLine {
  readonly productId: string;
  readonly variantId?: string;
  readonly quantity: number;
  /** A gift line already on the order never counts toward a purchase condition. */
  readonly isGift: boolean;
}
