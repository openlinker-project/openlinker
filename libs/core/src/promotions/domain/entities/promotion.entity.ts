/**
 * Promotion Domain Entity (#3935)
 *
 * One operator-authored promotion: *when an order matches these conditions, give
 * this benefit*, within these limits and in this list position. Anemic and
 * immutable per ADR-011; the pure getters only read already-loaded fields.
 *
 * `position` is the explicit list order that stacking is defined against: a
 * promotion that actually applied stops a later one unless both allow each other. It is not part of
 * `definitionHash` - moving a promotion is not changing it.
 *
 * @module libs/core/src/promotions/domain/entities
 */
import type { PromotionBenefit } from '../types/promotion-benefit.types';
import type { PromotionCombination } from '../types/promotion-combination.types';
import type { PromotionCondition } from '../types/promotion-condition.types';
import type { PromotionLimits } from '../types/promotion-limits.types';

export class Promotion {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly isActive: boolean,
    public readonly position: number,
    /** Date-only in the column; a `Date` in the domain. */
    public readonly effectiveFrom: Date,
    /** `null` = open-ended. */
    public readonly effectiveTo: Date | null,
    /** AND-ed, closed vocabulary, order-independent. */
    public readonly conditions: readonly PromotionCondition[],
    public readonly benefit: PromotionBenefit,
    /** Which promotions this one stacks with; stacking needs BOTH sides to allow it (mutual consent). */
    public readonly combinesWith: PromotionCombination,
    public readonly limits: PromotionLimits,
    public readonly definitionHash: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  /** The unit cap before any resume extension, or `null`. */
  hasUnitCap(): boolean {
    return this.limits.unitCap !== null;
  }
}
