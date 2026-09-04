/**
 * Scanner gesture rules (#2416, `W3b-3`, spec § 2.3)
 *
 * Each test names the clause it guards, because the thresholds are the whole of
 * "is this a scan" and a suite that only exercised the happy path would go green
 * against a rule that accepted everything.
 */
import { describe, expect, it } from 'vitest';

import {
  isEditableTarget,
  isScannerBurst,
  isScannerContentKey,
  isScannerTerminator,
  pruneStaleKeystrokes,
  readScannerValue,
  SCANNER_MAX_BURST_MS,
  SCANNER_MAX_KEY_GAP_MS,
  SCANNER_MAX_LENGTH,
  SCANNER_MIN_LENGTH,
  type ScannerKeystroke,
} from './scanner-gesture';

/** A burst of `length` characters spaced `gap` ms apart. */
function burst(length: number, gap: number, start = 1_000): ScannerKeystroke[] {
  return Array.from({ length }, (_, index) => ({
    char: String(index % 10),
    at: start + index * gap,
  }));
}

describe('isScannerBurst (#2416)', () => {
  it('should accept a fast burst of a plausible barcode length', () => {
    expect(isScannerBurst(burst(12, 10))).toBe(true);
  });

  it('should reject typing, which is slower than the gap threshold', () => {
    // A single gap over the threshold is enough — that is the clause.
    const typed = burst(12, SCANNER_MAX_KEY_GAP_MS + 5);
    expect(isScannerBurst(typed)).toBe(false);
  });

  it('should reject a burst whose ONE gap exceeds the threshold', () => {
    const keys = burst(12, 10);
    keys[6] = { ...keys[6], at: keys[5].at + SCANNER_MAX_KEY_GAP_MS + 1 };
    for (let i = 7; i < keys.length; i += 1) {
      keys[i] = { ...keys[i], at: keys[i - 1].at + 10 };
    }
    expect(isScannerBurst(keys)).toBe(false);
  });

  it('should reject a burst shorter than a barcode', () => {
    expect(isScannerBurst(burst(SCANNER_MIN_LENGTH - 1, 5))).toBe(false);
    expect(isScannerBurst(burst(SCANNER_MIN_LENGTH, 5))).toBe(true);
  });

  it('should reject a burst longer than the hard bound', () => {
    expect(isScannerBurst(burst(SCANNER_MAX_LENGTH + 1, 1))).toBe(false);
  });

  it('should reject a chain of sub-threshold keys that outruns the burst bound', () => {
    // The gap clause alone never trips on this: every gap is legal and the
    // burst simply never ends. This is the second bound, and without it the
    // buffer grows for as long as the stream does.
    const gap = SCANNER_MAX_KEY_GAP_MS - 1;
    const length = Math.ceil(SCANNER_MAX_BURST_MS / gap) + 2;
    const keys = burst(Math.min(length, SCANNER_MAX_LENGTH), gap);
    expect(keys[keys.length - 1].at - keys[0].at).toBeGreaterThan(SCANNER_MAX_BURST_MS);
    expect(isScannerBurst(keys)).toBe(false);
  });
});

describe('isScannerTerminator (#2416)', () => {
  it('should accept an Enter that arrived with the burst', () => {
    const keys = burst(8, 10);
    expect(isScannerTerminator(keys, keys[keys.length - 1].at + 5)).toBe(true);
  });

  it('should reject an Enter a person pressed after a pause', () => {
    const keys = burst(8, 10);
    expect(
      isScannerTerminator(keys, keys[keys.length - 1].at + SCANNER_MAX_KEY_GAP_MS + 1)
    ).toBe(false);
  });

  it('should reject an Enter with no buffer at all', () => {
    expect(isScannerTerminator([], 1_000)).toBe(false);
  });
});

describe('isScannerContentKey (#2416)', () => {
  it('should accept a single printable character with no modifier', () => {
    expect(
      isScannerContentKey({ key: '7', ctrlKey: false, metaKey: false, altKey: false })
    ).toBe(true);
  });

  it('should ignore a modified key, which is a person reaching for a shortcut', () => {
    expect(isScannerContentKey({ key: 'a', ctrlKey: true, metaKey: false, altKey: false })).toBe(
      false
    );
    expect(isScannerContentKey({ key: 'a', ctrlKey: false, metaKey: true, altKey: false })).toBe(
      false
    );
  });

  it('should ignore a non-printable key rather than buffering its name', () => {
    for (const key of ['Shift', 'Tab', 'ArrowLeft', 'Escape']) {
      expect(isScannerContentKey({ key, ctrlKey: false, metaKey: false, altKey: false })).toBe(
        false
      );
    }
  });
});

describe('pruneStaleKeystrokes (#2416)', () => {
  it('should drop a fragment left by an abandoned burst so it cannot prefix a real scan', () => {
    const stale = burst(3, 5, 0);
    const kept = pruneStaleKeystrokes(stale, 10_000);
    expect(kept).toEqual([]);
  });

  it('should keep keys that still belong to the burst in progress', () => {
    const keys = burst(4, 5, 1_000);
    expect(pruneStaleKeystrokes(keys, keys[keys.length - 1].at + 5)).toHaveLength(4);
  });
});

describe('readScannerValue (#2416)', () => {
  it('should join the buffered characters in order', () => {
    expect(readScannerValue([{ char: 'A', at: 0 }, { char: 'B', at: 1 }])).toBe('AB');
  });
});

describe('isEditableTarget (#2416)', () => {
  it('should treat the search field as editable so its keystrokes are left alone', () => {
    const input = document.createElement('input');
    expect(isEditableTarget(input)).toBe(true);
  });

  it('should not treat an ordinary element as editable', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
