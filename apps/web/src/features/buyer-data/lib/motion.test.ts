import { describe, expect, it } from 'vitest';
import { barRiseDelayMs, waveDelayMs } from './motion';

describe('retention motion (#4289)', () => {
  it('should stagger bars left to right and stop growing the delay at the cap', () => {
    expect(barRiseDelayMs(0)).toBe(0);
    expect(barRiseDelayMs(10)).toBe(60);
    expect(barRiseDelayMs(500)).toBe(barRiseDelayMs(100));
    expect(barRiseDelayMs(-3)).toBe(0);
  });

  it('should spread the re-tint wave outwards from the handle, both ways', () => {
    expect(waveDelayMs(12, 12)).toBe(0);
    expect(waveDelayMs(15, 12)).toBe(45);
    expect(waveDelayMs(9, 12)).toBe(45);
    expect(waveDelayMs(118, 12)).toBe(300);
  });

  it('should not delay anything when no handle has moved', () => {
    expect(waveDelayMs(40, null)).toBe(0);
  });
});
