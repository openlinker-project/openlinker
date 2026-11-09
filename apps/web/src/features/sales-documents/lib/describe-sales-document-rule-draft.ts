/**
 * Describe a rule draft back to the operator (#3189)
 *
 * The composer's readback: one sentence stating what the rule the operator is
 * about to save actually says. Pure and presentation-only, like its
 * per-condition sibling.
 *
 * It exists because the composer collects a rule across three sections - the
 * conditions, the destination, the effective window - and nothing until now
 * showed the whole thing in one place. An operator could therefore save a rule
 * whose currency they never set, or whose window opens tomorrow, and find out
 * only when orders started falling through to the country default.
 *
 * **It never fills a gap in.** An unset currency reads `(no currency)`, an
 * unset amount `?`, an unchosen connection `(no integration selected)`. A
 * readback that quietly supplied a plausible default would be worse than none,
 * because the operator would believe they had chosen it.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { SalesDocumentConditionInput } from '../api/sales-document-rules.types';
import type { SalesDocumentKind } from '../api/sales-documents.types';
import { describeSalesDocumentCondition } from './describe-sales-document-condition';
import { getBcp47Locale, getLocale, getMessages, interpolate } from '../../../shared/i18n';

export interface SalesDocumentRuleDraftDescription {
  readonly conditions: readonly SalesDocumentConditionInput[];
  readonly documentKind: SalesDocumentKind;
  /** The chosen connection's display name; `null` when none is chosen yet. */
  readonly connectionName: string | null;
  /** ISO `YYYY-MM-DD`. */
  readonly effectiveFrom: string;
  /** ISO `YYYY-MM-DD`, or `''` for an open-ended rule. */
  readonly effectiveTo: string;
}

export function describeSalesDocumentRuleDraft(
  draft: SalesDocumentRuleDraftDescription,
): string {
  const copy = getMessages('sales-documents').ruleDraft;

  // An unrecognised kind prints the raw value rather than being dropped: the
  // union is open-world (ADR-041 decision 10), and silently omitting the
  // document from the sentence would make the readback claim less than the
  // rule does.
  const kind =
    draft.documentKind === 'invoice'
      ? copy.kind.invoice
      : draft.documentKind === 'fiscal-receipt'
        ? copy.kind.receipt
        : interpolate(copy.kind.other, { kind: draft.documentKind });
  const where = draft.connectionName ?? copy.noConnection;
  const conditions = new Intl.ListFormat(getBcp47Locale(getLocale()), { type: 'conjunction' }).format(
    draft.conditions.map(describeSalesDocumentCondition),
  );
  const open = draft.effectiveTo === '';
  const template =
    draft.conditions.length === 0
      ? open
        ? copy.everyOrderOpen
        : copy.everyOrderBetween
      : open
        ? copy.conditionsOpen
        : copy.conditionsBetween;

  return interpolate(template, {
    conditions,
    kind,
    where,
    from: draft.effectiveFrom,
    to: draft.effectiveTo,
  });
}
