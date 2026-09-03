/**
 * Automation Rule Condition Types (#2358, Wave-2 spec §5.5 divergence 2)
 *
 * The closed condition vocabulary an `automation_rules` row matches a subject
 * against — mirroring `sales-document-condition.types.ts` (#2170) in shape: a
 * discriminated union on `field`, each field carrying exactly the comparison it
 * needs, and a runtime narrower that treats a malformed persisted condition as
 * **never matches** rather than throwing.
 *
 * **Declared divergence from #2161** (spec §5.5 divergence 2): `orderTotalGross`
 * carries an **inline amount + currency**, where #2170 structurally forbids one
 * and forces a `thresholdRef`. That indirection exists so a LEGAL amount can
 * version independently of the rules citing it. An automation threshold ("email
 * me about orders over 2,000 PLN") has no legal-matrix versioning concern, and
 * routing the operator through a separate thresholds table to author one would
 * be ceremony imported from a constraint that does not apply here.
 *
 * **The amount is a decimal STRING, not a JSON number.** JSON numbers are IEEE
 * doubles, and this value round-trips through `jsonb`. A string lets the
 * narrower check a bounded 2-decimal shape, which a number cannot express —
 * that, and not any FX precedent, is the reason. (The ADR-040 stamp is
 * analytics-only and must not be reached for; spec §5.5 says so explicitly.)
 *
 * **Currency mismatch is not resolved here.** Spec §5.5: no conversion, ever —
 * the rule simply does not match. That is the evaluator's rule (#2359); this
 * file's only obligation is to persist what the operator typed, faithfully.
 *
 * The one cross-context import is `HoldReason` from the `order-lifecycle`
 * zero-sibling-edge leaf (#2305). Restating the eight hold-reason strings
 * locally is exactly the drift that leaf exists to prevent, and the leaf has no
 * outbound core edges, so a value import from it cannot close a CJS
 * module-load cycle. Spec §5.3b: the composer cannot add a reason.
 *
 * @module libs/core/src/automation/domain/types
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.5
 */
import type { HoldReason} from '@openlinker/core/order-lifecycle';
import { isHoldReason } from '@openlinker/core/order-lifecycle';

/** The four v1 condition fields (spec §5.5 divergence 2). */
export const AutomationConditionFieldValues = [
  'sourceConnection',
  'orderCountry',
  'orderTotalGross',
  'holdReason',
] as const;

export type AutomationConditionField = (typeof AutomationConditionFieldValues)[number];

/** Comparison operators an amount condition may use (never inferred). */
export const AutomationAmountComparisonOpValues = ['gte', 'lt'] as const;
export type AutomationAmountComparisonOp = (typeof AutomationAmountComparisonOpValues)[number];

/**
 * One condition inside a rule's `conditions` array.
 *
 * `holdReason` is offered only for T1/T2/T3 (spec §5.5) — a presentation and
 * legality concern (#2359/#2365), not a storage one, so the shape is uniform
 * here.
 */
export type AutomationCondition =
  | { readonly field: 'sourceConnection'; readonly op: 'eq'; readonly value: string }
  | { readonly field: 'orderCountry'; readonly op: 'eq'; readonly value: string }
  | {
      readonly field: 'orderTotalGross';
      readonly op: AutomationAmountComparisonOp;
      readonly amount: string;
      readonly currency: string;
    }
  | { readonly field: 'holdReason'; readonly op: 'eq'; readonly value: HoldReason };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-negative decimal with at most two fractional digits, as a string. */
const DECIMAL_AMOUNT = /^\d+(\.\d{1,2})?$/;

/** ISO-4217 alpha-3, uppercase. Membership is not checked — that is a currency concern. */
const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * Narrow an untrusted value (a JSONB column read back from the repository) to
 * one well-formed `AutomationCondition`.
 *
 * Returns `false` on any shape mismatch and never throws: a malformed persisted
 * condition must be treated as "never matches" rather than crashing every read
 * of the rule that carries it.
 */
export function isAutomationCondition(value: unknown): value is AutomationCondition {
  if (!isRecord(value)) return false;
  const { field, op } = value;

  if (field === 'sourceConnection' || field === 'orderCountry') {
    return op === 'eq' && typeof value.value === 'string' && value.value.length > 0;
  }
  if (field === 'orderTotalGross') {
    return (
      (AutomationAmountComparisonOpValues as readonly string[]).includes(op as string) &&
      typeof value.amount === 'string' &&
      DECIMAL_AMOUNT.test(value.amount) &&
      typeof value.currency === 'string' &&
      CURRENCY_CODE.test(value.currency)
    );
  }
  if (field === 'holdReason') {
    return op === 'eq' && isHoldReason(value.value);
  }
  return false;
}
