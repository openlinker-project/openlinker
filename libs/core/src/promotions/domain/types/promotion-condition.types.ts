/**
 * Promotion Condition Types (#3935)
 *
 * The closed condition vocabulary of a promotion and the ONE table that defines
 * it. Each field has a descriptor carrying its shape check and its pure
 * evaluator, so adding a condition means adding one entry: the narrower, the
 * evaluator and the field list are all read from the table, and the mapped type
 * over `PromotionConditionFieldValues` makes a missing entry a compile error.
 *
 * Semantics are those the gift rules already had: a currency mismatch never
 * matches (no conversion, ever), an unasserted fact is `unknown` and never
 * `false`, and a malformed persisted condition narrows to "never matches" on the
 * read path rather than throwing.
 *
 * @module libs/core/src/promotions/domain/types
 */
import type { PromotionOrderFacts } from './promotion-facts.types';

export const PromotionConditionFieldValues = [
  'orderTotalGross',
  'containsProduct',
  'sourceConnection',
  'sourceConnectionIn',
  'orderCountry',
] as const;
export type PromotionConditionField = (typeof PromotionConditionFieldValues)[number];

export const PromotionAmountOpValues = ['gte', 'lt'] as const;
export type PromotionAmountOp = (typeof PromotionAmountOpValues)[number];

export type PromotionCondition =
  | {
      readonly field: 'orderTotalGross';
      readonly op: PromotionAmountOp;
      /** Decimal string with at most two fractional digits (it round-trips through jsonb). */
      readonly amount: string;
      readonly currency: string;
    }
  /** The order has a line of this internal product or variant id. */
  | { readonly field: 'containsProduct'; readonly op: 'eq'; readonly value: string }
  | { readonly field: 'sourceConnection'; readonly op: 'eq'; readonly value: string }
  | { readonly field: 'sourceConnectionIn'; readonly op: 'in'; readonly values: readonly string[] }
  | { readonly field: 'orderCountry'; readonly op: 'eq'; readonly value: string };

export const PromotionConditionOutcomeValues = [
  'true',
  'false',
  'unknown',
  'currency-mismatch',
] as const;
export type PromotionConditionOutcome = (typeof PromotionConditionOutcomeValues)[number];

export interface PromotionConditionDescriptor<F extends PromotionConditionField> {
  /** Shape check over an untrusted record already known to carry this `field`. */
  readonly isValid: (value: Record<string, unknown>) => boolean;
  readonly evaluate: (
    condition: Extract<PromotionCondition, { field: F }>,
    facts: PromotionOrderFacts,
  ) => PromotionConditionOutcome;
}

const DECIMAL_AMOUNT = /^\d+(\.\d{1,2})?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export const PROMOTION_CONDITION_DESCRIPTORS: {
  readonly [F in PromotionConditionField]: PromotionConditionDescriptor<F>;
} = {
  orderTotalGross: {
    isValid: (v) =>
      (PromotionAmountOpValues as readonly unknown[]).includes(v.op) &&
      typeof v.amount === 'string' &&
      DECIMAL_AMOUNT.test(v.amount) &&
      typeof v.currency === 'string' &&
      CURRENCY_CODE.test(v.currency),
    evaluate: (condition, facts) => {
      if (facts.totalGross === undefined || facts.currency === undefined) return 'unknown';
      // No conversion, ever: another currency is a second promotion.
      if (facts.currency !== condition.currency) return 'currency-mismatch';
      const threshold = Number(condition.amount);
      if (!Number.isFinite(threshold)) return 'unknown';
      const matches =
        condition.op === 'gte' ? facts.totalGross >= threshold : facts.totalGross < threshold;
      return matches ? 'true' : 'false';
    },
  },
  containsProduct: {
    isValid: (v) => v.op === 'eq' && nonEmptyString(v.value),
    evaluate: (condition, facts) => {
      if (facts.lineProductIds === undefined && facts.lineVariantIds === undefined) {
        return 'unknown';
      }
      return (facts.lineProductIds ?? []).includes(condition.value) ||
        (facts.lineVariantIds ?? []).includes(condition.value)
        ? 'true'
        : 'false';
    },
  },
  sourceConnection: {
    isValid: (v) => v.op === 'eq' && nonEmptyString(v.value),
    evaluate: (condition, facts) => {
      if (facts.sourceConnectionId === undefined) return 'unknown';
      return facts.sourceConnectionId === condition.value ? 'true' : 'false';
    },
  },
  sourceConnectionIn: {
    isValid: (v) =>
      v.op === 'in' &&
      Array.isArray(v.values) &&
      v.values.length > 0 &&
      v.values.every(nonEmptyString),
    evaluate: (condition, facts) => {
      if (facts.sourceConnectionId === undefined) return 'unknown';
      return condition.values.includes(facts.sourceConnectionId) ? 'true' : 'false';
    },
  },
  orderCountry: {
    isValid: (v) => v.op === 'eq' && nonEmptyString(v.value),
    evaluate: (condition, facts) => {
      if (facts.country === undefined) return 'unknown';
      return facts.country === condition.value ? 'true' : 'false';
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConditionField(value: unknown): value is PromotionConditionField {
  return typeof value === 'string' && (PromotionConditionFieldValues as readonly string[]).includes(value);
}

/** Narrow an untrusted value to one well-formed condition; never throws. */
export function isPromotionCondition(value: unknown): value is PromotionCondition {
  if (!isRecord(value) || !isConditionField(value.field)) return false;
  return PROMOTION_CONDITION_DESCRIPTORS[value.field].isValid(value);
}

/** Evaluate one condition through its descriptor. */
export function evaluatePromotionCondition(
  condition: PromotionCondition,
  facts: PromotionOrderFacts,
): PromotionConditionOutcome {
  const descriptor = PROMOTION_CONDITION_DESCRIPTORS[condition.field] as PromotionConditionDescriptor<
    typeof condition.field
  >;
  return descriptor.evaluate(condition as never, facts);
}
