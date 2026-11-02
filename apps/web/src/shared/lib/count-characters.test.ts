import { describe, expect, it } from 'vitest';

import { countCharacters } from './count-characters';

describe('countCharacters', () => {
  it('should count plain ASCII one per letter when given ASCII', () => {
    expect(countCharacters('hello')).toBe(5);
  });

  it('should count Polish diacritics one each when given decomposed or composed forms', () => {
    expect(countCharacters('zażółć gęślą')).toBe(12);
    expect(countCharacters('á')).toBe(1);
  });

  it('should count a single emoji as one when given an emoji', () => {
    expect(countCharacters('😀')).toBe(1);
  });

  it('should count a ZWJ family emoji as one when given a family emoji', () => {
    expect(countCharacters('👨‍👩‍👧‍👦')).toBe(1);
  });

  it('should count a flag as one when given a flag', () => {
    expect(countCharacters('🇵🇱')).toBe(1);
  });

  it('should return zero when given an empty string', () => {
    expect(countCharacters('')).toBe(0);
  });
});
