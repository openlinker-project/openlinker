import { describe, expect, it, vi } from 'vitest';
import {
  announceGuidedLanded,
  computeInkTravel,
  computeRipple,
  onGuidedLanded,
  scrollLeftToReveal,
  tabDirection,
} from './guided-jump';

describe('guided jump geometry', () => {
  it('should express a move between two underlines as translateX and scaleX of a 1px line', () => {
    expect(computeInkTravel({ left: 40, width: 62 }, { left: 310, width: 71 })).toEqual({
      x: [40, 310],
      scaleX: [62, 71],
    });
  });

  it('should pick the slide side from tab order and none when a tab is unknown', () => {
    const order = ['overview', 'orders', 'health', 'actions'];
    expect(tabDirection(order, 'orders', 'actions')).toBe(1);
    expect(tabDirection(order, 'actions', 'orders')).toBe(-1);
    expect(tabDirection(order, undefined, 'actions')).toBe(0);
    expect(tabDirection(order, 'orders', 'orders')).toBe(0);
    expect(tabDirection(order, 'nope', 'actions')).toBe(0);
  });

  it('should size the ripple to reach the far corner from the pointer', () => {
    expect(computeRipple({ width: 100, height: 40 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      diameter: Math.ceil(2 * Math.hypot(90, 30)),
    });
  });

  it('should ripple from the centre without a pointer position and clamp one outside the box', () => {
    expect(computeRipple({ width: 100, height: 40 }, null)).toMatchObject({ x: 50, y: 20 });
    expect(computeRipple({ width: 100, height: 40 }, { x: -5, y: 90 })).toMatchObject({
      x: 0,
      y: 40,
    });
  });

  it('should scroll a hidden tab into view and leave a visible one alone', () => {
    const view = { scrollLeft: 0, clientWidth: 300 };
    expect(scrollLeftToReveal(view, { left: 20, width: 60 })).toBe(0);
    expect(scrollLeftToReveal(view, { left: 400, width: 80 })).toBe(480 - 300 + 28);
    expect(scrollLeftToReveal({ scrollLeft: 200, clientWidth: 300 }, { left: 50, width: 60 })).toBe(
      22
    );
  });
});

describe('guided landed signal', () => {
  it('should reach a subscriber until it unsubscribes', () => {
    const seen = vi.fn();
    const off = onGuidedLanded(seen);
    announceGuidedLanded();
    off();
    announceGuidedLanded();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
