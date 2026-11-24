import { describe, expect, it } from 'vitest';
import { easeOutCubic, tickValue } from './ticking-number';

describe('ticking number (#4289)', () => {
  it('should start at the old value and land exactly on the new one', () => {
    expect(tickValue(10, 90, 0)).toBe(10);
    expect(tickValue(10, 90, 1)).toBe(90);
    expect(tickValue(10, 90, 1.5)).toBe(90);
  });

  it('should move fast first and slow at the end', () => {
    const early = tickValue(0, 100, 0.25) - tickValue(0, 100, 0);
    const late = tickValue(0, 100, 1) - tickValue(0, 100, 0.75);
    expect(early).toBeGreaterThan(late);
  });

  it('should count down as well as up and stay whole', () => {
    const mid = tickValue(100, 0, 0.5);
    expect(Number.isInteger(mid)).toBe(true);
    expect(mid).toBeLessThan(50);
    expect(easeOutCubic(-1)).toBe(0);
  });
});
