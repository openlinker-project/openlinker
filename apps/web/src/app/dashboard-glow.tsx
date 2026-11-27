/**
 * Dashboard Glow
 *
 * The brand light behind the signed-in app, the quiet sibling of the login glow
 * (#4029): the same two accent orbs that breathe slowly out of step, but dimmer,
 * because a dense page needs less light than a form. It floats in two ways:
 *
 *   - on every page change the orbs drift to a new place nearby
 *     (`pickGlowSpots`), slowly, so it reads as the light settling;
 *   - with a mouse, the orbs lean a little towards and away from the pointer,
 *     in opposite directions, so the two read as layers at different depths.
 *
 * Four layers per orb (see the CSS), and every one of them moves only by
 * transform, so nothing here costs a layout:
 *   __lean   the size of the viewport, translated to the page's spot;
 *   __drift  the size of the viewport, translated by the pointer;
 *   __pos    pins the orb's centre to the top-left corner;
 *   __orb    breathes (CSS keyframes).
 *
 * The pointer never re-renders React: it writes two motion values, and the
 * springs behind them run on Motion's frame loop only while they are moving,
 * so an idle pointer costs nothing. Touch screens and reduced motion get no
 * pointer layer; reduced motion also gets no travel and no breathing.
 *
 * Rendered before `.shell`, which is positioned and so paints over it; the
 * shell's content area is transparent, the sidebar and top bar stay solid.
 *
 * @module app
 */
import {
  motion,
  useMotionValue,
  useReducedMotionConfig,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { GLOW_START_SPOTS, pickGlowSpots, type GlowSpots } from './dashboard-glow-spots';

// Duration-based springs with no bounce: they settle in a known time, so the
// animation (and its frame callbacks) ends a few seconds after a page change.
// `lean` is how far, in % of the screen, the orb follows the pointer from the
// centre to an edge; opposite signs move the orbs apart, which reads as depth.
const ORBS = [
  { key: 'a', visualDuration: 3.2, lean: 3.5 },
  // Slower and the other way: the two arrive out of step.
  { key: 'b', visualDuration: 4.2, lean: -5 },
] as const;

// Soft and slow, so the light trails the pointer instead of tracking it.
const POINTER_SPRING = { stiffness: 22, damping: 18, mass: 1.2 } as const;

function usePointerLean(enabled: boolean): {
  x: MotionValue<number>;
  y: MotionValue<number>;
} {
  // -1..1 across the window, 0 in the centre.
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);

  useEffect(() => {
    if (!enabled || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      rawX.set(0);
      rawY.set(0);
      return;
    }
    const onMove = (event: PointerEvent): void => {
      rawX.set((event.clientX / window.innerWidth) * 2 - 1);
      rawY.set((event.clientY / window.innerHeight) * 2 - 1);
    };
    // Back to rest when the pointer leaves the window.
    const onLeave = (): void => {
      rawX.set(0);
      rawY.set(0);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, [enabled, rawX, rawY]);

  return { x: useSpring(rawX, POINTER_SPRING), y: useSpring(rawY, POINTER_SPRING) };
}

function GlowOrb({
  orb,
  spot,
  still,
  pointer,
}: {
  orb: (typeof ORBS)[number];
  spot: GlowSpots[number];
  still: boolean;
  pointer: { x: MotionValue<number>; y: MotionValue<number> };
}): ReactElement {
  const range = [-orb.lean, orb.lean];
  const x = useTransform(pointer.x, [-1, 1], range.map((v) => `${v}%`));
  const y = useTransform(pointer.y, [-1, 1], range.map((v) => `${v}%`));

  return (
    <motion.div
      className={`dashboard-glow__lean dashboard-glow__lean--${orb.key}`}
      initial={false}
      animate={{ x: `${spot.x}%`, y: `${spot.y}%` }}
      transition={
        still ? { duration: 0 } : { type: 'spring', visualDuration: orb.visualDuration, bounce: 0 }
      }
    >
      <motion.div className="dashboard-glow__drift" style={{ x, y }}>
        <div className="dashboard-glow__pos">
          <div className={`dashboard-glow__orb dashboard-glow__orb--${orb.key}`} />
        </div>
      </motion.div>
    </motion.div>
  );
}

export function DashboardGlow(): ReactElement {
  const still = useReducedMotionConfig() ?? false;
  const { pathname } = useLocation();
  const [spots, setSpots] = useState<GlowSpots>(GLOW_START_SPOTS);
  const lastPathname = useRef(pathname);
  const pointer = usePointerLean(!still);

  useEffect(() => {
    if (lastPathname.current === pathname) {
      return;
    }
    lastPathname.current = pathname;
    if (!still) {
      setSpots((previous) => pickGlowSpots(previous));
    }
  }, [pathname, still]);

  return (
    <div
      className={['dashboard-glow', still ? 'dashboard-glow--still' : ''].filter(Boolean).join(' ')}
      aria-hidden="true"
      data-testid="dashboard-glow"
    >
      {ORBS.map((orb, index) => (
        <GlowOrb key={orb.key} orb={orb} spot={spots[index]} still={still} pointer={pointer} />
      ))}
    </div>
  );
}
