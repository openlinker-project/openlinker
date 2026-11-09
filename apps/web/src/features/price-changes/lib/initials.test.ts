import { describe, expect, it } from 'vitest';
import { initialsFor } from './initials';

describe('initialsFor', () => {
  it('should take the first letters of the first two words, upper-cased', () => {
    expect(initialsFor('serwuj tę chwilę')).toBe('ST');
  });

  it('should ignore doubled and leading spaces', () => {
    expect(initialsFor('  Kubek   ceramiczny')).toBe('KC');
  });
});
