/**
 * Benefit Policy (#3935)
 *
 * How one KIND of benefit decides whether and how much to give. The planner owns
 * what is common to every promotion (list order, stacking, the unit cap, the
 * customer limit, the pause lifecycle) and asks the policy for the two things
 * that are the benefit's own:
 *  1. `quantity` - how much this order earns, or the reason it earns nothing;
 *  2. `supply` - whether the benefit can actually be delivered (stock, for a gift).
 *
 * `BENEFIT_POLICIES` is a mapped type over `PromotionBenefitKindValues`, so a new
 * benefit kind does not compile until it has a policy.
 *
 * @module libs/core/src/promotions/domain/domain-services/benefit-policies
 */
import type { Promotion } from '../../entities/promotion.entity';
import type {
  PromotionContext,
  PromotionSkipReason,
  PromotionStateChange,
} from '../../types/promotion-application.types';
import type { PromotionBenefit, PromotionBenefitKind } from '../../types/promotion-benefit.types';
import type { PromotionPlanLine } from '../../types/promotion-facts.types';
import { freeGiftPolicy } from './free-gift.policy';

export interface BenefitPolicyInput<K extends PromotionBenefitKind> {
  readonly promotion: Promotion;
  readonly benefit: Extract<PromotionBenefit, { kind: K }>;
  readonly lines: readonly PromotionPlanLine[];
  /** Product ids of the order's physical bundle components (skip-if-present over sets). */
  readonly componentProductIds?: ReadonlySet<string>;
  readonly context: PromotionContext;
}

export type BenefitQuantityResult =
  | { readonly quantity: number }
  | { readonly skip: PromotionSkipReason };

export type BenefitSupplyResult = {
  readonly skip: PromotionSkipReason;
  readonly stateChange: PromotionStateChange | null;
} | null;

export interface BenefitPolicy<K extends PromotionBenefitKind> {
  readonly kind: K;
  quantity(input: BenefitPolicyInput<K>): BenefitQuantityResult;
  supply(input: BenefitPolicyInput<K>, quantity: number): BenefitSupplyResult;
}

export const BENEFIT_POLICIES: { readonly [K in PromotionBenefitKind]: BenefitPolicy<K> } = {
  'free-gift': freeGiftPolicy,
};

export function policyFor<K extends PromotionBenefitKind>(kind: K): BenefitPolicy<K> {
  return BENEFIT_POLICIES[kind];
}
