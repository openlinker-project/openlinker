import { describe, expect, it } from 'vitest';
import {
  GLOW_MIN_APART,
  GLOW_SPOT_MAX,
  GLOW_SPOT_MIN,
  GLOW_START_SPOTS,
  GLOW_STEP_MAX,
  pickGlowSpots,
  type GlowSpots,
} from './dashboard-glow-spots';

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('pickGlowSpots', () => {
  it('should keep both orbs inside the visible band when picking over many page changes', () => {
    const random = seeded(7);
    let spots: GlowSpots = GLOW_START_SPOTS;
    for (let i = 0; i < 500; i += 1) {
      spots = pickGlowSpots(spots, random);
      for (const spot of spots) {
        expect(spot.x).toBeGreaterThanOrEqual(GLOW_SPOT_MIN);
        expect(spot.x).toBeLessThanOrEqual(GLOW_SPOT_MAX);
        expect(spot.y).toBeGreaterThanOrEqual(GLOW_SPOT_MIN);
        expect(spot.y).toBeLessThanOrEqual(GLOW_SPOT_MAX);
      }
    }
  });

  it('should never let the orbs close to a single blob when picking', () => {
    const random = seeded(11);
    let spots: GlowSpots = GLOW_START_SPOTS;
    for (let i = 0; i < 500; i += 1) {
      spots = pickGlowSpots(spots, random);
      expect(Math.hypot(spots[0].x - spots[1].x, spots[0].y - spots[1].y)).toBeGreaterThanOrEqual(
        GLOW_MIN_APART
      );
    }
  });

  it('should move each orb only a little when picking from the start layout', () => {
    const next = pickGlowSpots(GLOW_START_SPOTS, seeded(3));
    for (const [i, spot] of next.entries()) {
      expect(
        Math.hypot(spot.x - GLOW_START_SPOTS[i].x, spot.y - GLOW_START_SPOTS[i].y)
      ).toBeLessThanOrEqual(GLOW_STEP_MAX + 0.01);
    }
  });

  it('should keep the previous spots when no nudge can satisfy the distance rule', () => {
    const tooClose: GlowSpots = [
      { x: 50, y: 50 },
      { x: 55, y: 50 },
    ];
    // A constant source moves both orbs the same way, so they never get apart.
    expect(pickGlowSpots(tooClose, () => 0)).toBe(tooClose);
  });
});
