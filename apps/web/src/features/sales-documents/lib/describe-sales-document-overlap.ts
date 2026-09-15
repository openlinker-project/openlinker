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
 * The refusal. States the consequence rather than only the fact, because the
 * consequence is the part an operator cannot infer: two matching rules do not
 * pick a winner, they HOLD the order.
 */
export function describeSalesDocumentOverlapConflict(
  ruleIds: readonly string[],
  rivals: readonly SalesDocumentOverlapRival[],
): string {
  const named = ruleIds
    .map((id) => describeRival(rivals.find((r) => r.ruleId === id), id))
    .join(', ');
  return (
    `${named} can match the same order as this one. ` +
    'Two matching rules hold the order instead of one winning. Narrow one of them.'
  );
}

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
