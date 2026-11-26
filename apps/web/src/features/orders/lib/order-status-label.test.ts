import { describe, expect, it } from 'vitest';

import { orderStatusLabel } from './order-status-label';

describe('orderStatusLabel', () => {
  it('should translate a known status', () => {
    expect(orderStatusLabel('processing', { processing: 'W realizacji' })).toBe('W realizacji');
  });

  it('should fall back to the raw value when the status is unknown', () => {
    expect(orderStatusLabel('weird', { processing: 'W realizacji' })).toBe('weird');
  });
});
