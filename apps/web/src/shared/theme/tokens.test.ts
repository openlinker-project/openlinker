/**
 * Tokens — unit tests
 *
 * Sanity checks on the design-token catalog. The interesting drift check
 * (catalog ↔ index.css declarations) lives in
 * `scripts/check-design-tokens.mjs` and runs under `pnpm lint`; these
 * tests just guard the catalog's internal invariants.
 *
 * @module shared/theme
 */
import { describe, expect, it } from 'vitest';
import { tokens, type TokenName } from './tokens';

describe('tokens', () => {
  it('emits a non-empty catalog', () => {
    expect(Object.keys(tokens).length).toBeGreaterThan(0);
  });

  it('uses the var(--name) shape for every entry, with the key matching the name', () => {
    for (const [key, value] of Object.entries(tokens)) {
      expect(value).toBe(`var(--${key})`);
    }
  });

  it('only declares unique token names', () => {
    const keys = Object.keys(tokens);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('TokenName narrows to a finite union of catalog keys', () => {
    // Compile-time assertion: assigning a known key works, an unknown
    // string is a TS error. Runtime mirrors the same expectation.
    const known: TokenName = 'bg-canvas';
    expect(tokens[known]).toBe('var(--bg-canvas)');
  });
});
