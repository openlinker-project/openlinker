import { describe, expect, it } from 'vitest';
import { bottomReserve, computeTourLayout, targetIsFullyLit } from './tour-geometry';

const card = { width: 340, height: 220 };

describe('computeTourLayout', () => {
  it('should clamp a tall target above a bottom-docked card', () => {
    const layout = computeTourLayout({
      target: { top: 80, left: 260, width: 990, height: 900 },
      viewport: { width: 1280, height: 800 },
      card,
      topInset: 80,
    });
    expect(layout.dock).toBe('bottom');
    expect(layout.lit.top + layout.lit.height).toBeLessThanOrEqual(800 - 220 - 16 - 16);
    expect(layout.lit.height).toBeGreaterThan(0);
  });

  it('should keep the whole target lit when it fits', () => {
    const target = { top: 100, left: 300, width: 500, height: 200 };
    const layout = computeTourLayout({ target, viewport: { width: 1280, height: 800 }, card, topInset: 80 });
    expect(layout.lit).toEqual({ top: 92, left: 292, width: 516, height: 216 });
    expect(targetIsFullyLit(layout, target)).toBe(true);
  });

  it('should not light the area under the top bar', () => {
    const layout = computeTourLayout({
      target: { top: -300, left: 260, width: 600, height: 500 },
      viewport: { width: 1280, height: 800 },
      card,
      topInset: 80,
    });
    expect(layout.lit.top).toBeGreaterThanOrEqual(72);
  });

  it('should dock the card to the right when the target leaves room and bottom space is short', () => {
    const layout = computeTourLayout({
      target: { top: 80, left: 260, width: 560, height: 600 },
      viewport: { width: 1280, height: 700 },
      card,
      topInset: 80,
    });
    expect(layout.dock).toBe('right');
    expect(layout.lit.left + layout.lit.width).toBeLessThanOrEqual(1280 - 16 - 340 - 16);
  });

  it('should never clip the target sideways to make room for a right dock', () => {
    const layout = computeTourLayout({
      target: { top: 80, left: 260, width: 990, height: 600 },
      viewport: { width: 1280, height: 700 },
      card,
      topInset: 80,
    });
    expect(layout.dock).toBe('bottom');
  });

  it('should treat a phone as a bottom sheet and shrink the lit area to what remains', () => {
    const layout = computeTourLayout({
      target: { top: 70, left: 12, width: 366, height: 900 },
      viewport: { width: 390, height: 844 },
      card: { width: 390, height: 260 },
      topInset: 70,
    });
    expect(layout.dock).toBe('bottom');
    expect(layout.lit.top + layout.lit.height).toBeLessThanOrEqual(844 - 260 - 16);
    expect(layout.lit.left).toBeGreaterThanOrEqual(8);
    expect(layout.lit.left + layout.lit.width).toBeLessThanOrEqual(382);
  });
});

describe('bottomReserve', () => {
  it('should add the edge and the gap to the card height', () => {
    expect(bottomReserve(220)).toBe(252);
  });
});
