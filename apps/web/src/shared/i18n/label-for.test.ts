import { describe, expect, it } from 'vitest';
import { labelFor } from './label-for';

describe('labelFor', () => {
  const labels = { active: 'Active', ended: 'Ended' };

  it('should return the label for a known value', () => {
    expect(labelFor(labels, 'active')).toBe('Active');
  });

  it('should fall back to the raw value for an unknown value', () => {
    expect(labelFor(labels, 'paused')).toBe('paused');
  });

  it('should use the given fallback for an unknown value', () => {
    expect(labelFor(labels, 'paused', 'PAUSED')).toBe('PAUSED');
  });

  it('should not return an Object.prototype member for a value like constructor', () => {
    expect(labelFor(labels, 'constructor')).toBe('constructor');
    expect(labelFor(labels, 'toString')).toBe('toString');
  });
});
