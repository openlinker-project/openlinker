/**
 * Return Correction Matching — table-driven spec (#2374)
 *
 * The issue calls this matrix "unusually heavy" for a reason: a correction wrong
 * by a price delta on a transmitted document is not retractable, so every arm of
 * the classification is pinned rather than sampled.
 *
 * @module libs/core/src/returns/domain/domain-services/__tests__
 */
import {
  classifyReturnCorrectionLines,
  describeCorrectionNoMatchReason,
  normalizeCorrectionLineName,
} from '../return-correction-matching.domain-service';
import type {
  CorrectionReturnLineInput,
  CorrectionSnapshotLine,
} from '../return-correction-matching.domain-service';
import { ReturnCorrectionNoMatchReasonValues } from '../../types/return-correction-proposal.types';

function line(overrides: Partial<CorrectionReturnLineInput> = {}): CorrectionReturnLineInput {
  return {
    returnLineId: 'line-1',
    lineIndex: 0,
    name: 'Widget',
    sku: 'W-1',
    quantityDisposed: 1,
    hasUnconfirmedDisposition: false,
    ...overrides,
  };
}

function snapshotLine(
  overrides: Partial<CorrectionSnapshotLine> = {}
): CorrectionSnapshotLine {
  return { name: 'Widget', quantity: 3, unitPriceGross: 123.45, taxRate: '23', ...overrides };
}

describe('classifyReturnCorrectionLines (#2374)', () => {
  describe('matched', () => {
    it('should select the only candidate and emit a quantity-only delta when exactly one line matches by name', () => {
      const [result] = classifyReturnCorrectionLines(
        [line({ quantityDisposed: 2 })],
        [snapshotLine({ name: 'Other' }), snapshotLine({ quantity: 5 })]
      );

      expect(result.status).toBe('matched');
      expect(result.selectedOriginalLineNumber).toBe(2);
      expect(result.newQuantity).toBe(3);
      expect(result.candidates).toHaveLength(1);
      expect(result.noMatchReason).toBeNull();
    });

    it('should emit a 1-based originalLineNumber so it feeds CorrectionLine directly', () => {
      const [result] = classifyReturnCorrectionLines([line()], [snapshotLine()]);

      expect(result.selectedOriginalLineNumber).toBe(1);
    });

    it('should allow a full return of the line, producing a zero post-correction quantity', () => {
      const [result] = classifyReturnCorrectionLines(
        [line({ quantityDisposed: 3 })],
        [snapshotLine({ quantity: 3 })]
      );

      expect(result.status).toBe('matched');
      expect(result.newQuantity).toBe(0);
    });

    it.each([
      ['leading and trailing whitespace', '  Widget  '],
      ['collapsed internal whitespace', 'Widget   Pro'],
      ['case differences', 'WIDGET'],
    ])('should match through %s', (_label, invoiceName) => {
      const returnName = invoiceName === 'Widget   Pro' ? 'Widget Pro' : 'Widget';
      const [result] = classifyReturnCorrectionLines(
        [line({ name: returnName })],
        [snapshotLine({ name: invoiceName })]
      );

      expect(result.status).toBe('matched');
    });

    it('should NOT diacritic-fold, so two genuinely distinct products never share a candidate set', () => {
      const [result] = classifyReturnCorrectionLines(
        [line({ name: 'Muslin' })],
        [snapshotLine({ name: 'Muślin' })]
      );

      expect(result.status).toBe('no-match');
      expect(result.noMatchReason).toBe('no-line-by-name');
    });
  });

  describe('ambiguous — the whole point of the feature', () => {
    it('should list EVERY candidate and select none when one order repeats the same offer', () => {
      const [result] = classifyReturnCorrectionLines(
        [line()],
        [snapshotLine(), snapshotLine({ name: 'Other' }), snapshotLine()]
      );

      expect(result.status).toBe('ambiguous');
      expect(result.candidates.map((c) => c.originalLineNumber)).toEqual([1, 3]);
      expect(result.selectedOriginalLineNumber).toBeNull();
      expect(result.newQuantity).toBeNull();
    });

    it('should stay ambiguous even when every candidate would credit the same amount', () => {
      const [result] = classifyReturnCorrectionLines(
        [line()],
        [snapshotLine(), snapshotLine()]
      );

      // Reporting the coincidence is allowed; acting on it is not.
      expect(result.status).toBe('ambiguous');
      expect(result.candidatesPriceOrRateDiffer).toBe(false);
      expect(result.selectedOriginalLineNumber).toBeNull();
    });

    it('should report a price divergence between candidates', () => {
      const [result] = classifyReturnCorrectionLines(
        [line()],
        [snapshotLine(), snapshotLine({ unitPriceGross: 99 })]
      );

      expect(result.candidatesPriceOrRateDiffer).toBe(true);
    });

    it('should report a tax-rate divergence between candidates', () => {
      const [result] = classifyReturnCorrectionLines(
        [line()],
        [snapshotLine(), snapshotLine({ taxRate: '0' })]
      );

      expect(result.candidatesPriceOrRateDiffer).toBe(true);
    });

    it('should list three candidates when three identical lines exist', () => {
      const [result] = classifyReturnCorrectionLines(
        [line()],
        [snapshotLine(), snapshotLine(), snapshotLine()]
      );

      expect(result.candidates).toHaveLength(3);
    });
  });

  describe('no-match — every reason is a different operator action', () => {
    it('should report no-line-by-name when the document holds no line with that name', () => {
      const [result] = classifyReturnCorrectionLines([line()], [snapshotLine({ name: 'Other' })]);

      expect(result.status).toBe('no-match');
      expect(result.noMatchReason).toBe('no-line-by-name');
      expect(result.candidates).toEqual([]);
    });

    it.each([
      ['null', null],
      ['empty', ''],
      ['whitespace-only', '   '],
    ])('should report no-line-name for a %s return-line name', (_label, name) => {
      const [result] = classifyReturnCorrectionLines([line({ name })], [snapshotLine()]);

      expect(result.noMatchReason).toBe('no-line-name');
    });

    it('should report quantity-exceeds-invoiced rather than proposing a negative quantity', () => {
      const [result] = classifyReturnCorrectionLines(
        [line({ quantityDisposed: 4 })],
        [snapshotLine({ quantity: 3 })]
      );

      expect(result.status).toBe('no-match');
      expect(result.noMatchReason).toBe('quantity-exceeds-invoiced');
      expect(result.newQuantity).toBeNull();
    });

    it('should still surface the considered candidates when the quantity filter empties the set', () => {
      const [result] = classifyReturnCorrectionLines(
        [line({ quantityDisposed: 9 })],
        [snapshotLine({ quantity: 3 }), snapshotLine({ quantity: 4 })]
      );

      expect(result.candidates.map((c) => c.originalLineNumber)).toEqual([1, 2]);
    });

    it('should keep only the feasible candidates when SOME exceed the returned quantity', () => {
      const [result] = classifyReturnCorrectionLines(
        [line({ quantityDisposed: 4 })],
        [snapshotLine({ quantity: 3 }), snapshotLine({ quantity: 10 })]
      );

      expect(result.status).toBe('matched');
      expect(result.selectedOriginalLineNumber).toBe(2);
    });

    it('should report disposition-not-confirmed BEFORE any name lookup, so the operator is told to attest', () => {
      const [result] = classifyReturnCorrectionLines(
        // Name matches perfectly; the disposal is what is unconfirmed.
        [line({ hasUnconfirmedDisposition: true })],
        [snapshotLine()]
      );

      expect(result.status).toBe('no-match');
      expect(result.noMatchReason).toBe('disposition-not-confirmed');
      expect(result.candidates).toEqual([]);
    });
  });

  describe('shape guarantees', () => {
    it('should return one entry per input line, in input order', () => {
      const results = classifyReturnCorrectionLines(
        [
          line({ returnLineId: 'a', lineIndex: 0 }),
          line({ returnLineId: 'b', lineIndex: 1, name: 'Other' }),
          line({ returnLineId: 'c', lineIndex: 2, name: null }),
        ],
        [snapshotLine()]
      );

      expect(results.map((r) => r.returnLineId)).toEqual(['a', 'b', 'c']);
    });

    it('should carry the unit through only when the snapshot declared one', () => {
      const [withUnit] = classifyReturnCorrectionLines(
        [line()],
        [snapshotLine({ unit: 'szt' })]
      );
      const [withoutUnit] = classifyReturnCorrectionLines([line()], [snapshotLine()]);

      expect(withUnit.candidates[0].unit).toBe('szt');
      expect(withoutUnit.candidates[0]).not.toHaveProperty('unit');
    });

    it('should classify every line no-match against an empty snapshot', () => {
      const results = classifyReturnCorrectionLines([line()], []);

      expect(results[0].noMatchReason).toBe('no-line-by-name');
    });

    it('should never mutate its inputs', () => {
      const lines = [line()];
      const snapshot = [snapshotLine()];
      const snapshotBefore = JSON.stringify(snapshot);

      classifyReturnCorrectionLines(lines, snapshot);

      expect(JSON.stringify(snapshot)).toBe(snapshotBefore);
      expect(lines[0].quantityDisposed).toBe(1);
    });

    it('should compute no money — the delta is quantity only', () => {
      const [result] = classifyReturnCorrectionLines(
        [line({ quantityDisposed: 1 })],
        [snapshotLine({ quantity: 2, unitPriceGross: 10.01 })]
      );

      expect(Object.keys(result)).not.toContain('newUnitPriceGross');
      expect(result.newQuantity).toBe(1);
    });
  });
});

describe('normalizeCorrectionLineName (#2374)', () => {
  it('should trim, collapse internal whitespace and case-fold', () => {
    expect(normalizeCorrectionLineName('  Blue   WIDGET ')).toBe('blue widget');
  });

  it('should preserve diacritics', () => {
    expect(normalizeCorrectionLineName('Muślin')).toBe('muślin');
  });
});

describe('describeCorrectionNoMatchReason (#2374)', () => {
  it.each(ReturnCorrectionNoMatchReasonValues)(
    'should describe %s in operator-facing, country-agnostic prose',
    (reason) => {
      const copy = describeCorrectionNoMatchReason(reason);

      expect(copy.length).toBeGreaterThan(0);
      // ADR-026: no regime/provider/country vocabulary in libs/core.
      expect(copy.toLowerCase()).not.toMatch(/ksef|nip|faktura|vat|kor/);
    }
  );
});
