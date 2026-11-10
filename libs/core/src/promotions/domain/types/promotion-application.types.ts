/**
 * Promotion Application Types (#3935)
 *
 * The vocabulary of a promotion's MUTABLE state and of the named outcomes of
 * evaluating one against an order. The promotion row is its definition; what
 * changes while it runs (units given, pause, a raised cap) is kept out of it.
 * Reason codes are stable: the frontend reads them.
 *
 * @module libs/core/src/promotions/domain/types
 */

/**
 * Why a promotion is paused. `unit-cap` is cleared only by an explicit resume
 * (an operator decides whether it goes on); `gift-out-of-stock` clears itself the
 * next time the promotion is evaluated and the gift is in stock again.
 */
export const PromotionPauseReasonValues = ['unit-cap', 'gift-out-of-stock'] as const;
export type PromotionPauseReason = (typeof PromotionPauseReasonValues)[number];

export function isPromotionPauseReason(value: unknown): value is PromotionPauseReason {
  return (
    typeof value === 'string' && (PromotionPauseReasonValues as readonly string[]).includes(value)
  );
}

export interface PromotionState {
  readonly promotionId: string;
  readonly pausedReason: PromotionPauseReason | null;
  readonly pausedAt: Date | null;
  /** Units the operator added to the cap by resuming; the effective cap is `unitCap + capExtension`. */
  readonly capExtension: number;
}

/**
 * One order's benefit from one promotion. `(promotionId, internalOrderId)` is
 * unique, so a re-ingestion cannot give twice, and unit/customer sums are over
 * what was actually given.
 */
export interface PromotionGrant {
  readonly promotionId: string;
  readonly internalOrderId: string;
  /** The resolved OpenLinker customer (not the channel buyer id), null when unresolved. */
  readonly customerId: string | null;
  readonly quantity: number;
  /** What was given, frozen at grant time: a self-heal rebuilds the line from the grant, not the promotion. */
  readonly productId: string;
  readonly variantId: string;
  readonly documentForm: string | null;
  readonly createdAt: Date;
}

/** Every way a promotion can fail to give its benefit, named so no outcome is silent. */
export const PromotionSkipReasonValues = [
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
export type PromotionSkipReason = (typeof PromotionSkipReasonValues)[number];

/** What evaluating a promotion changes in its persisted state. */
export type PromotionStateChange =
  | { readonly kind: 'pause'; readonly reason: PromotionPauseReason }
  | { readonly kind: 'clear-stock-pause' };

export interface PromotionOutcome {
  readonly promotionId: string;
  readonly promotionName: string;
  readonly applied: boolean;
  /** `true` when the benefit was already on the order from an earlier ingestion. */
  readonly alreadyApplied: boolean;
  readonly quantity: number;
  readonly reason: PromotionSkipReason | null;
  /** The evaluator's own reason, set with `rule-not-matching`. */
  readonly nonFiringReason: string | null;
  /** The earlier promotion that stopped this one, set with `superseded-by-earlier-rule`. */
  readonly supersededByPromotionId: string | null;
  readonly stateChange: PromotionStateChange | null;
}

/** What the planner knows about the benefit's supply; `unknown` is NEVER read as zero. */
export type PromotionStockAnswer =
  | { readonly kind: 'known'; readonly available: number }
  | { readonly kind: 'unknown' };

/** Everything the planner needs about one promotion that the promotion row does not carry. */
export interface PromotionContext {
  readonly state: PromotionState | null;
  readonly unitsGiven: number;
  /** Units this resolved customer already received; `null` = no customer resolved. */
  readonly customerUnits: number | null;
  readonly stock: PromotionStockAnswer;
}

/** Application-log outcome. `failed` is the fail-open record: the order went on without its benefit. */
export const PromotionApplicationOutcomeValues = ['applied', 'skipped', 'failed'] as const;
export type PromotionApplicationOutcome = (typeof PromotionApplicationOutcomeValues)[number];

export interface PromotionApplicationRecord {
  readonly id: string;
  readonly promotionId: string;
  readonly promotionName: string;
  readonly internalOrderId: string;
  readonly outcome: PromotionApplicationOutcome;
  readonly reason: string | null;
  readonly quantity: number;
  readonly message: string | null;
  readonly dismissedAt: Date | null;
  readonly dismissedByUserId: string | null;
  readonly createdAt: Date;
}
