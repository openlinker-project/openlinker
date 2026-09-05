/**
 * Bench copy (#2416, `W3b-3`, story B2)
 *
 * The readiness ban is a CORRECTNESS rule, not a wording preference: OpenLinker
 * cannot see a shelf, so copy implying the goods are waiting sends a packer to
 * fetch something that is not there, and after that happens twice the list is
 * not trusted again. Asserted here rather than left to review, because the
 * tempting words are exactly the natural ones.
 */
import { describe, expect, it } from 'vitest';

import { benchWorkCopy } from './bench-work.copy';

/** Every string in the copy tree, with the path that leads to it. */
function collect(node: unknown, path: string[] = []): { path: string; value: string }[] {
  if (typeof node === 'string') return [{ path: path.join('.'), value: node }];
  // A copy BUILDER is copy too — `row.summary` is the most-read line on the
  // surface, and skipping functions here would leave it outside the readiness
  // check that is this file's whole purpose.
  if (typeof node === 'function') {
    const built: unknown = (node as (parts: Record<string, number>) => unknown)({
      parcelIndex: 1,
      parcelTotal: 2,
      lineCount: 3,
      unitsToVerify: 4,
    });
    return typeof built === 'string' ? [{ path: path.join('.'), value: built }] : [];
  }
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) => collect(value, [...path, key]));
}

const STRINGS = collect(benchWorkCopy);

describe('bench work copy (#2416)', () => {
  it('should carry copy at all, so the assertions below are not vacuous', () => {
    expect(STRINGS.length).toBeGreaterThan(20);
  });

  it.each([
    // Each of these asserts that stock is somewhere it may not be.
    'picked',
    'gathered',
    'ready to pack',
    'ready for packing',
    'on the shelf waiting',
    'in stock and waiting',
  ])('should never claim readiness with %s', (banned) => {
    const offenders = STRINGS.filter((entry) => entry.value.toLowerCase().includes(banned));
    expect(offenders.map((entry) => entry.path)).toEqual([]);
  });

  it('should say what the surface CAN know — units to verify', () => {
    // The positive half. Without it the ban above could be satisfied by copy
    // that says nothing at all about the counts.
    expect(benchWorkCopy.footer.honesty.toLowerCase()).toContain('cannot see your shelves');
  });

  it('should name a remedy on the not-routed empty state (story B3)', () => {
    // B3: the second empty state must say what to do about it. Copy that only
    // described the state would leave a packer staring at a screen that will
    // never change with nothing to act on.
    expect(benchWorkCopy.emptyNotRouted.remedyBody.length).toBeGreaterThan(40);
    expect(benchWorkCopy.emptyNotRouted.remedyBody.toLowerCase()).toContain('settings');
  });

  it('should keep the two empty states distinguishable', () => {
    expect(benchWorkCopy.emptyIdle.title).not.toBe(benchWorkCopy.emptyNotRouted.title);
    expect(benchWorkCopy.emptyIdle.body).not.toBe(benchWorkCopy.emptyNotRouted.body);
  });

  it('should tell a packer that an unrecognised scan recorded nothing (story C3)', () => {
    expect(benchWorkCopy.scan.unrecognisedBody.toLowerCase()).toContain('nothing was recorded');
  });
});
