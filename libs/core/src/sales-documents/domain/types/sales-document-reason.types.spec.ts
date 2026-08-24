/**
 * Sales-Document Reason Types — unit spec (#2100)
 *
 * Pins the two vocabularies to ADR-041 decision 11 verbatim. These arrays are a
 * published contract other layers key on (a persisted column, an API enum, a
 * hand-mirrored FE union guarded by `scripts/check-sales-document-reason-mirror.mjs`),
 * so a silent edit here would ripple outward — the assertions are exact, not
 * "contains".
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import {
  SalesDocumentAttentionReasonValues,
  SalesDocumentGateBlockReasonValues,
  SalesDocumentUnresolvedReasonValues,
  isSalesDocumentGateBlockReason,
  isSalesDocumentUnresolvedReason,
} from './sales-document-reason.types';

describe('sales-document reason vocabularies (ADR-041 decision 11)', () => {
  it('should declare the unresolved reasons exactly as the ADR does, plus the #2170 rule-engine additions', () => {
    expect(SalesDocumentUnresolvedReasonValues).toEqual([
      'no-matching-rule',
      'conflicting-rules-equal-priority',
      'ambiguous-connection-no-primary',
      'unsupported-document-kind-on-connection',
      'net-priced-order',
      'no-configuration-for-country',
      'threshold-currency-mismatch',
    ]);
  });

  it('should declare the gate block reasons exactly as the ADR does', () => {
    expect(SalesDocumentGateBlockReasonValues).toEqual([
      'unresolved-routing',
      'missing-required-tax-id',
      'missing-tax-rate',
      'tax-rate-conflict',
      'trigger-model-manual',
      'trigger-model-batched',
    ]);
  });

  it("should keep the two unions disjoint apart from nothing — 'unresolved-routing' bridges by reference, not by shared membership", () => {
    // The bridge is a DISTINCT gate value that POINTS AT an unresolved reason; it
    // is deliberately not the same literal appearing in both sets. If a future
    // edit made the sets overlap, the "which question does this answer?"
    // distinction ADR-041 §107 protects would be decidable only by string match.
    const overlap = SalesDocumentGateBlockReasonValues.filter((value) =>
      (SalesDocumentUnresolvedReasonValues as readonly string[]).includes(value),
    );
    expect(overlap).toEqual([]);
  });

  it('should treat every reason EXCEPT manual as attention-worthy', () => {
    // `trigger-model-manual` is `parseTriggerModel`'s default, so on a manual
    // install every uninvoiced order carries it. Aggregating that would put a red
    // "Invoicing blocked 4,312" on a healthy install and train the operator to
    // ignore the number. Derived, so a NEW reason is attention-worthy by default.
    expect(SalesDocumentAttentionReasonValues).toEqual([
      'unresolved-routing',
      'missing-required-tax-id',
      'missing-tax-rate',
      'tax-rate-conflict',
      'trigger-model-batched',
    ]);
    expect(SalesDocumentAttentionReasonValues).not.toContain('trigger-model-manual');
  });

  it('should narrow only the declared unresolved reasons', () => {
    expect(isSalesDocumentUnresolvedReason('ambiguous-connection-no-primary')).toBe(true);
    expect(isSalesDocumentUnresolvedReason('no-matching-rule')).toBe(true);
    // A gate reason is NOT an unresolved reason — the repository relies on this
    // guard to coerce an unrecognised stored value to `null` on read.
    expect(isSalesDocumentUnresolvedReason('trigger-model-manual')).toBe(false);
    expect(isSalesDocumentUnresolvedReason('')).toBe(false);
    expect(isSalesDocumentUnresolvedReason(null)).toBe(false);
    expect(isSalesDocumentUnresolvedReason(undefined)).toBe(false);
    expect(isSalesDocumentUnresolvedReason(7)).toBe(false);
  });

  it('should narrow only the declared gate reasons', () => {
    expect(isSalesDocumentGateBlockReason('trigger-model-manual')).toBe(true);
    expect(isSalesDocumentGateBlockReason('unresolved-routing')).toBe(true);
    // A routing reason is NOT a gate reason — the guard must not accept one.
    expect(isSalesDocumentGateBlockReason('no-matching-rule')).toBe(false);
    expect(isSalesDocumentGateBlockReason('')).toBe(false);
    expect(isSalesDocumentGateBlockReason(null)).toBe(false);
    expect(isSalesDocumentGateBlockReason(undefined)).toBe(false);
    expect(isSalesDocumentGateBlockReason(42)).toBe(false);
  });
});
