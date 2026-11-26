import { describe, expect, it } from 'vitest';
import { mapViewportToRail, mapViewportWindow, type RailSegment } from './settings-toc-rail';

const segs: RailSegment[] = [
  { start: 100, end: 300, linkStart: 0, linkEnd: 20 },
  { start: 320, end: 1320, linkStart: 21, linkEnd: 41 },
  { start: 1320, end: 1420, linkStart: 42, linkEnd: 62 },
];

describe('mapViewportToRail', () => {
  it('should clamp to the first link start before the first section', () => {
    expect(mapViewportToRail(segs, 0)).toBe(0);
  });
  it('should clamp to the last link end after the last section', () => {
    expect(mapViewportToRail(segs, 5000)).toBe(62);
  });
  it('should map progress through a section onto its link', () => {
    expect(mapViewportToRail(segs, 200)).toBe(10);
    expect(mapViewportToRail(segs, 820)).toBe(31);
  });
  it('should interpolate across a gap between sections', () => {
    expect(mapViewportToRail(segs, 310)).toBe(20.5);
  });
  it('should be monotonic and continuous as y grows', () => {
    let prev = -Infinity;
    for (let y = 0; y < 1600; y += 7) {
      const v = mapViewportToRail(segs, y) as number;
      expect(v).toBeGreaterThanOrEqual(prev);
      if (prev !== -Infinity) expect(v - prev).toBeLessThan(5);
      prev = v;
    }
  });
  it('should return null without sections', () => {
    expect(mapViewportToRail([], 10)).toBeNull();
  });
});

describe('mapViewportWindow', () => {
  it('should span the mapped top and bottom edges', () => {
    expect(mapViewportWindow(segs, 200, 820)).toEqual({ start: 10, size: 21 });
  });
  it('should keep a minimum size', () => {
    expect(mapViewportWindow(segs, 5000, 6000)?.size).toBe(2);
  });
});
