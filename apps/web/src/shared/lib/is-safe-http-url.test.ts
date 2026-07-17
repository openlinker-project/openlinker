/**
 * is-safe-http-url tests
 */
import { describe, expect, it } from 'vitest';
import { isSafeHttpUrl } from './is-safe-http-url';

describe('isSafeHttpUrl', () => {
  it('accepts absolute http/https URLs', () => {
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
    expect(isSafeHttpUrl('https://salescenter.allegro.pl/orders/abc')).toBe(true);
  });

  it('rejects non-http schemes', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeHttpUrl('vbscript:msgbox')).toBe(false);
    expect(isSafeHttpUrl('ftp://example.com')).toBe(false);
  });

  it('rejects relative, empty, and malformed values', () => {
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl('/orders/abc')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
    expect(isSafeHttpUrl('ht tp://example.com')).toBe(false);
  });
});
