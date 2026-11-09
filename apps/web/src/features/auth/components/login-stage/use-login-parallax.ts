/**
 * Login parallax (#4029)
 *
 * The depth behind the login form. The panel preview is a screen set back in
 * 3D space, not a picture sliding about:
 *
 * - With a mouse, the screen tilts a few degrees towards the pointer (like a
 *   card turned in the hand) while the brand light leans the other way, so the
 *   two read as separate planes. The form never moves.
 * - On a phone, where the page scrolls, the screen starts leaning back and
 *   straightens as the visitor scrolls, tied 1:1 to the scroll position. The
 *   panel stays attached to the page, so nothing ever trails behind.
 * - On arrival it swings up from a deeper tilt and settles once.
 *
 * Everything is a motion value fed to `style`, so nothing re-renders per frame
 * and only `transform` changes (compositor-only). Still under reduced motion
 * and in the admin's preview (`MotionConfig reducedMotion="always"`).
 *
 * @module features/auth/components/login-stage
 */
import {
  useMotionValue,
  useReducedMotionConfig,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { useEffect, useState } from 'react';

/** Soft follow: the tilt trails the pointer a little instead of snapping to it. */
const FOLLOW = { stiffness: 40, damping: 18, mass: 1 } as const;

/** Degrees the screen turns at the edge of the window. */
const TILT = { x: 4, y: 6 } as const;
/** Phone: how far the screen leans back at the top of the page; it is flat at the bottom. */
const PHONE_LEAN = 16;
/** Perspective distance, px: close enough to read as 3D, far enough not to warp the panel. */
const PERSPECTIVE = 1400;
/** Matches the stage's one-column breakpoint, where the page starts to scroll. */
const PHONE_QUERY = '(max-width: 960px)';

export interface LoginPointer {
  /** -1..1 from the viewport centre, sprung. */
  x: MotionValue<number>;
  y: MotionValue<number>;
}

function useStill(): boolean {
  return useReducedMotionConfig() ?? false;
}

function useMatches(query: string): boolean {
  const read = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const onChange = (): void => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** The pointer as -1..1 from the viewport centre; stays at 0 without a fine pointer. */
export function useLoginPointer(): LoginPointer {
  const still = useStill();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, FOLLOW);
  const y = useSpring(rawY, FOLLOW);

  useEffect(() => {
    if (still || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return undefined;
    const onMove = (event: PointerEvent): void => {
      rawX.set((event.clientX / window.innerWidth) * 2 - 1);
      rawY.set((event.clientY / window.innerHeight) * 2 - 1);
    };
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
  }, [still, rawX, rawY]);

  return { x, y };
}

export interface BackdropMotion {
  rotateX: MotionValue<number>;
  rotateY: MotionValue<number>;
  transformPerspective: number;
  /** Set on the layer so a phone's lean pivots at the top of the page. */
  transformOrigin: string;
}

/** The panel preview's 3D tilt: towards the pointer, or straightening with the scroll on a phone. */
export function useBackdropParallax(pointer: LoginPointer): BackdropMotion {
  const still = useStill();
  const phone = useMatches(PHONE_QUERY);
  const { scrollY } = useScroll();
  // A motion value, not a closure: a transformer reads only its inputs, so a
  // captured `phone` would keep the first render's answer until the next scroll.
  const strength = useMotionValue(still || !phone ? 0 : 1);
  useEffect(() => {
    strength.set(still || !phone ? 0 : 1);
  }, [still, phone, strength]);
  // Direct, no spring: the lean is a function of where the page is, so it can never lag it.
  // Progress is read from the page here, not from `scrollYProgress`: before the
  // first scroll that one reports the end of the page, which flattened the lean.
  const lean = useTransform([scrollY, strength], ([y, k]) => {
    const range = document.documentElement.scrollHeight - window.innerHeight;
    const progress = range > 0 ? Math.min(Math.max((y as number) / range, 0), 1) : 0;
    return (k as number) * PHONE_LEAN * (1 - progress);
  });
  const rotateX = useTransform([pointer.y, lean], ([py, l]) => -(py as number) * TILT.x + (l as number));
  const rotateY = useTransform(pointer.x, (v) => v * TILT.y);
  return {
    rotateX,
    rotateY,
    transformPerspective: PERSPECTIVE,
    transformOrigin: phone ? '50% 20%' : '50% 50%',
  };
}
