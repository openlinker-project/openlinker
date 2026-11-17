import { describe, expect, it } from 'vitest';
import { bottomReserve, chooseDock, ringBoxInDocument } from './tour-geometry';

const viewport = { width: 1280, height: 800 };
const card = { width: 340, height: 220 };

describe('ringBoxInDocument', () => {
  it('should frame the whole target in document coordinates', () => {
    const box = ringBoxInDocument({ top: -300, left: 260, width: 990, height: 1500 }, { x: 0, y: 600 });
    expect(box).toEqual({ top: 292, left: 252, width: 1006, height: 1516 });
  });

  it('should not depend on the viewport, so scrolling needs no re-measure', () => {
    const atTop = ringBoxInDocument({ top: 500, left: 10, width: 100, height: 50 }, { x: 0, y: 0 });
    const scrolled = ringBoxInDocument({ top: 300, left: 10, width: 100, height: 50 }, { x: 0, y: 200 });
    expect(scrolled).toEqual(atTop);
  });
});

describe('chooseDock', () => {
  it('should keep the bottom dock when the visible target is empty there', () => {
    const dock = chooseDock({
      target: { top: 80, left: 260, width: 500, height: 200 },
      viewport,
      card,
      topInset: 80,
      current: 'bottom',
    });
    expect(dock).toBe('bottom');
  });

  it('should move to the right when the bottom dock would cover the target and the right is free', () => {
    const dock = chooseDock({
      target: { top: 320, left: 260, width: 990, height: 900 },
      viewport,
      card,
      topInset: 80,
      current: 'bottom',
    });
    // Target ends left of the right column and fills the height, so right is free.
    expect(dock).toBe('right');
  });

  it('should stay where it is when the alternative gains little', () => {
    const dock = chooseDock({
      target: { top: 80, left: 260, width: 990, height: 900 },
      viewport,
      card,
      topInset: 80,
      current: 'bottom',
    });
    expect(dock).toBe('bottom');
  });

  it('should always sit at the bottom on a phone', () => {
    const dock = chooseDock({
      target: { top: 0, left: 0, width: 390, height: 900 },
      viewport: { width: 390, height: 844 },
      card: { width: 390, height: 200 },
      topInset: 70,
      current: 'right',
    });
    expect(dock).toBe('bottom');
  });
});

describe('bottomReserve', () => {
  it('should add the edge and the gap to the card height', () => {
    expect(bottomReserve(220)).toBe(252);
  });
});
