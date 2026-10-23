/**
 * Readback tests (#3189)
 *
 * The mockup names `rule-readback` the composer's primary assertion target, so
 * the sentence is pinned here rather than only through the dialog: these cover
 * the states the dialog cannot easily be driven into (an unchosen connection,
 * an unrecognised document kind, a half-typed amount).
 */
import { describe, expect, it } from 'vitest';

import type { SalesDocumentKind } from '../api/sales-documents.types';
import {
  describeSalesDocumentRuleDraft,
  type SalesDocumentRuleDraftDescription,
} from './describe-sales-document-rule-draft';

const base: SalesDocumentRuleDraftDescription = {
  conditions: [
    { field: 'buyerHasTaxId', op: 'eq', boolValue: true },
    { field: 'orderTotalGross', op: 'lt', amount: '450.00', currency: 'PLN' },
  ],
  documentKind: 'fiscal-receipt',
  connectionName: 'Fiscal Provider Sandbox',
  effectiveFrom: '2026-09-10',
  effectiveTo: '',
};

describe('describeSalesDocumentRuleDraft (#3189)', () => {
  it('states every condition, the document, the destination and an open-ended window', () => {
    expect(describeSalesDocumentRuleDraft(base)).toBe(
      'an order where customer has a tax ID and total < 450.00 PLN gets a receipt ' +
        'through Fiscal Provider Sandbox, from 2026-09-10 onwards.',
    );
  });

  it('names both ends of a closed window', () => {
    expect(describeSalesDocumentRuleDraft({ ...base, effectiveTo: '2026-12-31' })).toContain(
      'between 2026-09-10 and 2026-12-31.',
    );
  });

  it('says an order with no conditions matches everything, rather than reading as empty', () => {
    expect(describeSalesDocumentRuleDraft({ ...base, conditions: [] })).toContain(
      'every order gets a receipt',
    );
  });

  // The readback must never fill a gap in: an operator who sees a plausible
  // value believes they chose it, and both of these are saveable states.
  it('marks an unchosen connection rather than omitting the destination', () => {
    expect(describeSalesDocumentRuleDraft({ ...base, connectionName: null })).toContain(
      'through (no integration selected)',
    );
  });

  it('marks a half-typed amount rather than inventing a figure', () => {
    const sentence = describeSalesDocumentRuleDraft({
      ...base,
      conditions: [{ field: 'orderTotalGross', op: 'gte' }],
    });
    expect(sentence).toContain('total ≥ ?');
    // Precise on purpose: the sentence carries an ISO date, so a bare digit
    // check would pass for the wrong reason. What must not appear is a FIGURE
    // in the amount slot.
    expect(sentence).not.toMatch(/total ≥ [\d.]/);
  });

  // ADR-041 decision 10 keeps the kind open-world, so a regime's own third kind
  // must still appear in the sentence rather than being silently dropped.
  it('prints an unrecognised document kind verbatim', () => {
    // The FE union is narrower than the wire on purpose - it names the two
    // kinds this build renders - so a regime's own third kind can only arrive
    // through the API and is reproduced here by a cast rather than by widening
    // the type. Dropping it from the sentence would make the readback claim
    // less than the rule does.
    const thirdKind = 'simplified-invoice' as unknown as SalesDocumentKind;
    expect(describeSalesDocumentRuleDraft({ ...base, documentKind: thirdKind })).toContain(
      'gets a simplified-invoice through',
    );
  });
});
