/**
 * `computeCorrectionProposalBreakdown` / `lineCredit` unit tests (#3090).
 */
import { describe, expect, it } from 'vitest';
import { computeCorrectionProposalBreakdown, lineCredit } from './correction-proposal-breakdown';
import type { ReturnCorrectionProposalLine } from '../api/returns.types';

function line(
  overrides: Partial<ReturnCorrectionProposalLine> = {},
): ReturnCorrectionProposalLine {
  return {
    returnLineId: 'line-1',
    lineIndex: 0,
    name: 'Widget',
    sku: 'SKU-1',
    quantityDisposed: 1,
    status: 'matched',
    candidates: [
      { originalLineNumber: 1, name: 'Widget', quantity: 2, unitPriceGross: 10, taxRate: '23' },
    ],
    selectedOriginalLineNumber: 1,
    newQuantity: 1,
    noMatchReason: null,
    noMatchExplanation: null,
    candidatesPriceOrRateDiffer: false,
    ...overrides,
  };
}

describe('lineCredit', () => {
  it('should credit the delta between invoiced and after-correction quantity', () => {
    expect(lineCredit(line())).toBe(10);
  });

  it('should credit nothing for an ambiguous line — nothing is selected to price against', () => {
    expect(lineCredit(line({ status: 'ambiguous', selectedOriginalLineNumber: null }))).toBe(0);
  });

  it('should credit nothing for a no-match line', () => {
    expect(lineCredit(line({ status: 'no-match', selectedOriginalLineNumber: null }))).toBe(0);
  });

  it('should credit nothing when the resolved quantity is not yet known', () => {
    expect(lineCredit(line({ newQuantity: null }))).toBe(0);
  });

  it('should credit nothing when the full invoiced quantity survives the return', () => {
    expect(lineCredit(line({ newQuantity: 2 }))).toBe(0);
  });

  it('should credit nothing for a matched line whose selected candidate no longer resolves', () => {
    // selectedOriginalLineNumber names a position absent from `candidates` —
    // reported as matched, but unpriceable.
    expect(lineCredit(line({ selectedOriginalLineNumber: 99 }))).toBe(0);
  });

  it('should clamp at 0 rather than credit a negative amount (review finding on #3376)', () => {
    // newQuantity (5) exceeds the selected candidate's own quantity (2) — the
    // two are resolved separately by the matcher, so a mismatch between them
    // must not silently reduce the headline via a negative credit.
    expect(lineCredit(line({ newQuantity: 5 }))).toBe(0);
  });
});

describe('computeCorrectionProposalBreakdown', () => {
  it('should sum credit across every matched line and count each status once', () => {
    const result = computeCorrectionProposalBreakdown([
      line(),
      line({ returnLineId: 'l2', status: 'ambiguous', selectedOriginalLineNumber: null }),
      line({ returnLineId: 'l3', status: 'no-match', selectedOriginalLineNumber: null }),
    ]);

    expect(result).toEqual({
      totalCredit: 10,
      automaticCount: 1,
      needsPickCount: 1,
      cantCreditCount: 1,
    });
  });

  it('should report an all-zero breakdown for an empty proposal', () => {
    expect(computeCorrectionProposalBreakdown([])).toEqual({
      totalCredit: 0,
      automaticCount: 0,
      needsPickCount: 0,
      cantCreditCount: 0,
    });
  });

  it('should count a no-match/ambiguous-invoice-line residual as needsPick, not cantCredit (#3312)', () => {
    // status: 'ambiguous' is retired — the matcher reports the same
    // condition as `no-match` + this reason. It is still the operator's
    // pick to make, never a closed exclusion.
    const result = computeCorrectionProposalBreakdown([
      line({
        returnLineId: 'l2',
        status: 'no-match',
        selectedOriginalLineNumber: null,
        noMatchReason: 'ambiguous-invoice-line',
      }),
    ]);

    expect(result.needsPickCount).toBe(1);
    expect(result.cantCreditCount).toBe(0);
  });

  it('should count a matched-but-unpriced line as cantCredit, never automatic (review finding on #3376)', () => {
    // `newQuantity: null` on a `matched` line is a real shape the type
    // permits — reported matched, but the server has not priced it yet.
    // Counting it as `automatic` while it contributes 0 to `totalCredit`
    // would let the two numbers on the panel disagree.
    const result = computeCorrectionProposalBreakdown([
      line({ newQuantity: null }),
    ]);

    expect(result).toEqual({
      totalCredit: 0,
      automaticCount: 0,
      needsPickCount: 0,
      cantCreditCount: 1,
    });
  });

  it('should keep automaticCount and totalCredit describing the same set of lines', () => {
    // One genuinely priceable matched line, one matched-but-unpriced line.
    // automaticCount must equal the number of lines that actually fed
    // totalCredit, not the number of lines the server merely called
    // "matched".
    const result = computeCorrectionProposalBreakdown([
      line({ returnLineId: 'priced' }),
      line({ returnLineId: 'unpriced', newQuantity: null }),
    ]);

    expect(result.automaticCount).toBe(1);
    expect(result.totalCredit).toBe(10);
    expect(result.cantCreditCount).toBe(1);
  });
});
