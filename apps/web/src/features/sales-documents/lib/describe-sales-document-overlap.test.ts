/**
 * Overlap copy tests (#3190)
 *
 * The sentences an operator acts on. The refusal must state the CONSEQUENCE
 * (two matching rules hold the order) rather than only the fact, and the
 * undecided case must never read as reassurance.
 */
import { describe, expect, it } from 'vitest';

import {
  SALES_DOCUMENT_OVERLAP_CONSEQUENCE,
  describeSalesDocumentOverlapClear,
  describeSalesDocumentOverlapConflictRival,
  describeSalesDocumentOverlapUndecided,
  type SalesDocumentOverlapRival,
} from './describe-sales-document-overlap';

const rival: SalesDocumentOverlapRival = {
  ruleId: 'rule-1',
  conditions: [
    { field: 'buyerHasTaxId', op: 'eq', boolValue: true },
    { field: 'orderTotalGross', op: 'lt', amount: '450.00', currency: 'PLN' },
  ],
  documentKind: 'fiscal-receipt',
};

describe('describeSalesDocumentOverlapConflictRival', () => {
  it('names the rival in the operator\'s own rule text', () => {
    const sentence = describeSalesDocumentOverlapConflictRival(rival, 'rule-1');

    expect(sentence).toContain('customer has a tax ID and total < 450.00 PLN');
  });

  it('falls back to the id when the rival is not among the loaded rules', () => {
    // The list read can legitimately be stale or still loading; a sentence
    // naming nothing at all would be worse than one naming an id.
    expect(describeSalesDocumentOverlapConflictRival(undefined, 'rule-9')).toContain('rule rule-9');
  });

  // The half an operator cannot infer: nothing wins, the order is held. Stated
  // once by the caller (the composer renders it beside every conflict list),
  // never per rival - which is why it is its own exported constant rather than
  // folded into the per-rival sentence above.
  it('the consequence names what an operator cannot infer', () => {
    expect(SALES_DOCUMENT_OVERLAP_CONSEQUENCE).toContain('hold the order instead of one winning');
  });
});

describe('describeSalesDocumentOverlapClear', () => {
  it('states the positive case with its reason', () => {
    const sentence = describeSalesDocumentOverlapClear('currency', rival, 'rule-1');

    expect(sentence).toContain('cannot match the same order');
    expect(sentence).toContain('compared rather than converted');
  });

  it('still names the rival for a reason this build does not recognise', () => {
    const sentence = describeSalesDocumentOverlapClear('something-new', rival, 'rule-1');

    expect(sentence).toContain('cannot match the same order');
    // Stops short of explaining why rather than inventing an explanation.
    expect(sentence).not.toContain(' - ');
  });
});

describe('describeSalesDocumentOverlapUndecided', () => {
  it('says the check declined, never that the rule is safe', () => {
    const sentence = describeSalesDocumentOverlapUndecided(
      'unreadable-condition',
      rival,
      'rule-1',
    );

    expect(sentence).toContain('could not tell');
    expect(sentence).not.toContain('cannot match');
  });

  it('has a fallback sentence for an unrecognised reason', () => {
    expect(describeSalesDocumentOverlapUndecided('brand-new', rival, 'rule-1')).toContain(
      'could not compare the two',
    );
  });
});
