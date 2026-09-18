/**
 * Overlap copy (#3190)
 *
 * One sentence per verdict, composed here so the composer renders and never
 * decides. Country-agnostic: a rival is named by the operator's own rule text,
 * never by a hardcoded market.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { SalesDocumentConditionInput } from '../api/sales-document-rules.types';
import { describeSalesDocumentCondition } from './describe-sales-document-condition';

/** How a rival rule reads back, for a sentence that has to name it. */
export interface SalesDocumentOverlapRival {
  readonly ruleId: string;
  readonly conditions: readonly SalesDocumentConditionInput[];
  readonly documentKind: string;
}

function describeRival(rival: SalesDocumentOverlapRival | undefined, ruleId: string): string {
  if (rival === undefined) return `rule ${ruleId}`;
  const conditions = rival.conditions.map(describeSalesDocumentCondition).join(' and ');
  return conditions === '' ? `rule ${ruleId}` : `"${conditions}"`;
}

/**
 * The consequence, stated once however many rivals there are, because it is
 * the part an operator cannot infer: two matching rules do not pick a winner,
 * they HOLD the order.
 */
export const SALES_DOCUMENT_OVERLAP_CONSEQUENCE =
  'Two matching rules hold the order instead of one winning. Narrow one of them.';

/**
 * The refusal, for ONE rival (#3190 review, replacing a joined-sentence
 * variant that named every colliding rival in one line).
 *
 * Per rival rather than one joined sentence, because the composer renders a
 * "show that rule" affordance beside each: a sentence naming three rivals next
 * to a button that opened only the first was a claim the control could not
 * honour.
 */
export function describeSalesDocumentOverlapConflictRival(
  rival: SalesDocumentOverlapRival | undefined,
  ruleId: string,
): string {
  return `${describeRival(rival, ruleId)} can match the same order as this one.`;
}

/**
 * Keyed by the CORE vocabulary's own reason values, and deliberately NOT held
 * to one by a `check-*-mirror.mjs` the way `SalesDocumentGateBlockReason` is
 * (#3190 review). The drift this would guard against is fail-SOFT in both
 * directions and asserted as such by this module's spec: a reason with no
 * entry here still names the rival and simply stops short of explaining why,
 * and an entry with no reason is unreachable copy. A mirror script buys a
 * build failure for a condition whose worst outcome is a shorter true
 * sentence - unlike the gate-reason mirror, where a missing entry renders a
 * raw enum value at an operator.
 */
const DISJOINT_REASON_COPY: Record<string, string> = {
  currency: 'their currencies differ, and an amount is compared rather than converted',
  'amount-range': 'no order total satisfies both',
  'buyer-tax-id': 'one wants a customer with a tax ID and the other a customer without one',
  'order-country': 'they are scoped to different delivery countries',
  'effective-window': 'their effective periods never coincide',
};

/** The positive statement: this rule provably cannot collide with that one. */
export function describeSalesDocumentOverlapClear(
  reason: string,
  rival: SalesDocumentOverlapRival | undefined,
  ruleId: string,
): string {
  // An unrecognised reason is not silently dropped: the sentence still names
  // the rival and simply stops short of explaining why, which is honest.
  const why = DISJOINT_REASON_COPY[reason];
  const who = describeRival(rival, ruleId);
  return why === undefined
    ? `This rule cannot match the same order as ${who}.`
    : `This rule cannot match the same order as ${who} - ${why}.`;
}

const UNDECIDED_REASON_COPY: Record<string, string> = {
  'unreadable-condition':
    'it carries a condition this version does not understand. Open it and check what it says.',
  'multi-currency-rule':
    'one of the two bounds the total in more than one currency, which matches no order at all.',
};

/**
 * The third outcome. Never phrased as reassurance: the operator is told the
 * check declined, not that the rule is safe.
 */
export function describeSalesDocumentOverlapUndecided(
  reason: string,
  rival: SalesDocumentOverlapRival | undefined,
  ruleId: string,
): string {
  const why = UNDECIDED_REASON_COPY[reason] ?? 'this version could not compare the two.';
  return `We could not tell whether this rule collides with ${describeRival(rival, ruleId)} - ${why}`;
}
