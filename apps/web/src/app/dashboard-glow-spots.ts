/**
 * Dashboard glow spots
 *
 * Where the two brand-light orbs sit behind the app shell, as a percentage of
 * the viewport, and how they move on a page change. Pure so the bounds can be
 * tested without a browser.
 *
 * A page change is a nudge, not a jump: each orb drifts a few points from where
 * it was, so the page feels alive without pulling the eye off the content.
 * Centres never leave the 14-86% band, so the light is always on screen.
 *
 * @module app
 */

export interface GlowSpot {
  x: number;
  y: number;
}

export type GlowSpots = readonly [GlowSpot, GlowSpot];

export const GLOW_SPOT_MIN = 14;
export const GLOW_SPOT_MAX = 86;
export const GLOW_STEP_MIN = 9;
export const GLOW_STEP_MAX = 18;
/** The orbs never close to less than this, or they stack into one blob. */
export const GLOW_MIN_APART = 34;

/** Bottom left and top right, like the login page. */
export const GLOW_START_SPOTS: GlowSpots = [
  { x: 18, y: 84 },
  { x: 78, y: 26 },
];

const clamp = (value: number): number => Math.min(GLOW_SPOT_MAX, Math.max(GLOW_SPOT_MIN, value));

function nudge(from: GlowSpot, random: () => number): GlowSpot {
  const angle = random() * Math.PI * 2;
  const length = GLOW_STEP_MIN + random() * (GLOW_STEP_MAX - GLOW_STEP_MIN);
  return {
    x: clamp(from.x + Math.cos(angle) * length),
    y: clamp(from.y + Math.sin(angle) * length),
  };
}

export function pickGlowSpots(previous: GlowSpots, random: () => number = Math.random): GlowSpots {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const a = nudge(previous[0], random);
    const b = nudge(previous[1], random);
    if (Math.hypot(a.x - b.x, a.y - b.y) >= GLOW_MIN_APART) {
      return [a, b];
    }
  }
  return previous;
}
