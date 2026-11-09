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
import { getBcp47Locale, getLocale, getMessages, interpolate } from '../../../shared/i18n';

/** How a rival rule reads back, for a sentence that has to name it. */
export interface SalesDocumentOverlapRival {
  readonly ruleId: string;
  readonly conditions: readonly SalesDocumentConditionInput[];
  readonly documentKind: string;
}

function describeRival(rival: SalesDocumentOverlapRival | undefined, ruleId: string): string {
  const copy = getMessages('sales-documents').overlap;
  if (rival === undefined) return interpolate(copy.ruleById, { ruleId });
  const conditions = new Intl.ListFormat(getBcp47Locale(getLocale()), { type: 'conjunction' }).format(
    rival.conditions.map(describeSalesDocumentCondition),
  );
  return conditions === ''
    ? interpolate(copy.ruleById, { ruleId })
    : interpolate(copy.ruleByConditions, { conditions });
}

/**
 * The consequence, stated once however many rivals there are, because it is
 * the part an operator cannot infer: two matching rules do not pick a winner,
 * they HOLD the order. Read at call time so a language switch reaches it.
 */
export function describeSalesDocumentOverlapConsequence(): string {
  return getMessages('sales-documents').overlap.consequence;
}

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
  return interpolate(getMessages('sales-documents').overlap.conflictRival, {
    rule: describeRival(rival, ruleId),
  });
}

/**
 * Keyed by the CORE vocabulary's own reason values, and deliberately NOT held
 * to one by a `check-*-mirror.mjs` (#3190 review). A reason with no entry
 * still names the rival and simply stops short of explaining why.
 */
const DISJOINT_REASON_KEYS = {
  currency: 'currency',
  'amount-range': 'amountRange',
  'buyer-tax-id': 'buyerTaxId',
  'order-country': 'orderCountry',
  'effective-window': 'effectiveWindow',
} as const;

/** The positive statement: this rule provably cannot collide with that one. */
export function describeSalesDocumentOverlapClear(
  reason: string,
  rival: SalesDocumentOverlapRival | undefined,
  ruleId: string,
): string {
  const copy = getMessages('sales-documents').overlap.clear;
  const key = (DISJOINT_REASON_KEYS as Record<string, keyof typeof copy | undefined>)[reason];
  return interpolate(key === undefined ? copy.generic : copy[key], {
    rule: describeRival(rival, ruleId),
  });
}

const UNDECIDED_REASON_KEYS = {
  'unreadable-condition': 'unreadableCondition',
  'multi-currency-rule': 'multiCurrencyRule',
} as const;

/**
 * The third outcome. Never phrased as reassurance: the operator is told the
 * check declined, not that the rule is safe.
 */
export function describeSalesDocumentOverlapUndecided(
  reason: string,
  rival: SalesDocumentOverlapRival | undefined,
  ruleId: string,
): string {
  const copy = getMessages('sales-documents').overlap.undecided;
  const key = (UNDECIDED_REASON_KEYS as Record<string, keyof typeof copy | undefined>)[reason];
  return interpolate(key === undefined ? copy.generic : copy[key], {
    rule: describeRival(rival, ruleId),
  });
}
