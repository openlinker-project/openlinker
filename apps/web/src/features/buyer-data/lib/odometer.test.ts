import { describe, expect, it } from 'vitest';
import { formatDelta, splitOdometer } from './odometer';

describe('odometer (#4289)', () => {
  it('should turn digits into reels and keep separators fixed', () => {
    const cols = splitOdometer('1 234');
    expect(cols.map((c) => c.digit)).toEqual([1, null, 2, 3, 4]);
  });

  it('should key columns from the right so the units column survives growth', () => {
    expect(splitOdometer('99').at(-1)?.key).toBe(splitOdometer('100').at(-1)?.key);
  });

  it('should describe the change with a sign, and not at all when nothing moved', () => {
    expect(formatDelta(10, 130, String)).toBe('+120');
    expect(formatDelta(50, 13, String)).toBe('-37');
    expect(formatDelta(5, 5, String)).toBeNull();
  });
});
