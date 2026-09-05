/**
 * Matching a scan to a line of this box (#2418, story E2)
 *
 * The rule that decides whether the browser refuses an item without asking the
 * server. Every case here is one a packer can create by holding the wrong thing
 * up to a scanner.
 */
import { describe, expect, it } from 'vitest';

import type { BenchParcel, BenchParcelLine } from '../api/bench-parcel.types';
import {
  lineScanCodes,
  matchScanToParcelLine,
  normaliseScanValue,
  outstandingScanCodes,
} from './parcel-scan-match';

function line(over: Partial<BenchParcelLine> = {}): BenchParcelLine {
  return {
    workLineId: 'wl-1',
    productVariantId: 'ol_variant_1',
    name: 'Ceramic mug, matte white, 350 ml',
    sku: 'MUG-WHT-350',
    ean: '5901234123457',
    gtin: null,
    requiredQuantity: 2,
    verifiedQuantity: 0,
    ...over,
  };
}

function parcel(lines: readonly BenchParcelLine[]): BenchParcel {
  return {
    workId: 'w-1',
    version: 1,
    orderReference: 'OL-4471',
    buyerName: 'Anna Nowak',
    parcelIndex: 1,
    parcelTotal: 2,
    refusal: null,
    holdReason: null,
    closedAt: null,
    packedByUserId: null,
    lines,
  };
}

describe('matchScanToParcelLine (#2418)', () => {
  it('should match a line by its EAN when the line still has room', () => {
    const target = line();
    const match = matchScanToParcelLine(parcel([target]), '5901234123457');

    expect(match.kind).toBe('matched');
    expect(match.kind === 'matched' && match.line.workLineId).toBe('wl-1');
  });

  it('should match by GTIN and by SKU as well as by EAN', () => {
    const target = line({ ean: null, gtin: '05901234123457', sku: 'MUG-WHT-350' });

    expect(matchScanToParcelLine(parcel([target]), '05901234123457').kind).toBe('matched');
    expect(matchScanToParcelLine(parcel([target]), 'mug-wht-350').kind).toBe('matched');
  });

  it('should tolerate a scanner emitting surrounding whitespace', () => {
    expect(matchScanToParcelLine(parcel([line()]), '  5901234123457 ').kind).toBe('matched');
  });

  it('should NOT equate codes differing only by a leading zero', () => {
    // Two different products in a catalogue carrying both. Quietly equating them
    // puts the wrong item in the box, which is the failure this module exists to
    // prevent — so a GTIN-14 must not match a GTIN-13 line.
    expect(matchScanToParcelLine(parcel([line()]), '05901234123457').kind).toBe('no-match');
  });

  it('should report no-match for an item that belongs to another box', () => {
    const match = matchScanToParcelLine(parcel([line()]), '4006381333931');
    expect(match.kind).toBe('no-match');
  });

  it('should never match a blank scan, so a line with no barcode is unreachable by scanning', () => {
    const barcodeless = line({ ean: null, gtin: null, sku: null });

    expect(matchScanToParcelLine(parcel([barcodeless]), '').kind).toBe('no-match');
    expect(matchScanToParcelLine(parcel([barcodeless]), '   ').kind).toBe('no-match');
    expect(lineScanCodes(barcodeless)).toEqual([]);
  });

  it('should report already-full when every line carrying the code is complete', () => {
    const full = line({ verifiedQuantity: 2, requiredQuantity: 2 });
    const match = matchScanToParcelLine(parcel([full]), '5901234123457');

    expect(match.kind).toBe('already-full');
    expect(match.kind === 'already-full' && match.line.requiredQuantity).toBe(2);
  });

  it('should prefer a line with room over a full one carrying the same code', () => {
    const full = line({ workLineId: 'wl-full', verifiedQuantity: 2 });
    const spare = line({ workLineId: 'wl-spare', verifiedQuantity: 0, requiredQuantity: 1 });

    const match = matchScanToParcelLine(parcel([full, spare]), '5901234123457');
    expect(match.kind === 'matched' && match.line.workLineId).toBe('wl-spare');
  });

  it('should match on every unit of a multi-unit line, and refuse only the one past it', () => {
    expect(matchScanToParcelLine(parcel([line({ verifiedQuantity: 0 })]), '5901234123457').kind).toBe(
      'matched'
    );
    expect(matchScanToParcelLine(parcel([line({ verifiedQuantity: 1 })]), '5901234123457').kind).toBe(
      'matched'
    );
    expect(matchScanToParcelLine(parcel([line({ verifiedQuantity: 2 })]), '5901234123457').kind).toBe(
      'already-full'
    );
  });
});

describe('outstandingScanCodes (#2418)', () => {
  it('should list only the codes of lines that still have room', () => {
    const done = line({ workLineId: 'wl-done', ean: '1111111111111', verifiedQuantity: 2 });
    const todo = line({ workLineId: 'wl-todo', ean: '2222222222222', sku: 'TWL-SND' });

    expect(outstandingScanCodes(parcel([done, todo]))).toEqual(['2222222222222', 'TWL-SND']);
  });

  it('should be empty for a box with nothing left to scan', () => {
    expect(outstandingScanCodes(parcel([line({ verifiedQuantity: 2 })]))).toEqual([]);
  });
});

describe('normaliseScanValue (#2418)', () => {
  it('should upper-case and strip whitespace without touching anything else', () => {
    expect(normaliseScanValue(' mug-wht 350 ')).toBe('MUG-WHT350');
    expect(normaliseScanValue('05901234123457')).toBe('05901234123457');
  });
});
