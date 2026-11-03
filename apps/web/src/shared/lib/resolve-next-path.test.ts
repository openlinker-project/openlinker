import { describe, expect, it } from 'vitest';

import { resolveNextPath } from './resolve-next-path';

describe('resolveNextPath', () => {
  it.each([
    [null, '/'],
    ['', '/'],
    ['/orders', '/orders'],
    ['/orders?status=failed', '/orders?status=failed'],
    // An absolute or protocol-relative target would turn the gate into an open
    // redirect, so both fall back to the app root.
    ['https://evil.example/steal', '/'],
    ['//evil.example/steal', '/'],
    // Browsers normalise a backslash after the slash to `//`.
    ['/\\evil.example/steal', '/'],
    ['orders', '/'],
  ])('should resolve %s to %s', (raw, expected) => {
    expect(resolveNextPath(raw)).toBe(expected);
  });
});
