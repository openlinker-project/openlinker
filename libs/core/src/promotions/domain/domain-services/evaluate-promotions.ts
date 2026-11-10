/**
 * Evaluate Promotions (#3935)
 *
 * The pure first half of applying promotions: which promotions MATCH an order
 * and, for every one that does not, why. No I/O and no clock. Every condition is
 * evaluated (no short-circuit) so the dry run can render the whole table, and an
 * unknown fact never collapses into a false one.
 *
 * Eligibility outranks a failing condition as the headline reason (a switched-off
 * promotion did not fail a condition). The retroactivity floor - a promotion never
 * reaches back to an order placed before it was saved - is enforced by default and
 * waived only by the dry run, which reports the waiver.
 *
 * @module libs/core/src/promotions/domain/domain-services
 */
import type { Promotion } from '../entities/promotion.entity';
import type { PromotionOrderFacts } from '../types/promotion-facts.types';
import {
  evaluatePromotionCondition,
  type PromotionCondition,
  type PromotionConditionField,
  type PromotionConditionOutcome,
} from '../types/promotion-condition.types';

export const PromotionNonFiringReasonValues = [
  'rule-inactive',
  'not-yet-effective',
  'no-longer-effective',
  'fact-time-unknown',
  'fact-precedes-rule',
  'condition-not-met',
  'condition-fact-unknown',
  'condition-currency-mismatch',
] as const;
export type PromotionNonFiringReason = (typeof PromotionNonFiringReasonValues)[number];

export interface PromotionConditionTrace {
  readonly field: PromotionConditionField;
  readonly condition: PromotionCondition;
  readonly outcome: PromotionConditionOutcome;
}

export interface PromotionEvaluation {
  readonly promotionId: string;
  readonly promotionName: string;
  readonly matches: boolean;
  readonly conditionTraces: readonly PromotionConditionTrace[];
  /** `null` if and only if `matches`. */
  readonly nonFiringReason: PromotionNonFiringReason | null;
  /** The floor WOULD have blocked this promotion and was waived by the caller. */
  readonly retroactivityFloorWaived: boolean;
}

export interface EvaluatePromotionsInput {
  readonly promotions: readonly Promotion[];
  readonly facts: PromotionOrderFacts;
  readonly now: Date;
  /** Defaults to `true`, so an omission can never widen what applies. */
  readonly enforceRetroactivityFloor?: boolean;
}

export interface EvaluatePromotionsResult {
  /** One entry per input promotion, in input order. */
  readonly evaluations: readonly PromotionEvaluation[];
  readonly matched: readonly PromotionEvaluation[];
}

function reasonForOutcome(outcome: PromotionConditionOutcome): PromotionNonFiringReason | null {
  switch (outcome) {
    case 'true':
      return null;
    case 'false':
      return 'condition-not-met';
    case 'unknown':
      return 'condition-fact-unknown';
    case 'currency-mismatch':
      return 'condition-currency-mismatch';
    default: {
      const exhaustive: never = outcome;
      void exhaustive;
      return 'condition-fact-unknown';
    }
  }
}

function floorReason(promotion: Promotion, facts: PromotionOrderFacts): PromotionNonFiringReason | null {
  // An unknown placement time does not clear the floor: the wrong guess gives a
  // gift to every order the promotion was never meant to reach.
  if (facts.occurredAt === undefined) return 'fact-time-unknown';
  if (facts.occurredAt.getTime() < promotion.createdAt.getTime()) return 'fact-precedes-rule';
  return null;
}

function eligibility(
  promotion: Promotion,
  input: EvaluatePromotionsInput,
): { reason: PromotionNonFiringReason | null; waived: boolean } {
  if (!promotion.isActive) return { reason: 'rule-inactive', waived: false };
  const now = input.now.getTime();
  if (promotion.effectiveFrom.getTime() > now) return { reason: 'not-yet-effective', waived: false };
  if (promotion.effectiveTo !== null && promotion.effectiveTo.getTime() < now) {
    return { reason: 'no-longer-effective', waived: false };
  }
  const floor = floorReason(promotion, input.facts);
  if (floor !== null && (input.enforceRetroactivityFloor ?? true)) {
    return { reason: floor, waived: false };
  }
  return { reason: null, waived: floor !== null };
}

export function evaluatePromotions(input: EvaluatePromotionsInput): EvaluatePromotionsResult {
  const evaluations = input.promotions.map<PromotionEvaluation>((promotion) => {
    const { reason: eligibilityReason, waived } = eligibility(promotion, input);
    const conditionTraces = promotion.conditions.map<PromotionConditionTrace>((condition) => ({
      field: condition.field,
      condition,
      outcome: evaluatePromotionCondition(condition, input.facts),
    }));
    const firstProblem = conditionTraces.find((trace) => trace.outcome !== 'true');
    const nonFiringReason =
      eligibilityReason ??
      (firstProblem === undefined ? null : reasonForOutcome(firstProblem.outcome));
    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      matches: nonFiringReason === null,
      conditionTraces,
      nonFiringReason,
      retroactivityFloorWaived: waived,
    };
  });
  return { evaluations, matched: evaluations.filter((e) => e.matches) };
}
