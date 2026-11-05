/**
 * Plan Gift Application (#3938, gifts spec 4.2 and 4.5)
 *
 * Decides, for ONE order, which gift rules add their gift and which do not and
 * why. Pure: no I/O, no clock, no mutation. It is the rule engine's second half -
 * `evaluateAutomationRules` says which rules MATCH, this applies the gift-specific
 * policy to the matches in list order - and the single function the ingestion path
 * and the dry run both call, so a preview cannot disagree with what ingestion does.
 *
 * Order of checks per matched rule, each a named outcome:
 *   superseded by an earlier "do not combine" rule -> paused for the unit cap ->
 *   per-unit threshold -> gift already in the order -> unit cap -> customer limit ->
 *   gift stock.
 * A rule that stops here applies nothing, and a "do not combine" rule stops the
 * rules below it ONLY when it actually applied: a rule that could not give its gift
 * must not also deny the substitute rule below it (R2: "a substitute is a second
 * rule lower in the list").
 *
 * Rules that already gave their gift on an earlier ingestion are passed as
 * `alreadyApplied` and re-evaluated for nothing: the gift stays as given, which is
 * what makes a re-ingestion converge instead of re-deciding against an order the
 * operator may have since edited.
 *
 * @module libs/core/src/automation/domain/domain-services
 */
import type { AutomationRule } from '../entities/automation-rule.entity';
import type { AutomationGiftAction } from '../types/automation-action.types';
import type {
  GiftNonApplicationReason,
  GiftPlanLine,
  GiftRuleContext,
  GiftRuleOutcome,
  GiftRuleStateChange,
} from '../types/gift-rule.types';
import type { AutomationRuleEvaluation } from './evaluate-automation-rules';

export interface GiftPlanInput {
  /** The gift rules in LIST ORDER (see `sortGiftRules`). */
  readonly rules: readonly AutomationRule[];
  /** The evaluator's verdicts for those rules (the order may differ; matched by id). */
  readonly evaluations: readonly AutomationRuleEvaluation[];
  /** Rule ids whose gift is already on the order from an earlier ingestion. */
  readonly alreadyAppliedRuleIds: ReadonlySet<string>;
  readonly lines: readonly GiftPlanLine[];
  /**
   * Product ids of the order's PHYSICAL components, for skip-if-present over
   * bundles (#3945). Empty until that lands: today only commercial lines are
   * looked at, and the seam is the argument.
   */
  readonly componentProductIds?: ReadonlySet<string>;
  /** Context per rule id, supplied only for rules that matched and are not yet applied. */
  readonly contexts: ReadonlyMap<string, GiftRuleContext>;
}

/** Gift rules in list order: positioned first (ascending), then by creation time. */
export function sortGiftRules(rules: readonly AutomationRule[]): AutomationRule[] {
  return [...rules].sort((a, b) => {
    if (a.position !== b.position) {
      if (a.position === null) return 1;
      if (b.position === null) return -1;
      return a.position - b.position;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

function giftActionOf(rule: AutomationRule): AutomationGiftAction | null {
  const step = rule.actions.find((a) => a.action === 'add-gift');
  return step !== undefined && step.action === 'add-gift' ? step : null;
}

function outcome(
  rule: AutomationRule,
  fields: Partial<GiftRuleOutcome> & Pick<GiftRuleOutcome, 'applied'>,
): GiftRuleOutcome {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    alreadyApplied: false,
    quantity: 0,
    reason: null,
    nonFiringReason: null,
    supersededByRuleId: null,
    stateChange: null,
    ...fields,
  };
}

function refuse(
  rule: AutomationRule,
  reason: GiftNonApplicationReason,
  extra: Partial<GiftRuleOutcome> = {},
): GiftRuleOutcome {
  return outcome(rule, { applied: false, reason, ...extra });
}

/** How many gift units a rule wants for this order, or the reason it wants none. */
function wantedQuantity(
  action: AutomationGiftAction,
  lines: readonly GiftPlanLine[],
): number | 'below-threshold' {
  if (action.perUnit === null) return action.quantity;
  const { productId, per, maxPerOrder } = action.perUnit;
  const units = lines
    .filter((line) => !line.isGift && line.productId === productId)
    .reduce((sum, line) => sum + line.quantity, 0);
  const batches = Math.floor(units / per);
  if (batches < 1) return 'below-threshold';
  return action.quantity * (maxPerOrder === null ? batches : Math.min(batches, maxPerOrder));
}

export function planGiftApplication(input: GiftPlanInput): GiftRuleOutcome[] {
  const evaluationById = new Map(input.evaluations.map((e) => [e.ruleId, e] as const));
  const outcomes: GiftRuleOutcome[] = [];
  let combineStopper: AutomationRule | null = null;

  for (const rule of input.rules) {
    const action = giftActionOf(rule);
    if (action === null) {
      outcomes.push(refuse(rule, 'rule-not-matching', { nonFiringReason: 'no-actions' }));
      continue;
    }

    if (input.alreadyAppliedRuleIds.has(rule.id)) {
      outcomes.push(outcome(rule, { applied: true, alreadyApplied: true }));
      if (action.doNotCombine && combineStopper === null) combineStopper = rule;
      continue;
    }

    const evaluation = evaluationById.get(rule.id);
    if (evaluation === undefined || !evaluation.matches) {
      outcomes.push(
        refuse(rule, 'rule-not-matching', {
          nonFiringReason: evaluation?.nonFiringReason ?? 'trigger-mismatch',
        }),
      );
      continue;
    }

    if (combineStopper !== null) {
      outcomes.push(
        refuse(rule, 'superseded-by-earlier-rule', { supersededByRuleId: combineStopper.id }),
      );
      continue;
    }

    const context = input.contexts.get(rule.id);
    if (context === undefined) {
      // A matched rule with no context is a caller bug; refusing is the safe
      // direction - an unexamined gift is never added.
      outcomes.push(refuse(rule, 'gift-stock-unknown'));
      continue;
    }

    const result = planOne(rule, action, context, input);
    outcomes.push(result);
    if (result.applied && action.doNotCombine) combineStopper = rule;
  }
  return outcomes;
}

function planOne(
  rule: AutomationRule,
  action: AutomationGiftAction,
  context: GiftRuleContext,
  input: GiftPlanInput,
): GiftRuleOutcome {
  if (context.state?.pausedReason === 'unit-cap') {
    return refuse(rule, 'paused-unit-cap');
  }

  const wanted = wantedQuantity(action, input.lines);
  if (wanted === 'below-threshold') return refuse(rule, 'below-per-unit-threshold');

  if (action.skipIfPresent) {
    const present =
      input.lines.some(
        (line) =>
          !line.isGift &&
          (line.productId === action.productId || line.variantId === action.variantId),
      ) || (input.componentProductIds?.has(action.productId) ?? false);
    if (present) return refuse(rule, 'gift-already-in-order');
  }

  if (action.unitCap !== null) {
    const cap = action.unitCap + (context.state?.capExtension ?? 0);
    if (context.unitsGiven + wanted > cap) {
      return refuse(rule, 'unit-cap-reached', {
        stateChange: { kind: 'pause', reason: 'unit-cap' },
      });
    }
  }

  if (action.customerLimit !== null) {
    if (context.customerUnits === null) return refuse(rule, 'customer-unknown');
    if (context.customerUnits + wanted > action.customerLimit) {
      return refuse(rule, 'customer-limit-reached');
    }
  }

  if (context.stock.kind === 'unknown') return refuse(rule, 'gift-stock-unknown');
  if (context.stock.available < wanted) {
    return refuse(rule, 'gift-out-of-stock', {
      stateChange: { kind: 'pause', reason: 'gift-out-of-stock' },
    });
  }

  let stateChange: GiftRuleStateChange | null = null;
  if (action.unitCap !== null) {
    const cap = action.unitCap + (context.state?.capExtension ?? 0);
    if (context.unitsGiven + wanted >= cap) {
      stateChange = { kind: 'pause', reason: 'unit-cap' };
    }
  }
  if (stateChange === null && context.state?.pausedReason === 'gift-out-of-stock') {
    stateChange = { kind: 'clear-stock-pause' };
  }
  return outcome(rule, { applied: true, quantity: wanted, stateChange });
}
