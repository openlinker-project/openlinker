/**
 * Plan Promotions (#3935)
 *
 * Decides, for ONE order, which promotions give their benefit and which do not and
 * why. Pure: no I/O, no clock, no mutation. The single function ingestion and the
 * dry run both call, so a preview cannot disagree with what ingestion does.
 *
 * Order of checks per matched promotion, each a named outcome:
 *   superseded by an earlier applied promotion that does not combine -> paused for the unit cap ->
 *   [benefit: quantity / threshold / skip-if-present] -> unit cap -> customer limit ->
 *   [benefit: supply].
 * A promotion that stops here applies nothing. Stacking needs MUTUAL consent: P is
 * superseded when some earlier promotion Q that actually APPLIED does not allow P,
 * or P does not allow Q (see `PromotionCombination`). Only promotions that applied
 * count: one that could not give its benefit must not also deny the substitute
 * below it.
 *
 * Promotions that already gave on an earlier ingestion are passed as
 * `alreadyAppliedPromotionIds` and re-decided for nothing: what was given stays as
 * given, which makes a re-ingestion converge.
 *
 * @module libs/core/src/promotions/domain/domain-services
 */
import type { Promotion } from '../entities/promotion.entity';
import { combinationAllows } from '../types/promotion-combination.types';
import type {
  PromotionContext,
  PromotionOutcome,
  PromotionSkipReason,
  PromotionStateChange,
} from '../types/promotion-application.types';
import type { PromotionPlanLine } from '../types/promotion-facts.types';
import { policyFor } from './benefit-policies/benefit-policy';
import type { PromotionEvaluation } from './evaluate-promotions';

export interface PlanPromotionsInput {
  /** The promotions in LIST ORDER (see `sortPromotions`). */
  readonly promotions: readonly Promotion[];
  readonly evaluations: readonly PromotionEvaluation[];
  readonly alreadyAppliedPromotionIds: ReadonlySet<string>;
  readonly lines: readonly PromotionPlanLine[];
  readonly componentProductIds?: ReadonlySet<string>;
  /** Context per promotion id, supplied only for promotions that matched and are not yet applied. */
  readonly contexts: ReadonlyMap<string, PromotionContext>;
}

/** Promotions in list order: ascending position, then creation time. */
export function sortPromotions(promotions: readonly Promotion[]): Promotion[] {
  return [...promotions].sort((a, b) =>
    a.position !== b.position
      ? a.position - b.position
      : a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

function outcome(
  promotion: Promotion,
  fields: Partial<PromotionOutcome> & Pick<PromotionOutcome, 'applied'>,
): PromotionOutcome {
  return {
    promotionId: promotion.id,
    promotionName: promotion.name,
    alreadyApplied: false,
    quantity: 0,
    reason: null,
    nonFiringReason: null,
    supersededByPromotionId: null,
    stateChange: null,
    ...fields,
  };
}

function refuse(
  promotion: Promotion,
  reason: PromotionSkipReason,
  extra: Partial<PromotionOutcome> = {},
): PromotionOutcome {
  return outcome(promotion, { applied: false, reason, ...extra });
}

/** Mutual consent: each side must allow the other. */
function stacks(earlier: Promotion, later: Promotion): boolean {
  return (
    combinationAllows(earlier.combinesWith, later.id) &&
    combinationAllows(later.combinesWith, earlier.id)
  );
}

export function planPromotions(input: PlanPromotionsInput): PromotionOutcome[] {
  const evaluationById = new Map(input.evaluations.map((e) => [e.promotionId, e] as const));
  const outcomes: PromotionOutcome[] = [];
  /** Earlier promotions that actually applied, in list order. */
  const applied: Promotion[] = [];

  for (const promotion of input.promotions) {
    if (input.alreadyAppliedPromotionIds.has(promotion.id)) {
      outcomes.push(outcome(promotion, { applied: true, alreadyApplied: true }));
      applied.push(promotion);
      continue;
    }

    const evaluation = evaluationById.get(promotion.id);
    if (evaluation === undefined || !evaluation.matches) {
      outcomes.push(
        refuse(promotion, 'rule-not-matching', {
          nonFiringReason: evaluation?.nonFiringReason ?? 'rule-inactive',
        }),
      );
      continue;
    }

    const blocker = applied.find((earlier) => !stacks(earlier, promotion));
    if (blocker !== undefined) {
      outcomes.push(
        refuse(promotion, 'superseded-by-earlier-rule', {
          supersededByPromotionId: blocker.id,
        }),
      );
      continue;
    }

    const context = input.contexts.get(promotion.id);
    if (context === undefined) {
      // A matched promotion with no context is a caller bug; refusing is the safe
      // direction - an unexamined benefit is never given.
      outcomes.push(refuse(promotion, 'gift-stock-unknown'));
      continue;
    }

    const result = planOne(promotion, context, input);
    outcomes.push(result);
    if (result.applied) applied.push(promotion);
  }
  return outcomes;
}

function planOne(
  promotion: Promotion,
  context: PromotionContext,
  input: PlanPromotionsInput,
): PromotionOutcome {
  if (context.state?.pausedReason === 'unit-cap') return refuse(promotion, 'paused-unit-cap');

  const policy = policyFor(promotion.benefit.kind);
  const policyInput = {
    promotion,
    benefit: promotion.benefit,
    lines: input.lines,
    context,
    ...(input.componentProductIds !== undefined && {
      componentProductIds: input.componentProductIds,
    }),
  };

  const wanted = policy.quantity(policyInput);
  if ('skip' in wanted) return refuse(promotion, wanted.skip);
  const quantity = wanted.quantity;

  const { unitCap, customerLimit } = promotion.limits;
  const cap = unitCap === null ? null : unitCap + (context.state?.capExtension ?? 0);
  if (cap !== null && context.unitsGiven + quantity > cap) {
    return refuse(promotion, 'unit-cap-reached', {
      stateChange: { kind: 'pause', reason: 'unit-cap' },
    });
  }

  if (customerLimit !== null) {
    if (context.customerUnits === null) return refuse(promotion, 'customer-unknown');
    if (context.customerUnits + quantity > customerLimit) {
      return refuse(promotion, 'customer-limit-reached');
    }
  }

  const unsupplied = policy.supply(policyInput, quantity);
  if (unsupplied !== null) {
    return refuse(promotion, unsupplied.skip, { stateChange: unsupplied.stateChange });
  }

  let stateChange: PromotionStateChange | null = null;
  if (cap !== null && context.unitsGiven + quantity >= cap) {
    stateChange = { kind: 'pause', reason: 'unit-cap' };
  }
  if (stateChange === null && context.state?.pausedReason === 'gift-out-of-stock') {
    stateChange = { kind: 'clear-stock-pause' };
  }
  return outcome(promotion, { applied: true, quantity, stateChange });
}
