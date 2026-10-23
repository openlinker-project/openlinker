import { describe, expect, it } from 'vitest';

import { formatInitials } from './format-initials';

describe('formatInitials', () => {
  it('takes the first and last initial of a two-or-more-word name', () => {
    expect(formatInitials('Marta Kowalczyk')).toBe('MK');
    expect(formatInitials('Anna Maria Nowak')).toBe('AN');
  });

  it('takes a single initial for a one-word name', () => {
    expect(formatInitials('Operator')).toBe('O');
  });

  it('uppercases the result', () => {
    expect(formatInitials('marta kowalczyk')).toBe('MK');
  });

  it('collapses extra whitespace before splitting', () => {
    expect(formatInitials('  Marta   Kowalczyk  ')).toBe('MK');
  });

  it('returns an empty string for an empty or blank name', () => {
    expect(formatInitials('')).toBe('');
    expect(formatInitials('   ')).toBe('');
  });
});
