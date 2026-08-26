import { describe, expect, it } from 'vitest';
import {
  SalesDocumentGateBlockReasonValues,
  SalesDocumentUnresolvedReasonValues,
} from '../../orders';
import {
  SALES_DOCUMENT_GATE_REASON_COPY,
  SALES_DOCUMENT_UNRESOLVED_REASON_COPY,
  resolveSalesDocumentReasonCopy,
} from './sales-document-reason-copy';

describe('sales-document reason copy', () => {
  it('should carry copy for every gate reason when the union is enumerated', () => {
    for (const reason of SalesDocumentGateBlockReasonValues) {
      const copy = SALES_DOCUMENT_GATE_REASON_COPY[reason];
      expect(copy.short.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
    }
  });

  it('should carry copy for every routing reason when the union is enumerated', () => {
    for (const reason of SalesDocumentUnresolvedReasonValues) {
      const copy = SALES_DOCUMENT_UNRESOLVED_REASON_COPY[reason];
      expect(copy.short.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
    }
  });

  // The bound is the widest label the mockup uses, where a reason label sits in
  // the document popover rather than in a status pill. The style guide's tighter
  // ~17-character pill budget applies to the transitional `/orders` badge that
  // still renders these, which the redesigned document cell replaces.
  it('should keep every short label to a label, not a sentence', () => {
    const shorts = [
      ...Object.values(SALES_DOCUMENT_GATE_REASON_COPY),
      ...Object.values(SALES_DOCUMENT_UNRESOLVED_REASON_COPY),
    ].map((copy) => copy.short);

    for (const short of shorts) {
      expect(short.length).toBeLessThanOrEqual(26);
      expect(short.endsWith('.')).toBe(false);
    }
  });

  it('should render trigger-model-manual in a neutral tone that keeps its action', () => {
    const copy = resolveSalesDocumentReasonCopy('trigger-model-manual');
    expect(copy?.tone).toBe('neutral');
    expect(copy?.keepsAction).toBe(true);
  });

  it('should prefer the paired routing reason when the gate recorded the bridge value', () => {
    const copy = resolveSalesDocumentReasonCopy(
      'unresolved-routing',
      'conflicting-rules-equal-priority'
    );
    expect(copy?.short).toBe(
      SALES_DOCUMENT_UNRESOLVED_REASON_COPY['conflicting-rules-equal-priority'].short
    );
    expect(copy?.fromUnresolvedReason).toBe(true);
    // Tone and action stay the gate's: the routing reason says what happened,
    // the gate says how serious it is and whether an action remains.
    expect(copy?.tone).toBe('error');
    expect(copy?.keepsAction).toBe(false);
  });

  it('should fall back to the generic routing copy when no routing reason travelled along', () => {
    const copy = resolveSalesDocumentReasonCopy('unresolved-routing', null);
    expect(copy?.short).toBe(SALES_DOCUMENT_GATE_REASON_COPY['unresolved-routing'].short);
    expect(copy?.fromUnresolvedReason).toBe(false);
  });

  it('should return null when no reason is persisted', () => {
    expect(resolveSalesDocumentReasonCopy(null)).toBeNull();
    expect(resolveSalesDocumentReasonCopy(undefined)).toBeNull();
  });

  it('should return null for a reason this build does not recognise', () => {
    // A newer backend value: rendering nothing beats rendering an unlabelled badge.
    expect(
      resolveSalesDocumentReasonCopy(
        'reason-from-a-newer-backend' as (typeof SalesDocumentGateBlockReasonValues)[number]
      )
    ).toBeNull();
  });

  it('should ignore an unrecognised routing reason and keep the gate copy', () => {
    const copy = resolveSalesDocumentReasonCopy(
      'unresolved-routing',
      'routing-reason-from-a-newer-backend' as (typeof SalesDocumentUnresolvedReasonValues)[number]
    );
    expect(copy?.short).toBe(SALES_DOCUMENT_GATE_REASON_COPY['unresolved-routing'].short);
  });
});
