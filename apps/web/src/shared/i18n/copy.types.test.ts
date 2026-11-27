/**
 * Copy types - type-level tests (#3891)
 *
 * `tsc` checks this file: a Polish file with the wrong shape must not compile,
 * and a Polish file that only lacks keys must, because a missing key falls
 * back to English at runtime and is reported by `check-locales` instead.
 *
 * @module shared/i18n
 */
import { describe, expect, it } from 'vitest';
import type { PolishCopy } from './copy.types';

// A type alias, not an interface: `CopyTree` is index-signed, which an
// interface does not satisfy (a JSON import's type is an alias too).
type Shape = {
  readonly title: string;
  readonly header: { readonly sub: string };
  readonly count: { readonly one: string; readonly other: string };
};

describe('PolishCopy', () => {
  it('should accept a Polish file that lacks keys', () => {
    const partial: PolishCopy<Shape> = { title: 'Zamówienia' };
    const empty: PolishCopy<Shape> = {};
    expect([partial, empty]).toHaveLength(2);
  });

  it('should reject a Polish file with a key English lacks or a wrong shape', () => {
    // @ts-expect-error a key English does not have
    const extra: PolishCopy<Shape> = { title: 'Zamówienia', footer: 'x' };
    // @ts-expect-error a string where English has a section
    const flat: PolishCopy<Shape> = { header: 'Nagłówek' };
    // @ts-expect-error a section where English has a string
    const nested: PolishCopy<Shape> = { title: { sub: 'x' } };
    expect([extra, flat, nested]).toHaveLength(3);
  });
});
